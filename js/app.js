import {
    parseGPX,
    computeRouteData,
    fetchElevations,
    samplePoints,
} from './gpx.js';
import {
    fetchWeatherForPoints,
    recomputeForPace,
    fetchDaySummary,
    weatherCodeIcon,
    clearWeatherCache,
    DEFAULT_PACE_MPH,
    DEFAULT_START_HOUR,
} from './weather.js';
import {
    initMap,
    renderRoute,
    highlightPoint,
    clearMap,
    refreshMileMarkers,
    renderOverview,
    overviewColor,
    zoomToRange,
    highlightClimbOnMap,
} from './map.js';
import { renderElevationProfile, destroyChart, highlightClimb } from './elevation.js';
import { detectClimbs, climbDifficulty } from './climbs.js';
import * as flyover from './flyover.js';
import * as units from './units.js';

const DAYS = [
    { day: 1, date: '2026-04-19', dateLabel: 'Apr 19', file: 'routes/MVG-01a_Pleasant_View_to_Hovenweep.gpx', name: 'Pleasant View to Hovenweep' },
    { day: 2, date: '2026-04-20', dateLabel: 'Apr 20', file: 'routes/MVG-02_Natural_Bridges___Bears_Ears.gpx', name: 'Natural Bridges & Bears Ears' },
    { day: 3, date: '2026-04-21', dateLabel: 'Apr 21', file: 'routes/MVG-03_Comb_Wash_to_Bluff.gpx', name: 'Comb Wash to Bluff' },
    { day: 4, date: '2026-04-22', dateLabel: 'Apr 22', file: 'routes/MVG-04_Bluff_to_Mexican_Hat.gpx', name: 'Bluff to Mexican Hat' },
    { day: 5, date: '2026-04-23', dateLabel: 'Apr 23', file: 'routes/MVG-05_Monument_Valley_to_Goosenecks_State_Park.gpx', name: 'Monument Valley to Goosenecks' },
];

const WIND_SAMPLE_INTERVAL = 2.5; // miles
const LAST_DAY_KEY = 'mvg_last_day';
const PACE_KEY = 'mvg_pace';

let currentDay = null;          // number (1..N) or 'overview'
let lastRouteData = null;
let lastDay = null;             // day object
let lastWeatherPoints = null;
let lastSampled = null;         // sampled points used for weather (for recompute on pace change)
let currentClimbs = [];
let selectedClimbIdx = null;
let pace = parseFloat(localStorage.getItem(PACE_KEY)) || DEFAULT_PACE_MPH;

// Per-day cache of parsed GPX/routeData (avoid re-fetch when navigating)
const routeCache = new Map();

// --- Helpers ---

function announce(msg) {
    const live = document.getElementById('sr-live');
    if (live) live.textContent = msg;
}

function showToast(msg) {
    const t = document.getElementById('weather-toast');
    if (!t) return;
    if (msg) { t.textContent = msg; t.classList.add('show'); }
    else { t.classList.remove('show'); t.textContent = ''; }
}

function showLoading(show, label = '') {
    const el = document.getElementById('loading');
    const lbl = document.getElementById('loading-label');
    el.style.display = show ? 'flex' : 'none';
    if (lbl) lbl.textContent = label;
}

function showError(msg, retryFn) {
    const err = document.getElementById('error-state');
    const msgEl = document.getElementById('error-message');
    const btn = document.getElementById('error-retry');
    msgEl.textContent = msg;
    err.style.display = 'flex';
    btn.onclick = () => {
        err.style.display = 'none';
        retryFn?.();
    };
}

function hideError() {
    document.getElementById('error-state').style.display = 'none';
}

// --- Navigation / state ---

function buildNav() {
    const nav = document.getElementById('day-nav');
    nav.innerHTML = '';

    // Overview button
    const ov = document.createElement('button');
    ov.className = 'day-btn overview-btn';
    ov.dataset.day = 'overview';
    ov.setAttribute('type', 'button');
    ov.innerHTML = `
      <span class="day-num">Trip Overview</span>
      <span class="day-name">All 5 days</span>
    `;
    ov.addEventListener('click', () => selectDay('overview'));
    nav.appendChild(ov);

    for (const day of DAYS) {
        const btn = document.createElement('button');
        btn.className = 'day-btn';
        btn.dataset.day = day.day;
        btn.setAttribute('type', 'button');
        btn.innerHTML = `
          <span class="day-num">Day ${day.day}</span>
          <span class="day-date">${day.dateLabel}</span>
          <span class="day-name">${day.name}</span>
          <span class="day-wx loading" data-day="${day.day}">&nbsp;</span>
        `;
        btn.addEventListener('click', () => selectDay(day.day));
        nav.appendChild(btn);
    }
}

function setActiveNav(dayKey) {
    document.querySelectorAll('.day-btn').forEach((btn) => {
        const isActive = btn.dataset.day === String(dayKey);
        btn.classList.toggle('active', isActive);
        if (isActive) btn.setAttribute('aria-current', 'page');
        else btn.removeAttribute('aria-current');
    });
}

// --- Route info bar ---

function computeStats(routeData) {
    const totalDistMi = routeData[routeData.length - 1]?.dist || 0;
    const hasEle = routeData.some((pt) => pt.eleFt !== null);
    let elevGainFt = 0;
    if (hasEle) {
        for (let i = 1; i < routeData.length; i++) {
            const diff = (routeData[i].eleFt || 0) - (routeData[i - 1].eleFt || 0);
            if (diff > 0) elevGainFt += diff;
        }
    }
    return { totalDistMi, hasEle, elevGainFt };
}

function updateRouteInfo(routeData, day) {
    const { totalDistMi, hasEle, elevGainFt } = computeStats(routeData);

    const paceSpeed = units.speed(pace);
    const estTime = totalDistMi / pace;
    const hours = Math.floor(estTime);
    const mins = Math.round((estTime - hours) * 60);

    const displayDist = units.dist(totalDistMi);
    const displayElev = units.elev(elevGainFt);

    document.getElementById('route-title').textContent = day.name;
    document.getElementById('route-date').textContent = `Day ${day.day} — ${day.dateLabel}, 2026`;
    document.getElementById('route-dist').textContent = `${displayDist.toFixed(1)} ${units.distUnit()}`;
    document.getElementById('route-elev').textContent = hasEle
        ? `${Math.round(displayElev).toLocaleString()} ${units.elevUnit()} gain`
        : '—';
    document.getElementById('route-time').textContent =
        `~${hours}h ${mins}m @ ${Math.round(paceSpeed)} ${units.speedUnit()}`;
    document.getElementById('route-finish').textContent =
        `Finish ${units.formatClock(DEFAULT_START_HOUR, estTime)}`;
}

function renderOverviewHeader() {
    document.getElementById('route-title').textContent = 'Trip Overview';
    document.getElementById('route-date').textContent = 'Apr 19–23, 2026';
    document.getElementById('route-dist').textContent = '';
    document.getElementById('route-elev').textContent = '';
    document.getElementById('route-time').textContent = '';
    document.getElementById('route-finish').textContent = '';
}

// --- Climbs panel ---

function renderClimbs(climbs) {
    const panel = document.getElementById('climbs-panel');
    const list = document.getElementById('climbs-list');
    list.innerHTML = '';
    selectedClimbIdx = null;

    if (!climbs || climbs.length === 0) {
        panel.hidden = true;
        return;
    }
    panel.hidden = false;

    climbs.forEach((c, idx) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'climb-chip';
        chip.dataset.climbIdx = String(idx);
        const diff = climbDifficulty(c.avgGrade);
        const lenDisp = units.dist(c.lengthMi).toFixed(1);
        const gainDisp = Math.round(units.elev(c.gainFt)).toLocaleString();
        chip.innerHTML = `
          <span class="climb-grade g-${diff}">${c.avgGrade.toFixed(1)}%</span>
          <span>@ ${units.dist(c.startDist).toFixed(1)} ${units.distUnit()}</span>
          <span>· ${lenDisp} ${units.distUnit()}</span>
          <span>· ${gainDisp} ${units.elevUnit()}</span>
        `;
        chip.addEventListener('click', () => {
            if (selectedClimbIdx === idx) {
                // Second click on the same chip → deselect
                deselectClimb();
            } else {
                selectClimb(idx, c);
            }
        });
        chip.addEventListener('mouseenter', () => {
            if (selectedClimbIdx === null) {
                highlightClimb({ startIdx: c.startIdx, endIdx: c.endIdx });
                highlightClimbOnMap(c.startIdx, c.endIdx, 'hover');
            }
        });
        chip.addEventListener('mouseleave', () => {
            if (selectedClimbIdx === null) {
                highlightClimb(null);
                highlightClimbOnMap(null);
            }
        });
        list.appendChild(chip);
    });
}

function selectClimb(idx, c) {
    selectedClimbIdx = idx;
    document.querySelectorAll('.climb-chip').forEach((chip) => {
        chip.classList.toggle('selected', parseInt(chip.dataset.climbIdx) === idx);
    });
    zoomToRange(c.startIdx, c.endIdx);
    highlightClimb({ startIdx: c.startIdx, endIdx: c.endIdx });
    highlightClimbOnMap(c.startIdx, c.endIdx, 'selected');
}

function deselectClimb() {
    selectedClimbIdx = null;
    document.querySelectorAll('.climb-chip.selected').forEach((c) => c.classList.remove('selected'));
    highlightClimb(null);
    highlightClimbOnMap(null);
}

// --- Day-button weather pill ---

async function prefetchDaySummaries() {
    await Promise.all(DAYS.map(async (d) => {
        const midLat = 37.4; // fallback; will be replaced once we know the real midpoint
        const midLon = -109.5;
        // Prefer using the first trackpoint of each route if available in cache
        let lat = midLat, lon = midLon;
        const cached = routeCache.get(d.day);
        if (cached?.routeData?.length) {
            const mid = cached.routeData[Math.floor(cached.routeData.length / 2)];
            lat = mid.lat; lon = mid.lon;
        } else {
            // Light pre-parse (no elevation fetch) just for midpoint
            try {
                const resp = await fetch(d.file);
                const xml = await resp.text();
                const parsed = parseGPX(xml);
                if (parsed.trackpoints.length) {
                    const mid = parsed.trackpoints[Math.floor(parsed.trackpoints.length / 2)];
                    lat = mid.lat; lon = mid.lon;
                }
            } catch (_) { /* fall back */ }
        }
        const summary = await fetchDaySummary(lat, lon, d.date);
        updateDayWxPill(d.day, summary);
    }));
}

function updateDayWxPill(dayNum, summary) {
    const pill = document.querySelector(`.day-wx[data-day="${dayNum}"]`);
    if (!pill) return;
    pill.classList.remove('loading');
    if (!summary) { pill.textContent = ''; return; }
    const icon = weatherCodeIcon(summary.weatherCode);
    const tMax = summary.tempMax !== null
        ? `${Math.round(units.temp(summary.tempMax))}${units.tempUnit()}`
        : '—';
    const wind = summary.windMax !== null
        ? `${Math.round(units.speed(summary.windMax))} ${units.speedUnit()}`
        : '';
    pill.innerHTML = `<span class="wx-icon">${icon}</span><span>${tMax}</span>${wind ? `<span>· ${wind}</span>` : ''}`;
}

function refreshAllDayWxPills() {
    // Re-render with current units from whatever we already fetched (re-query summary cache)
    DAYS.forEach(async (d) => {
        const cached = routeCache.get(d.day);
        const lat = cached?.routeData?.length ? cached.routeData[Math.floor(cached.routeData.length / 2)].lat : 37.4;
        const lon = cached?.routeData?.length ? cached.routeData[Math.floor(cached.routeData.length / 2)].lon : -109.5;
        const s = await fetchDaySummary(lat, lon, d.date);
        updateDayWxPill(d.day, s);
    });
}

// --- Load a day ---

async function loadRouteForDay(day) {
    if (routeCache.has(day.day)) return routeCache.get(day.day);
    const resp = await fetch(day.file);
    if (!resp.ok) throw new Error(`Failed to fetch ${day.file}`);
    const xml = await resp.text();
    let { trackpoints, isRoute } = parseGPX(xml);
    if (isRoute || trackpoints.every((pt) => pt.ele === null)) {
        trackpoints = await fetchElevations(trackpoints);
    }
    const routeData = computeRouteData(trackpoints);
    const entry = { routeData };
    routeCache.set(day.day, entry);
    return entry;
}

async function selectDay(dayKey) {
    if (currentDay === dayKey) return;
    currentDay = dayKey;
    setActiveNav(dayKey);
    hideError();
    showToast(null);
    flyover.stop();

    // Disable flyover button in overview mode
    const flyBtn = document.getElementById('flyover-btn');
    if (flyBtn) flyBtn.disabled = dayKey === 'overview';

    if (dayKey === 'overview') {
        window.location.hash = 'day=overview';
        localStorage.setItem(LAST_DAY_KEY, 'overview');
        await showOverview();
        return;
    }

    const day = DAYS.find((d) => d.day === dayKey);
    if (!day) return;

    window.location.hash = `day=${day.day}`;
    localStorage.setItem(LAST_DAY_KEY, String(day.day));

    // Hide overview-only UI
    document.getElementById('overview-table').hidden = true;
    document.querySelector('.chart-wrap').style.display = '';

    showLoading(true, 'Loading route…');
    clearMap();
    destroyChart();
    renderClimbs([]);

    try {
        const { routeData } = await loadRouteForDay(day);
        updateRouteInfo(routeData, day);

        // Climbs
        currentClimbs = detectClimbs(routeData);
        renderClimbs(currentClimbs);

        // Weather
        showLoading(true, 'Loading weather 0/0…');
        const sampled = samplePoints(routeData, WIND_SAMPLE_INTERVAL);
        lastSampled = sampled;
        let weatherPoints = [];

        try {
            weatherPoints = await fetchWeatherForPoints(sampled, day.date, {
                pace,
                startHour: DEFAULT_START_HOUR,
                onProgress: (done, total) => {
                    showLoading(true, `Loading weather ${done}/${total}…`);
                },
            });
            const anyAvailable = weatherPoints.some((w) => w.available);
            if (!anyAvailable) {
                showToast('Forecast not yet available for this date');
            }
        } catch (e) {
            console.warn('Weather fetch failed:', e);
            showToast('Weather data unavailable — tap refresh to retry');
        }

        renderRoute(routeData, weatherPoints);
        renderElevationProfile(routeData, 'elevation-chart');

        lastRouteData = routeData;
        lastDay = day;
        lastWeatherPoints = weatherPoints;

        announce(`Day ${day.day}: ${day.name} loaded`);
        showLoading(false);
    } catch (e) {
        console.error('Failed to load route:', e);
        showLoading(false);
        showError('Failed to load route data. Check your connection and try again.', () => {
            currentDay = null;
            selectDay(dayKey);
        });
        // Mark the day-btn as errored
        const btn = document.querySelector(`.day-btn[data-day="${dayKey}"]`);
        if (btn) btn.dataset.error = 'true';
    }
}

// --- Overview mode ---

async function showOverview() {
    showLoading(true, 'Loading all routes…');
    destroyChart();
    renderClimbs([]);
    document.querySelector('.chart-wrap').style.display = 'none';
    renderOverviewHeader();

    try {
        const loaded = await Promise.all(DAYS.map(async (d) => {
            const { routeData } = await loadRouteForDay(d);
            return { ...d, routeData };
        }));
        renderOverview(loaded);
        renderOverviewTable(loaded);
        showLoading(false);
        announce('Trip overview loaded');
    } catch (e) {
        console.error(e);
        showLoading(false);
        showError('Failed to load overview routes.', showOverview);
    }
}

function renderOverviewTable(days) {
    const container = document.getElementById('overview-table');
    container.hidden = false;

    let totalMi = 0, totalGain = 0, totalHrs = 0;
    const rows = days.map((d, i) => {
        const { totalDistMi, elevGainFt } = computeStats(d.routeData);
        const hrs = totalDistMi / pace;
        totalMi += totalDistMi;
        totalGain += elevGainFt;
        totalHrs += hrs;
        const color = overviewColor(i);
        const dist = units.dist(totalDistMi).toFixed(1);
        const gain = Math.round(units.elev(elevGainFt)).toLocaleString();
        const h = Math.floor(hrs);
        const m = Math.round((hrs - h) * 60);
        return `
          <tr data-day="${d.day}" style="cursor:pointer;">
            <td><span class="day-swatch" style="background:${color};"></span>Day ${d.day}</td>
            <td>${d.dateLabel}</td>
            <td>${d.name}</td>
            <td>${dist} ${units.distUnit()}</td>
            <td>${gain} ${units.elevUnit()}</td>
            <td>${h}h ${m}m</td>
          </tr>`;
    }).join('');

    const totH = Math.floor(totalHrs);
    const totM = Math.round((totalHrs - totH) * 60);
    container.innerHTML = `
      <table>
        <thead>
          <tr><th>Day</th><th>Date</th><th>Route</th><th>Distance</th><th>Gain</th><th>Est. time</th></tr>
        </thead>
        <tbody>
          ${rows}
          <tr class="total-row">
            <td colspan="3">Total</td>
            <td>${units.dist(totalMi).toFixed(1)} ${units.distUnit()}</td>
            <td>${Math.round(units.elev(totalGain)).toLocaleString()} ${units.elevUnit()}</td>
            <td>${totH}h ${totM}m</td>
          </tr>
        </tbody>
      </table>
    `;
    container.querySelectorAll('tr[data-day]').forEach((tr) => {
        tr.addEventListener('click', () => selectDay(parseInt(tr.dataset.day)));
    });
}

// --- Pace control ---

async function handlePaceChange(newPace) {
    pace = newPace;
    localStorage.setItem(PACE_KEY, String(newPace));
    document.getElementById('pace-value').textContent =
        `${Math.round(units.speed(pace))} ${units.speedUnit()}`;

    // If a flyover is in progress, rescale its duration to the new pace
    // while preserving current position.
    if (flyover.getState() !== 'stopped') {
        flyover.setDuration(flyoverDurationForPace(pace));
    }

    if (currentDay === 'overview') {
        // Re-render the table with the new pace
        const loaded = DAYS.map((d) => ({ ...d, routeData: routeCache.get(d.day)?.routeData }))
                           .filter((d) => d.routeData);
        renderOverviewTable(loaded);
        return;
    }

    if (lastRouteData && lastDay) {
        updateRouteInfo(lastRouteData, lastDay);
        // Recompute arrival-hour weather (raw hourly data is cached — no network hit)
        if (lastSampled) {
            try {
                const wx = await recomputeForPace(lastSampled, lastDay.date, pace, DEFAULT_START_HOUR);
                lastWeatherPoints = wx;
                renderRoute(lastRouteData, wx);
            } catch (e) { /* ignore */ }
        }
    }
}

// --- Hash / deep-links ---

function parseHash() {
    const h = (window.location.hash || '').replace(/^#/, '');
    const m = h.match(/day=(overview|\d+)/);
    if (!m) return null;
    return m[1] === 'overview' ? 'overview' : parseInt(m[1]);
}

function initialDay() {
    const fromHash = parseHash();
    if (fromHash === 'overview' || (typeof fromHash === 'number' && DAYS.some((d) => d.day === fromHash))) {
        return fromHash;
    }
    const stored = localStorage.getItem(LAST_DAY_KEY);
    if (stored === 'overview') return 'overview';
    const storedNum = parseInt(stored);
    if (DAYS.some((d) => d.day === storedNum)) return storedNum;
    return 1;
}

// --- Keyboard ---

function onKeyDown(e) {
    if (e.target.matches('input, textarea, [contenteditable]')) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;

    const dayNums = DAYS.map((d) => d.day);
    const idx = typeof currentDay === 'number' ? dayNums.indexOf(currentDay) : -1;

    if (e.key === 'ArrowRight') {
        if (currentDay === 'overview') selectDay(DAYS[0].day);
        else if (idx >= 0 && idx < dayNums.length - 1) selectDay(dayNums[idx + 1]);
        e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
        if (idx > 0) selectDay(dayNums[idx - 1]);
        else if (idx === 0) selectDay('overview');
        e.preventDefault();
    } else if (/^[1-9]$/.test(e.key)) {
        const n = parseInt(e.key);
        if (dayNums.includes(n)) { selectDay(n); e.preventDefault(); }
    } else if (e.key === '0' || e.key.toLowerCase() === 'o') {
        selectDay('overview');
        e.preventDefault();
    } else if (e.key === 'Escape') {
        if (selectedClimbIdx !== null) {
            deselectClimb();
            e.preventDefault();
        }
    }
}

// --- Flyover playback ---

// Playback duration scales with pace: 30s at 13 mph (reference), proportionally
// shorter when faster and longer when slower. Clamped so it's never absurd.
const FLYOVER_BASE_MS = 30_000;
const FLYOVER_REF_PACE = 13;
function flyoverDurationForPace(p) {
    const raw = FLYOVER_BASE_MS * (FLYOVER_REF_PACE / Math.max(1, p));
    return Math.max(12_000, Math.min(60_000, raw));
}

function setupFlyoverUI() {
    const btn = document.getElementById('flyover-btn');
    const playIcon = btn.querySelector('.flyover-play');
    const pauseIcon = btn.querySelector('.flyover-pause');
    const hud = document.getElementById('flyover-hud');
    const stopBtn = document.getElementById('flyover-stop');
    const progressEl = document.getElementById('flyover-progress');
    const barEl = document.getElementById('flyover-bar');
    const distEl = document.getElementById('flyover-dist');
    const clockEl = document.getElementById('flyover-clock');

    function togglePlay() {
        if (currentDay === 'overview' || !lastRouteData) return;
        const s = flyover.getState();
        if (s === 'stopped') {
            flyover.start(lastRouteData, { durationMs: flyoverDurationForPace(pace) });
        } else if (s === 'playing') {
            flyover.pause();
        } else if (s === 'paused') {
            flyover.resume();
        }
    }

    btn.addEventListener('click', togglePlay);
    stopBtn.addEventListener('click', () => flyover.stop());

    // Click-to-seek on the progress bar
    barEl.addEventListener('click', (e) => {
        const rect = barEl.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        flyover.seek(frac);
    });

    // Space bar toggles when no form field is focused
    document.addEventListener('keydown', (e) => {
        if (e.key !== ' ' && e.code !== 'Space') return;
        if (e.target.matches('input, textarea, [contenteditable], button')) return;
        if (currentDay === 'overview' || !lastRouteData) return;
        e.preventDefault();
        togglePlay();
    });

    flyover.onStateChange((s) => {
        const playing = s === 'playing';
        btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
        playIcon.style.display = playing ? 'none' : '';
        pauseIcon.style.display = playing ? '' : 'none';
        btn.title = playing ? 'Pause flyover' : (s === 'paused' ? 'Resume flyover' : 'Fly the route');
        if (s === 'stopped') {
            hud.hidden = true;
            progressEl.style.width = '0%';
        } else {
            hud.hidden = false;
        }
    });

    flyover.onUpdate(({ fraction, dist }) => {
        progressEl.style.width = (fraction * 100).toFixed(2) + '%';
        distEl.textContent = `${units.dist(dist).toFixed(1)} ${units.distUnit()}`;
        // Clock uses real ride pace (not compressed playback time) so it
        // matches the "~finish time" shown in the header.
        const hoursOffset = dist / pace;
        clockEl.textContent = units.formatClock(DEFAULT_START_HOUR, hoursOffset);
    });
}

// --- Init ---

window.addEventListener('chart-hover', (e) => {
    const { lat, lon, dist } = e.detail;
    highlightPoint(lat, lon, dist);
});

window.addEventListener('overview-day-click', (e) => {
    selectDay(e.detail.day);
});

window.addEventListener('hashchange', () => {
    const h = parseHash();
    if (h !== null && h !== currentDay) selectDay(h);
});

document.addEventListener('DOMContentLoaded', () => {
    initMap('map');
    buildNav();

    // Prefetch link: point to the initial day's GPX for faster first load
    const start = initialDay();
    const prefetchEl = document.getElementById('route-prefetch');
    if (prefetchEl && typeof start === 'number') {
        const day = DAYS.find((d) => d.day === start);
        if (day) prefetchEl.href = day.file;
    }

    // Unit toggle — restore saved preference
    const unitSwitch = document.getElementById('unit-switch');
    const unitLabel = unitSwitch.nextElementSibling;
    if (!units.isMetric()) {
        unitSwitch.checked = true;
        unitLabel.textContent = unitLabel.dataset.imperial;
    }
    unitSwitch.addEventListener('change', () => {
        const imperial = unitSwitch.checked;
        units.setMetric(!imperial);
        unitLabel.textContent = imperial ? unitLabel.dataset.imperial : unitLabel.dataset.metric;
    });

    // Pace slider
    const paceSlider = document.getElementById('pace-slider');
    const paceValue = document.getElementById('pace-value');
    paceSlider.value = String(pace);
    paceValue.textContent = `${Math.round(units.speed(pace))} ${units.speedUnit()}`;
    paceSlider.addEventListener('input', () => {
        paceValue.textContent = `${Math.round(units.speed(parseFloat(paceSlider.value)))} ${units.speedUnit()}`;
    });
    paceSlider.addEventListener('change', () => {
        handlePaceChange(parseFloat(paceSlider.value));
    });

    // Refresh weather
    document.getElementById('refresh-weather').addEventListener('click', async () => {
        clearWeatherCache();
        showToast('Refreshing weather…');
        const activeDay = currentDay;
        currentDay = null;
        await selectDay(activeDay);
        // Re-prefetch day summaries with fresh data
        DAYS.forEach((d) => {
            const pill = document.querySelector(`.day-wx[data-day="${d.day}"]`);
            if (pill) { pill.classList.add('loading'); pill.innerHTML = '&nbsp;'; }
        });
        prefetchDaySummaries();
    });

    // Flyover playback
    setupFlyoverUI();

    // Keyboard navigation
    document.addEventListener('keydown', onKeyDown);

    // Re-render displays when units change
    units.onUnitsChange(() => {
        if (currentDay === 'overview') {
            const loaded = DAYS.map((d) => ({ ...d, routeData: routeCache.get(d.day)?.routeData }))
                               .filter((d) => d.routeData);
            if (loaded.length) renderOverviewTable(loaded);
        } else if (lastRouteData && lastDay) {
            updateRouteInfo(lastRouteData, lastDay);
            renderElevationProfile(lastRouteData, 'elevation-chart');
            renderClimbs(currentClimbs);
        }
        // Update pace display in new units
        paceValue.textContent = `${Math.round(units.speed(pace))} ${units.speedUnit()}`;
        refreshAllDayWxPills();
        refreshMileMarkers();
    });

    selectDay(start);
    prefetchDaySummaries();
});
