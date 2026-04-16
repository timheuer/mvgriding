import { findNearest, samplePoints, routeBearingAt, windComponents } from './gpx.js';
import { interpolateWeather, windDirLabel } from './weather.js';
import * as units from './units.js';

let map = null;
let routeLayer = null;
let windLayer = null;
let milemarkerLayer = null;
let overviewLayer = null;
let hoverMarker = null;
let flyoverMarker = null;
let climbHighlightLayer = null;
let tooltipEl = null;
let currentRouteData = null;
let currentWeatherPoints = null;
let mapHoverHandler = null;

export function initMap(containerId) {
    map = L.map(containerId, {
        zoomControl: true,
        attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 18,
    }).addTo(map);

    tooltipEl = document.getElementById('map-tooltip');
    return map;
}

export function clearMap() {
    if (mapHoverHandler) {
        map.off('mousemove', mapHoverHandler);
        map.off('mouseout', mapMouseOut);
        mapHoverHandler = null;
    }
    if (routeLayer) {
        map.removeLayer(routeLayer);
        routeLayer = null;
    }
    if (windLayer) {
        map.removeLayer(windLayer);
        windLayer = null;
    }
    if (milemarkerLayer) {
        map.removeLayer(milemarkerLayer);
        milemarkerLayer = null;
    }
    if (overviewLayer) {
        map.removeLayer(overviewLayer);
        overviewLayer = null;
    }
    if (hoverMarker) {
        map.removeLayer(hoverMarker);
        hoverMarker = null;
    }
    if (flyoverMarker) {
        map.removeLayer(flyoverMarker);
        flyoverMarker = null;
    }
    if (climbHighlightLayer) {
        map.removeLayer(climbHighlightLayer);
        climbHighlightLayer = null;
    }
    if (tooltipEl) tooltipEl.style.display = 'none';
    currentRouteData = null;
    currentWeatherPoints = null;
}

function addLegend() {
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = function () {
        const div = L.DomUtil.create('div', 'map-legend');
        div.innerHTML = `
            <div class="legend-item"><span class="legend-line" style="background:#2563eb;"></span> Route</div>
            <div class="legend-item"><span class="legend-dot" style="background:#16a34a;"></span> Start</div>
            <div class="legend-item"><span class="legend-dot" style="background:#dc2626;"></span> Finish</div>
            <div class="legend-item"><svg class="legend-icon" viewBox="0 0 12 12"><polyline points="2,9 6,3 10,9" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round"/></svg> Direction</div>
            <div class="legend-item"><span class="legend-mile">5</span> Distance</div>
            <div class="legend-item"><svg class="legend-icon" viewBox="0 0 24 24"><line x1="12" y1="20" x2="12" y2="4" stroke="#475569" stroke-width="2.5" stroke-linecap="round"/><polyline points="7,9 12,3 17,9" fill="none" stroke="#475569" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Wind</div>
        `;
        return div;
    };
    legend.addTo(map);
    return legend;
}

let legendControl = null;

export function renderRoute(routeData, weatherPoints) {
    clearMap();

    // Stamp index for fast bearing lookups during hover
    routeData.forEach((pt, i) => { pt.__idx = i; });

    currentRouteData = routeData;
    currentWeatherPoints = weatherPoints;

    const latlngs = routeData.map((pt) => [pt.lat, pt.lon]);
    routeLayer = L.layerGroup().addTo(map);

    // Main route line
    const polyline = L.polyline(latlngs, {
        color: '#2563eb',
        weight: 4,
        opacity: 0.85,
    }).addTo(routeLayer);

    // Directional arrows along the route every mile
    renderDirectionArrows(routeData);

    // Distance markers every 5 mi/km
    renderMileMarkers(routeData);

    // Start/end markers
    if (routeData.length > 0) {
        const start = routeData[0];
        const end = routeData[routeData.length - 1];

        L.circleMarker([start.lat, start.lon], {
            radius: 7,
            color: '#16a34a',
            fillColor: '#16a34a',
            fillOpacity: 1,
            weight: 2,
        })
            .bindTooltip('Start', { permanent: false })
            .addTo(routeLayer);

        L.circleMarker([end.lat, end.lon], {
            radius: 7,
            color: '#dc2626',
            fillColor: '#dc2626',
            fillOpacity: 1,
            weight: 2,
        })
            .bindTooltip('Finish', { permanent: false })
            .addTo(routeLayer);
    }

    // Hover marker (start hidden)
    const startPt = routeData[0];
    hoverMarker = L.circleMarker([startPt.lat, startPt.lon], {
        radius: 6,
        color: '#1e40af',
        fillColor: '#fff',
        fillOpacity: 0,
        weight: 2,
        opacity: 0,
    }).addTo(routeLayer);

    // Map-level hover: detect proximity to route within a pixel threshold
    const HOVER_PX_THRESHOLD = 20;

    mapHoverHandler = function (e) {
        const mousePoint = map.latLngToContainerPoint(e.latlng);
        const nearest = findNearest(routeData, e.latlng.lat, e.latlng.lng);
        const nearestPoint = map.latLngToContainerPoint([nearest.lat, nearest.lon]);
        const pxDist = mousePoint.distanceTo(nearestPoint);

        if (pxDist <= HOVER_PX_THRESHOLD) {
            hoverMarker.setLatLng([nearest.lat, nearest.lon]);
            hoverMarker.setStyle({ opacity: 1, fillOpacity: 1 });

            const wx = interpolateWeather(currentWeatherPoints, nearest.dist);
            showTooltip(e.originalEvent, nearest, wx);

            window.dispatchEvent(
                new CustomEvent('route-hover', { detail: { dist: nearest.dist } })
            );
        } else {
            hoverMarker.setStyle({ opacity: 0, fillOpacity: 0 });
            if (tooltipEl) tooltipEl.style.display = 'none';
            window.dispatchEvent(
                new CustomEvent('route-hover', { detail: { dist: null } })
            );
        }
    };

    map.on('mousemove', mapHoverHandler);
    map.on('mouseout', mapMouseOut);

    // Fit map to route
    const bounds = polyline.getBounds().pad(0.05);
    map.fitBounds(bounds);

    // Render wind arrows
    if (weatherPoints && weatherPoints.length > 0) {
        renderWindArrows(weatherPoints);
    }

    // Add legend
    if (!legendControl) {
        legendControl = addLegend();
    }
}

function mapMouseOut() {
    if (hoverMarker) hoverMarker.setStyle({ opacity: 0, fillOpacity: 0 });
    if (tooltipEl) tooltipEl.style.display = 'none';
    window.dispatchEvent(
        new CustomEvent('route-hover', { detail: { dist: null } })
    );
}

function showTooltip(event, pt, wx) {
    if (!tooltipEl) return;

    const displayDist = units.dist(pt.dist);
    const distLabel = units.isMetric() ? 'Km' : 'Mile';
    const eleDisplay =
        pt.eleFt !== null ? `${Math.round(units.elev(pt.eleFt)).toLocaleString()} ${units.elevUnit()}` : '—';
    const grade = pt.grade !== undefined ? `${pt.grade}%` : '—';
    const tempDisplay =
        wx.temp !== null ? `${Math.round(units.temp(wx.temp))}${units.tempUnit()}` : 'No forecast';
    const windDisplay =
        wx.windSpeed !== null
            ? `${Math.round(units.speed(wx.windSpeed))} ${units.speedUnit()} ${windDirLabel(wx.windDir)}`
            : 'No forecast';

    // Headwind / tailwind relative to route direction
    let windComp = '';
    if (currentRouteData && wx.windSpeed !== null && wx.windDir !== null && pt.__idx !== undefined) {
        const rb = routeBearingAt(currentRouteData, pt.__idx);
        const comp = windComponents(wx.windDir, rb, wx.windSpeed);
        if (comp) {
            const mag = Math.abs(comp.headwind);
            if (mag >= 1.5) {
                const arrow = comp.headwind > 0 ? '↓' : '↑';
                const kind = comp.headwind > 0 ? 'headwind' : 'tailwind';
                const speed = Math.round(units.speed(mag));
                windComp = `<div class="tt-row"><span class="tt-label">Effect</span><span class="tt-value">${arrow} ${speed} ${units.speedUnit()} ${kind}</span></div>`;
            } else {
                windComp = `<div class="tt-row"><span class="tt-label">Effect</span><span class="tt-value">crosswind</span></div>`;
            }
        }
    }

    const modelInfo =
        wx.windModel || wx.tempModel
            ? `${wx.tempModel || '—'} temp · ${wx.windModel || '—'} wind`
            : '';

    tooltipEl.innerHTML = `
    <div class="tt-row"><span class="tt-label">${distLabel}</span><span class="tt-value">${displayDist.toFixed(1)}</span></div>
    <div class="tt-row"><span class="tt-label">Elevation</span><span class="tt-value">${eleDisplay}</span></div>
    <div class="tt-row"><span class="tt-label">Grade</span><span class="tt-value">${grade}</span></div>
    <div class="tt-row"><span class="tt-label">Temp</span><span class="tt-value">${tempDisplay}</span></div>
    <div class="tt-row"><span class="tt-label">Wind</span><span class="tt-value">${windDisplay}</span></div>
    ${windComp}
    ${modelInfo ? `<div class="tt-source">${modelInfo}</div>` : ''}
  `;

    const mapRect = map.getContainer().getBoundingClientRect();
    let x = event.clientX - mapRect.left + 16;
    let y = event.clientY - mapRect.top - 10;

    // Keep tooltip in view
    const ttW = 180;
    const ttH = 160;
    if (x + ttW > mapRect.width) x = x - ttW - 32;
    if (y + ttH > mapRect.height) y = mapRect.height - ttH - 8;
    if (y < 0) y = 8;

    tooltipEl.style.left = x + 'px';
    tooltipEl.style.top = y + 'px';
    tooltipEl.style.display = 'block';
}

function bearing(lat1, lon1, lat2, lon2) {
    const toRad = (d) => (d * Math.PI) / 180;
    const toDeg = (r) => (r * 180) / Math.PI;
    const dLon = toRad(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(toRad(lat2));
    const x =
        Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
        Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function renderDirectionArrows(routeData) {
    const INTERVAL = 1; // miles
    const sampled = samplePoints(routeData, INTERVAL);
    const size = 12;

    for (let i = 0; i < sampled.length; i++) {
        const pt = sampled[i];
        let deg;
        if (i < sampled.length - 1) {
            deg = bearing(pt.lat, pt.lon, sampled[i + 1].lat, sampled[i + 1].lon);
        } else if (i > 0) {
            deg = bearing(sampled[i - 1].lat, sampled[i - 1].lon, pt.lat, pt.lon);
        } else {
            continue;
        }

        // Skip first and last (start/end markers)
        if (i === 0) continue;

        // Tight green double chevron >> style
        const icon = L.divIcon({
            className: 'route-arrow',
            html: `<svg width="${size}" height="${size}" viewBox="0 0 12 12" style="transform: rotate(${deg}deg);">
        <polyline points="2,9 6,3 10,9" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <polyline points="2,6 6,0 10,6" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
        });

        L.marker([pt.lat, pt.lon], { icon, interactive: false }).addTo(routeLayer);
    }
}

function renderMileMarkers(routeData) {
    if (milemarkerLayer) {
        map.removeLayer(milemarkerLayer);
    }
    milemarkerLayer = L.layerGroup().addTo(map);

    const INTERVAL_MI = 5;
    const sampled = samplePoints(routeData, INTERVAL_MI);

    for (const pt of sampled) {
        if (pt.dist < 0.1) continue; // skip start
        const displayDist = Math.round(units.dist(pt.dist));
        const icon = L.divIcon({
            className: 'mile-marker',
            html: `<span>${displayDist}</span>`,
            iconSize: [24, 16],
            iconAnchor: [12, 8],
        });
        L.marker([pt.lat, pt.lon], { icon, interactive: false }).addTo(milemarkerLayer);
    }
}

export function refreshMileMarkers() {
    if (currentRouteData) {
        renderMileMarkers(currentRouteData);
    }
}

function renderWindArrows(weatherPoints) {
    windLayer = L.layerGroup().addTo(map);

    for (const wp of weatherPoints) {
        if (wp.windSpeed === null || wp.windDir === null) continue;

        const size = Math.max(22, Math.min(52, 16 + wp.windSpeed * 1.5));
        const strokeW = Math.max(2, Math.min(4, 1.5 + wp.windSpeed * 0.12));
        const opacity = Math.max(0.45, Math.min(0.95, 0.35 + wp.windSpeed * 0.04));

        // Line arrow: shaft with arrowhead, pointing in wind direction
        // Wind direction in meteorology = where wind comes FROM, so arrow points downwind (add 180°)
        const icon = L.divIcon({
            className: 'wind-arrow',
            html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="transform: rotate(${wp.windDir}deg); opacity: ${opacity};">
        <line x1="12" y1="20" x2="12" y2="4" stroke="#475569" stroke-width="${strokeW}" stroke-linecap="round"/>
        <polyline points="7,9 12,3 17,9" fill="none" stroke="#475569" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
        });

        L.marker([wp.lat, wp.lon], { icon, interactive: false }).addTo(windLayer);
    }
}

export function highlightPoint(lat, lon, dist) {
    if (hoverMarker && lat !== null) {
        hoverMarker.setLatLng([lat, lon]);
        hoverMarker.setStyle({ opacity: 1, fillOpacity: 1 });

        // Show tooltip at the point's map position
        if (currentRouteData && dist !== undefined && dist !== null) {
            const nearest = findNearest(currentRouteData, lat, lon);
            const wx = interpolateWeather(currentWeatherPoints, nearest.dist);
            const containerPt = map.latLngToContainerPoint([lat, lon]);
            const mapRect = map.getContainer().getBoundingClientRect();
            const fakeEvent = {
                clientX: mapRect.left + containerPt.x,
                clientY: mapRect.top + containerPt.y,
            };
            showTooltip(fakeEvent, nearest, wx);
        }
    } else if (hoverMarker) {
        hoverMarker.setStyle({ opacity: 0, fillOpacity: 0 });
        if (tooltipEl) tooltipEl.style.display = 'none';
    }
}

export function getMap() {
    return map;
}

const OVERVIEW_COLORS = ['#2563eb', '#16a34a', '#dc2626', '#f59e0b', '#9333ea', '#0891b2'];

export function overviewColor(i) {
    return OVERVIEW_COLORS[i % OVERVIEW_COLORS.length];
}

// Render multiple routes at once (no weather, no mile markers).
// days: [{ day, name, routeData }]
export function renderOverview(days) {
    clearMap();
    overviewLayer = L.layerGroup().addTo(map);

    const allBounds = [];
    days.forEach((d, i) => {
        if (!d.routeData || d.routeData.length === 0) return;
        const color = overviewColor(i);
        const latlngs = d.routeData.map((pt) => [pt.lat, pt.lon]);
        const line = L.polyline(latlngs, {
            color, weight: 4, opacity: 0.85,
        }).addTo(overviewLayer);

        line.bindTooltip(`Day ${d.day} — ${d.name}`, { sticky: true });
        line.on('click', () => {
            window.dispatchEvent(new CustomEvent('overview-day-click', { detail: { day: d.day } }));
        });

        // Start marker only, labeled with day number
        const start = d.routeData[0];
        L.circleMarker([start.lat, start.lon], {
            radius: 9, color, fillColor: '#fff', fillOpacity: 1, weight: 3,
        }).bindTooltip(`Day ${d.day}`, { permanent: false }).addTo(overviewLayer);

        allBounds.push(line.getBounds());
    });

    if (allBounds.length > 0) {
        let b = allBounds[0];
        for (let i = 1; i < allBounds.length; i++) b = b.extend(allBounds[i]);
        map.fitBounds(b.pad(0.08));
    }
}

// Zoom map to a distance range on the current route (used by climb chips)
export function zoomToRange(startIdx, endIdx) {
    if (!currentRouteData) return;
    const pts = currentRouteData.slice(startIdx, endIdx + 1).map((p) => [p.lat, p.lon]);
    if (pts.length === 0) return;
    const b = L.latLngBounds(pts);
    map.fitBounds(b.pad(0.2));
}

// Flyover marker: a pulsing dot moved along the route during playback.
// Caller drives position via setFlyoverPosition(lat, lon). Map auto-pans if
// the marker drifts outside a central viewport box.
export function showFlyoverMarker(lat, lon) {
    if (!map) return;
    if (!flyoverMarker) {
        const icon = L.divIcon({
            className: 'flyover-marker',
            html: '<div class="fm-dot"></div>',
            iconSize: [18, 18],
            iconAnchor: [9, 9],
        });
        flyoverMarker = L.marker([lat, lon], { icon, interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);
    } else {
        flyoverMarker.setLatLng([lat, lon]);
    }
}

export function setFlyoverPosition(lat, lon) {
    if (!flyoverMarker) { showFlyoverMarker(lat, lon); return; }
    flyoverMarker.setLatLng([lat, lon]);
    // Keep marker in view: if it drifts into the outer 15% of the map, pan.
    const pt = map.latLngToContainerPoint([lat, lon]);
    const size = map.getSize();
    const marginX = size.x * 0.2;
    const marginY = size.y * 0.2;
    if (pt.x < marginX || pt.x > size.x - marginX || pt.y < marginY || pt.y > size.y - marginY) {
        map.panTo([lat, lon], { animate: true, duration: 0.5, easeLinearity: 0.5 });
    }
}

export function hideFlyoverMarker() {
    if (flyoverMarker) {
        map.removeLayer(flyoverMarker);
        flyoverMarker = null;
    }
}

// Highlight a climb segment on the current route with an overlay polyline.
// Pass null to clear. `mode` is 'hover' (subtle) or 'selected' (bold).
export function highlightClimbOnMap(startIdx, endIdx, mode = 'selected') {
    if (climbHighlightLayer) {
        map.removeLayer(climbHighlightLayer);
        climbHighlightLayer = null;
    }
    if (startIdx === null || startIdx === undefined || !currentRouteData) return;

    const segment = currentRouteData
        .slice(startIdx, endIdx + 1)
        .map((p) => [p.lat, p.lon]);
    if (segment.length < 2) return;

    const weight = mode === 'selected' ? 7 : 6;
    const color = mode === 'selected' ? '#f59e0b' : '#fbbf24';
    const opacity = mode === 'selected' ? 0.95 : 0.75;

    climbHighlightLayer = L.layerGroup().addTo(map);

    // White halo for contrast on any basemap
    L.polyline(segment, {
        color: '#ffffff',
        weight: weight + 4,
        opacity: 0.8,
        interactive: false,
    }).addTo(climbHighlightLayer);

    // Main amber highlight
    L.polyline(segment, {
        color,
        weight,
        opacity,
        interactive: false,
    }).addTo(climbHighlightLayer);
}
