# MVG Gravel Ride 2026

Interactive route viewer for the Monument Valley Gravel ride, April 19–23, 2026 through SE Utah.

## Features

- **5-day route map** — GPX routes rendered on Leaflet/OpenStreetMap
- **Weather overlay** — Wind arrows (direction + speed) along each route, fetched from Open-Meteo
- **Interactive tooltip** — Hover the route or elevation chart to see milepoint, elevation, grade, temperature, and wind
- **Elevation profile** — Chart.js graph synced with the map
- **Directional chevrons** — Green `>>` markers every mile showing direction of travel
- **Weather models** — ECMWF IFS for temperature, HRRR (3km) for wind when available, GFS fallback

## Routes

| Day | Date | Route |
|-----|------|-------|
| 1 | Apr 19 | Pleasant View to Hovenweep |
| 2 | Apr 20 | Natural Bridges & Bears Ears |
| 3 | Apr 21 | Comb Wash to Bluff |
| 4 | Apr 22 | Bluff to Mexican Hat |
| 5 | Apr 23 | Monument Valley to Goosenecks State Park |

## Setup

No build step, no API keys. Open `index.html` via any HTTP server:

```sh
npx http-server -p 8080
```

Then visit `http://localhost:8080`.

> **Note:** ES modules require an HTTP server — `file://` won't work.

## Hosting

Deploy as a static site to GitHub Pages, Netlify, or any static host. No backend required.

## Tech

- Leaflet.js + OpenStreetMap (map)
- Chart.js (elevation profile)
- Open-Meteo API (weather — ECMWF, HRRR, GFS models)
- Vanilla HTML/CSS/JS, no framework, no build
