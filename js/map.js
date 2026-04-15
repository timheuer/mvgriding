import { findNearest, samplePoints } from './gpx.js';
import { interpolateWeather, windDirLabel } from './weather.js';
import * as units from './units.js';

let map = null;
let routeLayer = null;
let windLayer = null;
let hoverMarker = null;
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
    if (hoverMarker) {
        map.removeLayer(hoverMarker);
        hoverMarker = null;
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

    // Directional arrows along the route every 5 miles
    renderDirectionArrows(routeData);

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
    ${modelInfo ? `<div class="tt-source">${modelInfo}</div>` : ''}
  `;

    const mapRect = map.getContainer().getBoundingClientRect();
    let x = event.clientX - mapRect.left + 16;
    let y = event.clientY - mapRect.top - 10;

    // Keep tooltip in view
    const ttW = 180;
    const ttH = 140;
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
