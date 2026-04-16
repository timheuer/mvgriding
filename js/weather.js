const CACHE_PREFIX = 'wx3_';
const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
const BATCH_SIZE = 6;
export const DEFAULT_PACE_MPH = 13;
export const DEFAULT_START_HOUR = 8;

function cacheKey(lat, lon, date) {
    return `${CACHE_PREFIX}${lat.toFixed(2)}_${lon.toFixed(2)}_${date}`;
}

function getCache(key) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed.ts || Date.now() - parsed.ts > CACHE_TTL_MS) {
            localStorage.removeItem(key);
            return null;
        }
        return parsed.data;
    } catch (_) { return null; }
}

function setCache(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: value }));
    } catch (_) { /* quota — drop silently */ }
}

// Clear all cached weather entries (used by manual refresh)
export function clearWeatherCache() {
    try {
        const toDelete = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && (k.startsWith(CACHE_PREFIX) || k.startsWith('wx4sum_') || k.startsWith('wx3sum_'))) toDelete.push(k);
        }
        toDelete.forEach((k) => localStorage.removeItem(k));
    } catch (_) { }
}

async function fetchRawHourly(lat, lon, dateStr) {
    // Fetch full day's hourly forecast for a point. Cached per (lat, lon, date).
    const key = cacheKey(lat, lon, dateStr);
    const cached = getCache(key);
    if (cached) return cached;

    const baseParams =
        `latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
        `&temperature_unit=fahrenheit&wind_speed_unit=mph` +
        `&start_date=${dateStr}&end_date=${dateStr}` +
        `&timezone=America%2FDenver`;

    const entry = {
        lat, lon,
        temp: new Array(24).fill(null),
        windSpeed: new Array(24).fill(null),
        windDir: new Array(24).fill(null),
        windModel: null,
        tempModel: null,
        available: false,
    };

    try {
        const [hrrrResp, ecmwfResp] = await Promise.all([
            fetch(`https://api.open-meteo.com/v1/forecast?${baseParams}&hourly=wind_speed_10m,wind_direction_10m&models=gfs_hrrr`),
            fetch(`https://api.open-meteo.com/v1/forecast?${baseParams}&hourly=temperature_2m&models=ecmwf_ifs025`),
        ]);

        if (hrrrResp.ok) {
            const h = (await hrrrResp.json()).hourly;
            if (h?.wind_speed_10m) {
                for (let i = 0; i < Math.min(24, h.wind_speed_10m.length); i++) {
                    entry.windSpeed[i] = h.wind_speed_10m[i] ?? null;
                    entry.windDir[i] = h.wind_direction_10m?.[i] ?? null;
                }
                entry.windModel = 'HRRR';
                entry.available = true;
            }
        }
        if (ecmwfResp.ok) {
            const h = (await ecmwfResp.json()).hourly;
            if (h?.temperature_2m) {
                for (let i = 0; i < Math.min(24, h.temperature_2m.length); i++) {
                    entry.temp[i] = h.temperature_2m[i] ?? null;
                }
                entry.tempModel = 'ECMWF';
                entry.available = true;
            }
        }

        // Fallback: fill gaps with GFS default
        const needsFallback =
            entry.windSpeed.every((v) => v === null) ||
            entry.temp.every((v) => v === null);
        if (needsFallback) {
            const fbResp = await fetch(`https://api.open-meteo.com/v1/forecast?${baseParams}&hourly=temperature_2m,wind_speed_10m,wind_direction_10m`);
            if (fbResp.ok) {
                const h = (await fbResp.json()).hourly;
                for (let i = 0; i < 24; i++) {
                    if (entry.windSpeed[i] === null) {
                        entry.windSpeed[i] = h?.wind_speed_10m?.[i] ?? null;
                        entry.windDir[i] = h?.wind_direction_10m?.[i] ?? null;
                    }
                    if (entry.temp[i] === null) entry.temp[i] = h?.temperature_2m?.[i] ?? null;
                }
                if (!entry.windModel) entry.windModel = 'GFS';
                if (!entry.tempModel) entry.tempModel = 'GFS';
                entry.available = true;
            }
        }
    } catch (e) {
        console.warn('Weather fetch failed:', e);
    }

    setCache(key, entry);
    return entry;
}

// Compute arrival hour from distance / pace / start
function arrivalHour(distMi, paceMph, startHour) {
    const hoursFromStart = distMi / Math.max(1, paceMph);
    return Math.min(23, Math.floor(startHour + hoursFromStart));
}

// Fetch weather for sampled points, in parallel batches.
// opts: { pace, startHour, onProgress(done, total) }
export async function fetchWeatherForPoints(sampledPoints, dateStr, opts = {}) {
    const pace = opts.pace ?? DEFAULT_PACE_MPH;
    const startHour = opts.startHour ?? DEFAULT_START_HOUR;
    const onProgress = opts.onProgress;

    const results = new Array(sampledPoints.length);
    let done = 0;
    onProgress?.(0, sampledPoints.length);

    for (let batchStart = 0; batchStart < sampledPoints.length; batchStart += BATCH_SIZE) {
        const batch = sampledPoints.slice(batchStart, batchStart + BATCH_SIZE);
        await Promise.all(batch.map(async (pt, i) => {
            const raw = await fetchRawHourly(pt.lat, pt.lon, dateStr);
            const hour = arrivalHour(pt.dist, pace, startHour);
            results[batchStart + i] = {
                lat: pt.lat,
                lon: pt.lon,
                dist: pt.dist,
                temp: raw.temp[hour] ?? null,
                windSpeed: raw.windSpeed[hour] ?? null,
                windDir: raw.windDir[hour] ?? null,
                hour,
                available: raw.available,
                windModel: raw.windModel,
                tempModel: raw.tempModel,
            };
            done++;
            onProgress?.(done, sampledPoints.length);
        }));
    }
    return results;
}

// Re-derive arrival-hour weather from already-fetched points without refetching.
// Used when pace changes — the raw hourly cache survives, so no network hit.
export async function recomputeForPace(sampledPoints, dateStr, pace, startHour = DEFAULT_START_HOUR) {
    const results = [];
    for (const pt of sampledPoints) {
        const raw = await fetchRawHourly(pt.lat, pt.lon, dateStr);
        const hour = arrivalHour(pt.dist, pace, startHour);
        results.push({
            lat: pt.lat, lon: pt.lon, dist: pt.dist,
            temp: raw.temp[hour] ?? null,
            windSpeed: raw.windSpeed[hour] ?? null,
            windDir: raw.windDir[hour] ?? null,
            hour, available: raw.available,
            windModel: raw.windModel, tempModel: raw.tempModel,
        });
    }
    return results;
}

// Lightweight one-call daily summary for a single point (used on day-buttons).
// Fetches daily min/max plus hourly temperature+wind so callers can look up the
// value at an estimated arrival hour without refetching when pace changes.
export async function fetchDaySummary(lat, lon, dateStr) {
    const key = `wx4sum_${lat.toFixed(2)}_${lon.toFixed(2)}_${dateStr}`;
    try {
        const raw = localStorage.getItem(key);
        if (raw) {
            const p = JSON.parse(raw);
            if (p.ts && Date.now() - p.ts < CACHE_TTL_MS) return p.data;
        }
    } catch (_) { }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}` +
        `&daily=temperature_2m_max,temperature_2m_min,wind_speed_10m_max,weather_code` +
        `&hourly=temperature_2m,wind_speed_10m` +
        `&temperature_unit=fahrenheit&wind_speed_unit=mph` +
        `&start_date=${dateStr}&end_date=${dateStr}&timezone=America%2FDenver`;
    try {
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const json = await resp.json();
        const d = json.daily;
        const h = json.hourly;
        const out = {
            tempMax: d?.temperature_2m_max?.[0] ?? null,
            tempMin: d?.temperature_2m_min?.[0] ?? null,
            windMax: d?.wind_speed_10m_max?.[0] ?? null,
            weatherCode: d?.weather_code?.[0] ?? null,
            hourlyTemp: h?.temperature_2m ?? null,
            hourlyWind: h?.wind_speed_10m ?? null,
        };
        try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: out })); } catch (_) { }
        return out;
    } catch (_) {
        return null;
    }
}

export function weatherCodeIcon(code) {
    if (code === null || code === undefined) return '';
    if (code === 0) return '☀️';
    if (code <= 2) return '🌤';
    if (code === 3) return '☁️';
    if (code >= 45 && code <= 48) return '🌫';
    if (code >= 51 && code <= 67) return '🌧';
    if (code >= 71 && code <= 77) return '🌨';
    if (code >= 80 && code <= 82) return '🌦';
    if (code >= 95) return '⛈';
    return '🌡';
}

export function interpolateWeather(weatherPoints, dist) {
    if (!weatherPoints || weatherPoints.length === 0) {
        return { temp: null, windSpeed: null, windDir: null, available: false };
    }

    let before = weatherPoints[0];
    let after = weatherPoints[weatherPoints.length - 1];

    for (let i = 0; i < weatherPoints.length - 1; i++) {
        if (weatherPoints[i].dist <= dist && weatherPoints[i + 1].dist >= dist) {
            before = weatherPoints[i];
            after = weatherPoints[i + 1];
            break;
        }
    }

    if (before === after || after.dist - before.dist < 0.01) {
        return before;
    }

    const frac = (dist - before.dist) / (after.dist - before.dist);

    function lerp(a, b) {
        if (a === null || b === null) return null;
        return a + (b - a) * frac;
    }

    let windDir = null;
    if (before.windDir !== null && after.windDir !== null) {
        let diff = after.windDir - before.windDir;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        windDir = (before.windDir + diff * frac + 360) % 360;
    }

    return {
        temp: lerp(before.temp, after.temp),
        windSpeed: lerp(before.windSpeed, after.windSpeed),
        windDir,
        available: before.available && after.available,
        windModel: before.windModel || after.windModel,
        tempModel: before.tempModel || after.tempModel,
    };
}

export function windDirLabel(deg) {
    if (deg === null) return '—';
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
        'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return dirs[Math.round(deg / 22.5) % 16];
}
