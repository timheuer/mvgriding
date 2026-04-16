const STORAGE_KEY = 'units_metric';
let metric = localStorage.getItem(STORAGE_KEY) !== 'false';

const listeners = new Set();

export function isMetric() {
    return metric;
}

export function setMetric(val) {
    metric = val;
    localStorage.setItem(STORAGE_KEY, val);
    listeners.forEach((fn) => fn(metric));
}

export function onUnitsChange(fn) {
    listeners.add(fn);
}

// Distance: internal miles → display
export function dist(mi) {
    return metric ? mi * 1.60934 : mi;
}

export function distUnit() {
    return metric ? 'km' : 'mi';
}

// Elevation: internal feet → display
export function elev(ft) {
    return metric ? ft / 3.28084 : ft;
}

export function elevUnit() {
    return metric ? 'm' : 'ft';
}

// Speed: internal mph → display
export function speed(mph) {
    return metric ? mph * 1.60934 : mph;
}

export function speedUnit() {
    return metric ? 'km/h' : 'mph';
}

// Temperature: internal °F → display
export function temp(f) {
    return metric ? (f - 32) * 5 / 9 : f;
}

export function tempUnit() {
    return metric ? '°C' : '°F';
}

// Format a decimal-hours offset from a start hour (e.g. 8 + 4.5 → "12:30 PM")
export function formatClock(startHour, hoursOffset) {
    const total = startHour + hoursOffset;
    let h = Math.floor(total) % 24;
    const m = Math.round((total - Math.floor(total)) * 60);
    const rolloverH = m === 60 ? (h + 1) % 24 : h;
    const rolloverM = m === 60 ? 0 : m;
    const ampm = rolloverH >= 12 ? 'PM' : 'AM';
    const h12 = rolloverH % 12 === 0 ? 12 : rolloverH % 12;
    return `${h12}:${String(rolloverM).padStart(2, '0')} ${ampm}`;
}
