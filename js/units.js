let metric = true;

const listeners = new Set();

export function isMetric() {
    return metric;
}

export function setMetric(val) {
    metric = val;
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
