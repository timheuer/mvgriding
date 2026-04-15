# Copilot Instructions

## Project Overview

Static route viewer for a multi-day gravel bike ride through SE Utah. No build step, no framework, no backend.

- **Stack**: Vanilla HTML/CSS/JS with ES modules, Leaflet.js (map), Chart.js (elevation), Open-Meteo API (weather)
- **Serving**: Must be served via HTTP (`npx http-server -p 8080`). ES modules won't load over `file://`.
- **Structure**: `js/app.js` is the entry point. It imports from `gpx.js` (parsing/distance), `map.js` (Leaflet rendering), `elevation.js` (Chart.js profile), and `weather.js` (Open-Meteo fetch with HRRR/ECMWF/GFS model cascade).
- **Data**: GPX route files live in `routes/`. Route metadata (dates, names, file paths) is defined in the `DAYS` array in `app.js`.
- **Weather**: Fetches HRRR for wind, ECMWF IFS for temperature, with GFS fallback. Results are cached in `sessionStorage`. Arrival time at each point is estimated at 13 mph from an 8 AM start.

## Conventions

- Prefer the simplest working approach. This is a small vanilla JS project — avoid unnecessary abstractions, wrapper patterns, or over-engineered solutions when a direct approach works.
