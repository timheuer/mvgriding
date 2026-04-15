# Copilot Instructions

## Project Overview

Static route viewer for a multi-day gravel bike ride through SE Utah. No build step, no framework, no backend.

- **Stack**: Vanilla HTML/CSS/JS with ES modules, Leaflet.js (map), Chart.js (elevation), Open-Meteo API (weather)
- **Serving**: Must be served via HTTP (`npx http-server -p 8080`). ES modules won't load over `file://`.
- **Structure**: `js/app.js` is the entry point. It imports from `gpx.js` (parsing/distance), `map.js` (Leaflet rendering), `elevation.js` (Chart.js profile), `weather.js` (Open-Meteo fetch with HRRR/ECMWF/GFS model cascade), and `units.js` (metric/imperial conversion).
- **Data**: GPX route files live in `routes/`. Route metadata (dates, names, file paths) is defined in the `DAYS` array in `app.js`.
- **Weather**: Fetches HRRR for wind, ECMWF IFS for temperature, with GFS fallback. Results are cached in `sessionStorage`. Arrival time at each point is estimated at 13 mph from an 8 AM start.

## Preview

To launch a local preview: `npx http-server -p 8080` from the repo root, then open `http://localhost:8080`.

## Metric / Imperial Units

All internal data is stored in imperial units (miles, feet, °F, mph). The `js/units.js` module handles conversion at display time. The user's preference is persisted in `localStorage`.

Any new feature that displays distance, elevation, temperature, or speed **must** use the helpers from `units.js` (`dist()`, `elev()`, `temp()`, `speed()` and their corresponding `*Unit()` functions). Raw imperial values should never be shown directly to the user.

When adding new UI that displays unit-sensitive values, also wire it into the `units.onUnitsChange()` callback in `app.js` so it updates instantly when the toggle is flipped.

## Conventions

- Prefer the simplest working approach. This is a small vanilla JS project — avoid unnecessary abstractions, wrapper patterns, or over-engineered solutions when a direct approach works.
- **Commits**: Commit work when asked or when a logical unit of work is complete. Do **not** push unless explicitly asked — let the user decide when to push.
