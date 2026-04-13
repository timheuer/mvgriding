import {
    parseGPX,
    computeRouteData,
    fetchElevations,
    samplePoints,
} from './gpx.js';
import { fetchWeatherForPoints } from './weather.js';
import { initMap, renderRoute, highlightPoint, clearMap } from './map.js';
import { renderElevationProfile, destroyChart } from './elevation.js';

const DAYS = [
    {
        day: 1,
        date: '2026-04-19',
        dateLabel: 'Apr 19',
        file: 'routes/MVG-01a_Pleasant_View_to_Hovenweep.gpx',
        name: 'Pleasant View to Hovenweep',
    },
    {
        day: 2,
        date: '2026-04-20',
        dateLabel: 'Apr 20',
        file: 'routes/MVG-02_Natural_Bridges___Bears_Ears.gpx',
        name: 'Natural Bridges & Bears Ears',
    },
    {
        day: 3,
        date: '2026-04-21',
        dateLabel: 'Apr 21',
        file: 'routes/MVG-03_Comb_Wash_to_Bluff.gpx',
        name: 'Comb Wash to Bluff',
    },
    {
        day: 4,
        date: '2026-04-22',
        dateLabel: 'Apr 22',
        file: 'routes/MVG-04_Bluff_to_Mexican_Hat.gpx',
        name: 'Bluff to Mexican Hat',
    },
    {
        day: 5,
        date: '2026-04-23',
        dateLabel: 'Apr 23',
        file: 'routes/MVG-05_Monument_Valley_to_Goosenecks_State_Park.gpx',
        name: 'Monument Valley to Goosenecks',
    },
];

const WIND_SAMPLE_INTERVAL = 2.5; // miles

let currentDay = null;
let map = null;

function buildNav() {
    const nav = document.getElementById('day-nav');
    nav.innerHTML = '';

    for (const day of DAYS) {
        const btn = document.createElement('button');
        btn.className = 'day-btn';
        btn.dataset.day = day.day;
        btn.innerHTML = `
      <span class="day-num">Day ${day.day}</span>
      <span class="day-date">${day.dateLabel}</span>
      <span class="day-name">${day.name}</span>
    `;
        btn.addEventListener('click', () => selectDay(day.day));
        nav.appendChild(btn);
    }
}

function setActiveNav(dayNum) {
    document.querySelectorAll('.day-btn').forEach((btn) => {
        btn.classList.toggle('active', parseInt(btn.dataset.day) === dayNum);
    });
}

function showLoading(show) {
    document.getElementById('loading').style.display = show ? 'flex' : 'none';
}

function showWeatherStatus(msg) {
    const el = document.getElementById('weather-status');
    if (msg) {
        el.textContent = msg;
        el.style.display = 'block';
    } else {
        el.style.display = 'none';
    }
}

function updateRouteInfo(routeData, day) {
    const totalDist = routeData[routeData.length - 1]?.dist || 0;
    const hasEle = routeData.some((pt) => pt.eleFt !== null);

    let elevGain = 0;
    if (hasEle) {
        for (let i = 1; i < routeData.length; i++) {
            const diff =
                (routeData[i].eleFt || 0) - (routeData[i - 1].eleFt || 0);
            if (diff > 0) elevGain += diff;
        }
    }

    const estTime = totalDist / 13;
    const hours = Math.floor(estTime);
    const mins = Math.round((estTime - hours) * 60);

    document.getElementById('route-title').textContent = day.name;
    document.getElementById('route-date').textContent = `Day ${day.day} — ${day.dateLabel}, 2026`;
    document.getElementById('route-dist').textContent = `${totalDist.toFixed(1)} mi`;
    document.getElementById('route-elev').textContent = hasEle
        ? `${Math.round(elevGain).toLocaleString()} ft gain`
        : '—';
    document.getElementById('route-time').textContent = `~${hours}h ${mins}m @ 13 mph`;
}

async function selectDay(dayNum) {
    if (currentDay === dayNum) return;
    currentDay = dayNum;
    setActiveNav(dayNum);

    const day = DAYS.find((d) => d.day === dayNum);
    if (!day) return;

    showLoading(true);
    showWeatherStatus(null);
    clearMap();
    destroyChart();

    try {
        // Fetch and parse GPX
        const resp = await fetch(day.file);
        const xml = await resp.text();
        let { trackpoints, isRoute } = parseGPX(xml);

        // For route-format GPX, fetch elevation data
        if (isRoute || trackpoints.every((pt) => pt.ele === null)) {
            trackpoints = await fetchElevations(trackpoints);
        }

        const routeData = computeRouteData(trackpoints);

        // Update route info
        updateRouteInfo(routeData, day);

        // Fetch weather for sampled points
        showWeatherStatus('Loading weather forecast…');
        const sampled = samplePoints(routeData, WIND_SAMPLE_INTERVAL);
        let weatherPoints = [];

        try {
            weatherPoints = await fetchWeatherForPoints(sampled, day.date);
            const anyAvailable = weatherPoints.some((w) => w.available);
            if (!anyAvailable) {
                showWeatherStatus('Forecast not yet available for this date');
            } else {
                showWeatherStatus(null);
            }
        } catch (e) {
            console.warn('Weather fetch failed:', e);
            showWeatherStatus('Weather data unavailable');
        }

        // Render map
        renderRoute(routeData, weatherPoints);

        // Render elevation chart
        renderElevationProfile(routeData, 'elevation-chart');

        showLoading(false);
    } catch (e) {
        console.error('Failed to load route:', e);
        showLoading(false);
        showWeatherStatus('Failed to load route data');
    }
}

// Listen for chart hover to highlight point on map
window.addEventListener('chart-hover', (e) => {
    const { lat, lon, dist } = e.detail;
    highlightPoint(lat, lon, dist);
});

// Init
document.addEventListener('DOMContentLoaded', () => {
    map = initMap('map');
    buildNav();
    selectDay(1);
});
