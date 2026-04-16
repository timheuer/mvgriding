// Flyover animation: walks the route at compressed speed (~30s default) and
// broadcasts the current position so the map marker, chart ruler, and
// tooltip can follow. Uses the existing "route-hover" custom event plumbing
// for zero-coupling integration.
//
// Public API:
//   start(routeData, opts)   — begin (or resume) playback
//   pause()
//   resume()
//   stop()                    — stop and return to idle
//   seek(fraction)            — 0..1 scrub
//   isPlaying()
//   onUpdate(fn)              — progress callback ({ fraction, dist, pt })
//   onStateChange(fn)         — state callback ('playing' | 'paused' | 'stopped')

import { setFlyoverPosition, hideFlyoverMarker, showFlyoverMarker } from './map.js';

const DEFAULT_DURATION_MS = 30_000;

let routeData = null;
let durationMs = DEFAULT_DURATION_MS;
let totalDistMi = 0;
let startTs = 0;
let elapsedBeforePause = 0;
let rafId = null;
let state = 'stopped'; // 'stopped' | 'playing' | 'paused'

const updateListeners = new Set();
const stateListeners = new Set();

export function onUpdate(fn) { updateListeners.add(fn); return () => updateListeners.delete(fn); }
export function onStateChange(fn) { stateListeners.add(fn); return () => stateListeners.delete(fn); }

function emitUpdate(fraction, dist, pt) {
    updateListeners.forEach((fn) => fn({ fraction, dist, pt }));
    // Drive existing hover-sync plumbing (map tooltip + chart ruler)
    window.dispatchEvent(new CustomEvent('route-hover', { detail: { dist } }));
    window.dispatchEvent(new CustomEvent('chart-hover', {
        detail: { lat: pt.lat, lon: pt.lon, dist },
    }));
}

function setState(s) {
    if (s === state) return;
    state = s;
    stateListeners.forEach((fn) => fn(s));
}

// Find route point at a given cumulative distance (with interpolation)
function pointAtDist(dist) {
    if (!routeData || routeData.length === 0) return null;
    if (dist <= 0) return routeData[0];
    if (dist >= totalDistMi) return routeData[routeData.length - 1];

    // Binary search for speed on long routes
    let lo = 0, hi = routeData.length - 1;
    while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (routeData[mid].dist <= dist) lo = mid;
        else hi = mid;
    }
    const a = routeData[lo];
    const b = routeData[hi];
    const span = b.dist - a.dist;
    const frac = span > 0 ? (dist - a.dist) / span : 0;
    return {
        lat: a.lat + (b.lat - a.lat) * frac,
        lon: a.lon + (b.lon - a.lon) * frac,
        eleFt: a.eleFt !== null && b.eleFt !== null ? a.eleFt + (b.eleFt - a.eleFt) * frac : null,
        dist,
        grade: a.grade,
    };
}

function tick() {
    if (state !== 'playing') return;
    const now = performance.now();
    const elapsed = elapsedBeforePause + (now - startTs);
    let fraction = Math.min(1, elapsed / durationMs);

    const dist = fraction * totalDistMi;
    const pt = pointAtDist(dist);
    if (pt) {
        setFlyoverPosition(pt.lat, pt.lon);
        emitUpdate(fraction, dist, pt);
    }

    if (fraction >= 1) {
        // Finished — leave marker at finish, transition to stopped state
        pause();
        setState('stopped');
        return;
    }
    rafId = requestAnimationFrame(tick);
}

export function start(data, opts = {}) {
    if (!data || data.length < 2) return;
    stop();
    routeData = data;
    totalDistMi = routeData[routeData.length - 1].dist;
    durationMs = opts.durationMs || DEFAULT_DURATION_MS;
    elapsedBeforePause = 0;
    startTs = performance.now();
    const startPt = routeData[0];
    showFlyoverMarker(startPt.lat, startPt.lon);
    setState('playing');
    rafId = requestAnimationFrame(tick);
}

// Change playback duration while preserving the current fraction of the ride.
// Called when the pace slider changes during playback.
export function setDuration(newDurationMs) {
    if (!routeData || newDurationMs <= 0) return;
    // Compute current fraction
    let fraction;
    if (state === 'playing') {
        const elapsed = elapsedBeforePause + (performance.now() - startTs);
        fraction = Math.min(1, elapsed / durationMs);
    } else {
        fraction = Math.min(1, elapsedBeforePause / durationMs);
    }
    durationMs = newDurationMs;
    elapsedBeforePause = fraction * durationMs;
    if (state === 'playing') startTs = performance.now();
}

export function pause() {
    if (state !== 'playing') return;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    elapsedBeforePause += performance.now() - startTs;
    setState('paused');
}

export function resume() {
    if (state !== 'paused' || !routeData) return;
    startTs = performance.now();
    setState('playing');
    rafId = requestAnimationFrame(tick);
}

export function stop() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    elapsedBeforePause = 0;
    routeData = null;
    totalDistMi = 0;
    hideFlyoverMarker();
    // Clear any lingering hover cursor
    window.dispatchEvent(new CustomEvent('route-hover', { detail: { dist: null } }));
    window.dispatchEvent(new CustomEvent('chart-hover', { detail: { lat: null } }));
    setState('stopped');
}

export function seek(fraction) {
    if (!routeData) return;
    fraction = Math.max(0, Math.min(1, fraction));
    elapsedBeforePause = fraction * durationMs;
    if (state === 'playing') {
        startTs = performance.now();
    } else {
        // Update display once while paused/stopped
        const dist = fraction * totalDistMi;
        const pt = pointAtDist(dist);
        if (pt) {
            setFlyoverPosition(pt.lat, pt.lon);
            emitUpdate(fraction, dist, pt);
        }
    }
}

export function isPlaying() { return state === 'playing'; }
export function getState() { return state; }
