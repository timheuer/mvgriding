const CACHE_PREFIX = 'wx2_';
const PACE_MPH = 13;
const START_HOUR = 8; // 8 AM local

function cacheKey(lat, lon, date) {
    return `${CACHE_PREFIX}${lat.toFixed(2)}_${lon.toFixed(2)}_${date}`;
}

function getCache(key) {
    try {
        const raw = sessionStorage.getItem(key);
        if (raw) return JSON.parse(raw);
    } catch (_) { }
    return null;
}

function setCache(key, value) {
    try {
        sessionStorage.setItem(key, JSON.stringify(value));
    } catch (_) { }
}

export async function fetchWeatherForPoints(sampledPoints, dateStr) {
    // dateStr like "2026-04-19"
    // Use HRRR (3km) for wind, ECMWF IFS (0.25°) for temperature — closest to Apple WeatherKit
    const results = [];

    for (const pt of sampledPoints) {
        const key = cacheKey(pt.lat, pt.lon, dateStr);
        const cached = getCache(key);
        if (cached) {
            results.push(cached);
            continue;
        }

        // Estimate the hour we'd arrive at this point
        const hoursFromStart = pt.dist / PACE_MPH;
        const arrivalHour = Math.min(23, Math.floor(START_HOUR + hoursFromStart));

        const latStr = pt.lat.toFixed(4);
        const lonStr = pt.lon.toFixed(4);
        const baseParams =
            `latitude=${latStr}&longitude=${lonStr}` +
            `&temperature_unit=fahrenheit&wind_speed_unit=mph` +
            `&start_date=${dateStr}&end_date=${dateStr}` +
            `&timezone=America%2FDenver`;

        let temp = null;
        let windSpeed = null;
        let windDir = null;
        let available = false;
        let windModel = null;
        let tempModel = null;

        try {
            // Fetch HRRR for wind (3km resolution, best US wind model)
            // and ECMWF for temperature (best global model) in parallel
            const [hrrrResp, ecmwfResp] = await Promise.all([
                fetch(
                    `https://api.open-meteo.com/v1/forecast?${baseParams}` +
                    `&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
                    `&models=gfs_hrrr`
                ),
                fetch(
                    `https://api.open-meteo.com/v1/forecast?${baseParams}` +
                    `&hourly=temperature_2m` +
                    `&models=ecmwf_ifs025`
                ),
            ]);

            const idx = arrivalHour;

            if (hrrrResp.ok) {
                const hrrrData = await hrrrResp.json();
                const h = hrrrData.hourly;
                windSpeed = h?.wind_speed_10m?.[idx] ?? null;
                windDir = h?.wind_direction_10m?.[idx] ?? null;
                windModel = 'HRRR';
                available = true;
            }

            if (ecmwfResp.ok) {
                const ecmwfData = await ecmwfResp.json();
                const h = ecmwfData.hourly;
                temp = h?.temperature_2m?.[idx] ?? null;
                tempModel = 'ECMWF';
                available = true;
            }

            // Fallback: if either model failed, try default GFS for missing data
            if (windSpeed === null || temp === null) {
                const fallbackResp = await fetch(
                    `https://api.open-meteo.com/v1/forecast?${baseParams}` +
                    `&hourly=temperature_2m,wind_speed_10m,wind_direction_10m`
                );
                if (fallbackResp.ok) {
                    const fbData = await fallbackResp.json();
                    const h = fbData.hourly;
                    if (windSpeed === null) {
                        windSpeed = h?.wind_speed_10m?.[idx] ?? null;
                        windDir = h?.wind_direction_10m?.[idx] ?? null;
                        windModel = 'GFS';
                    }
                    if (temp === null) {
                        temp = h?.temperature_2m?.[idx] ?? null;
                        tempModel = 'GFS';
                    }
                    available = true;
                }
            }
        } catch (e) {
            console.warn('Weather fetch failed for point:', pt, e);
        }

        const entry = {
            lat: pt.lat,
            lon: pt.lon,
            dist: pt.dist,
            temp,
            windSpeed,
            windDir,
            hour: arrivalHour,
            available,
            windModel,
            tempModel,
        };

        setCache(key, entry);
        results.push(entry);

        // Small delay to avoid rate limiting
        await new Promise((r) => setTimeout(r, 80));
    }

    return results;
}

export function interpolateWeather(weatherPoints, dist) {
    if (!weatherPoints || weatherPoints.length === 0) {
        return { temp: null, windSpeed: null, windDir: null, available: false };
    }

    // Find the two bracketing weather points
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

    // Interpolate wind direction circularly
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
