const METERS_TO_FEET = 3.28084;
const EARTH_RADIUS_MI = 3958.8;

function toRad(deg) {
    return (deg * Math.PI) / 180;
}

function haversine(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return EARTH_RADIUS_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function parseGPX(xmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'application/xml');
    const ns = 'http://www.topografix.com/GPX/1/1';

    const name =
        doc.getElementsByTagNameNS(ns, 'name')[0]?.textContent || 'Unnamed Route';

    // Try track points first, fall back to route points
    let points = Array.from(doc.getElementsByTagNameNS(ns, 'trkpt'));
    let isRoute = false;
    if (points.length === 0) {
        points = Array.from(doc.getElementsByTagNameNS(ns, 'rtept'));
        isRoute = true;
    }

    const trackpoints = points.map((pt) => {
        const lat = parseFloat(pt.getAttribute('lat'));
        const lon = parseFloat(pt.getAttribute('lon'));
        const eleNode = pt.getElementsByTagNameNS(ns, 'ele')[0];
        const ele = eleNode ? parseFloat(eleNode.textContent) : null;
        const cmt = pt.getElementsByTagNameNS(ns, 'cmt')[0]?.textContent || null;
        return { lat, lon, ele, cmt };
    });

    return { name, trackpoints, isRoute };
}

export function computeRouteData(trackpoints) {
    let cumDist = 0;
    const result = [];

    for (let i = 0; i < trackpoints.length; i++) {
        const pt = trackpoints[i];
        if (i > 0) {
            const prev = trackpoints[i - 1];
            cumDist += haversine(prev.lat, prev.lon, pt.lat, pt.lon);
        }

        let grade = 0;
        if (i > 0 && pt.ele !== null && trackpoints[i - 1].ele !== null) {
            const segDist = haversine(
                trackpoints[i - 1].lat,
                trackpoints[i - 1].lon,
                pt.lat,
                pt.lon
            );
            if (segDist > 0.001) {
                const eleChangeFt =
                    (pt.ele - trackpoints[i - 1].ele) * METERS_TO_FEET;
                const segDistFt = segDist * 5280;
                grade = (eleChangeFt / segDistFt) * 100;
            }
        }

        result.push({
            lat: pt.lat,
            lon: pt.lon,
            ele: pt.ele,
            eleFt: pt.ele !== null ? pt.ele * METERS_TO_FEET : null,
            dist: cumDist,
            grade: Math.round(grade * 10) / 10,
            cmt: pt.cmt,
        });
    }

    return result;
}

export async function fetchElevations(trackpoints) {
    // For route-format GPX files with no elevation data, fetch from Open-Meteo
    const lats = trackpoints.map((p) => p.lat).join(',');
    const lons = trackpoints.map((p) => p.lon).join(',');
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;

    try {
        const resp = await fetch(url);
        const data = await resp.json();
        if (data.elevation) {
            return trackpoints.map((pt, i) => ({
                ...pt,
                ele: data.elevation[i],
            }));
        }
    } catch (e) {
        console.warn('Failed to fetch elevations:', e);
    }
    return trackpoints;
}

export function samplePoints(routeData, intervalMiles) {
    if (routeData.length === 0) return [];
    const samples = [routeData[0]];
    let nextDist = intervalMiles;
    const totalDist = routeData[routeData.length - 1].dist;

    for (let i = 1; i < routeData.length; i++) {
        while (routeData[i].dist >= nextDist && nextDist <= totalDist) {
            // Interpolate between i-1 and i
            const prev = routeData[i - 1];
            const curr = routeData[i];
            const frac =
                curr.dist - prev.dist > 0
                    ? (nextDist - prev.dist) / (curr.dist - prev.dist)
                    : 0;
            samples.push({
                lat: prev.lat + (curr.lat - prev.lat) * frac,
                lon: prev.lon + (curr.lon - prev.lon) * frac,
                ele: prev.ele !== null && curr.ele !== null
                    ? prev.ele + (curr.ele - prev.ele) * frac
                    : null,
                eleFt: prev.eleFt !== null && curr.eleFt !== null
                    ? prev.eleFt + (curr.eleFt - prev.eleFt) * frac
                    : null,
                dist: nextDist,
                grade: prev.grade,
            });
            nextDist += intervalMiles;
        }
    }
    // Always include last point
    const last = routeData[routeData.length - 1];
    if (samples[samples.length - 1].dist < last.dist - 0.1) {
        samples.push(last);
    }
    return samples;
}

export function findNearest(routeData, lat, lon) {
    let minDist = Infinity;
    let closest = routeData[0];
    for (const pt of routeData) {
        const d = (pt.lat - lat) ** 2 + (pt.lon - lon) ** 2;
        if (d < minDist) {
            minDist = d;
            closest = pt;
        }
    }
    return closest;
}
