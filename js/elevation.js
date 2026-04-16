import * as units from './units.js';

let chart = null;
let routeDataRef = null;
let hoverIdx = null;
let highlightedClimb = null; // {startIdx, endIdx} or null

// Chart.js plugin to draw a vertical ruler at the hovered index + shade a highlighted climb range.
const hoverRulerPlugin = {
    id: 'hoverRuler',
    afterDatasetsDraw(c) {
        const { ctx, chartArea, scales } = c;
        if (!chartArea) return;

        // Shade highlighted climb
        if (highlightedClimb && routeDataRef) {
            const x1 = scales.x.getPixelForValue(highlightedClimb.startIdx);
            const x2 = scales.x.getPixelForValue(highlightedClimb.endIdx);
            ctx.save();
            ctx.fillStyle = 'rgba(245, 158, 11, 0.15)';
            ctx.fillRect(x1, chartArea.top, x2 - x1, chartArea.bottom - chartArea.top);
            ctx.strokeStyle = 'rgba(245, 158, 11, 0.6)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x1, chartArea.top, x2 - x1, chartArea.bottom - chartArea.top);
            ctx.restore();
        }

        if (hoverIdx === null || hoverIdx === undefined) return;
        const x = scales.x.getPixelForValue(hoverIdx);
        if (x < chartArea.left || x > chartArea.right) return;
        ctx.save();
        ctx.strokeStyle = 'rgba(37, 99, 235, 0.7)';
        ctx.lineWidth = 1.25;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        ctx.restore();
    },
};

function gradeColor(grade) {
    // Grade (percent). Positive = uphill.
    if (grade <= 0) return '#60a5fa';          // descending / flat — blue
    if (grade < 3) return '#86efac';            // gentle — light green
    if (grade < 5) return '#22c55e';            // moderate — green
    if (grade < 8) return '#f59e0b';            // steep — amber
    return '#dc2626';                           // very steep — red
}

function buildDatasets(routeData) {
    const labels = routeData.map((pt) => units.dist(pt.dist).toFixed(1));
    const elevations = routeData.map((pt) =>
        pt.eleFt !== null ? units.elev(pt.eleFt) : null
    );
    return {
        labels,
        datasets: [
            {
                label: `Elevation (${units.elevUnit()})`,
                data: elevations,
                borderColor: '#2563eb',
                backgroundColor: 'rgba(37, 99, 235, 0.08)',
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4,
                fill: true,
                tension: 0.2,
                // Segment-level styling: color each line segment by grade
                segment: {
                    borderColor: (ctx) => {
                        const i = ctx.p1DataIndex;
                        const g = routeData[i]?.grade ?? 0;
                        return gradeColor(g);
                    },
                },
            },
        ],
    };
}

function buildOptions(routeData) {
    const distUnitLabel = `Distance (${units.distUnit()})`;
    const elevUnitLabel = `Elevation (${units.elevUnit()})`;

    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { display: false },
            tooltip: {
                callbacks: {
                    title: (items) => `${units.isMetric() ? 'Km' : 'Mile'} ${items[0].label}`,
                    label: (item) => {
                        const val = item.raw;
                        const pt = routeData[item.dataIndex];
                        const grade = pt?.grade !== undefined ? ` · ${pt.grade}%` : '';
                        return val !== null
                            ? `${Math.round(val).toLocaleString()} ${units.elevUnit()}${grade}`
                            : 'N/A';
                    },
                },
            },
        },
        scales: {
            x: {
                title: { display: true, text: distUnitLabel, font: { size: 12 } },
                ticks: {
                    maxTicksLimit: 15,
                    callback: (val, idx) => {
                        const d = parseFloat(units.dist(routeData[idx]?.dist ?? 0).toFixed(1));
                        return d % 5 < 0.3 ? d.toFixed(0) : '';
                    },
                },
                grid: { display: false },
            },
            y: {
                title: { display: true, text: elevUnitLabel, font: { size: 12 } },
                ticks: { callback: (val) => val.toLocaleString() },
                grid: { color: 'rgba(0,0,0,0.06)' },
            },
        },
        onHover: (event, elements) => {
            if (elements.length > 0) {
                const idx = elements[0].index;
                const pt = routeData[idx];
                if (pt) {
                    window.dispatchEvent(new CustomEvent('chart-hover', {
                        detail: { lat: pt.lat, lon: pt.lon, dist: pt.dist },
                    }));
                }
            } else {
                window.dispatchEvent(new CustomEvent('chart-hover', { detail: { lat: null } }));
            }
        },
    };
}

export function renderElevationProfile(routeData, canvasId) {
    routeDataRef = routeData;
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const hasElevation = routeData.some((pt) => pt.eleFt !== null);

    // Clean up "no-elevation" message
    canvas.parentElement.querySelector('.no-elevation')?.remove();

    if (!hasElevation) {
        if (chart) { chart.destroy(); chart = null; }
        const msg = document.createElement('div');
        msg.className = 'no-elevation';
        msg.textContent = 'Elevation data not available for this route';
        canvas.parentElement.appendChild(msg);
        canvas.style.display = 'none';
        return;
    }

    canvas.style.display = 'block';

    // If a chart already exists, update in place (faster + smoother toggles)
    if (chart) {
        const d = buildDatasets(routeData);
        chart.data.labels = d.labels;
        chart.data.datasets = d.datasets;
        chart.options = buildOptions(routeData);
        chart.update('none');
        return;
    }

    chart = new Chart(canvas, {
        type: 'line',
        data: buildDatasets(routeData),
        options: buildOptions(routeData),
        plugins: [hoverRulerPlugin],
    });
}

export function highlightClimb(climb) {
    highlightedClimb = climb;
    if (chart) chart.update('none');
}

export function destroyChart() {
    if (chart) { chart.destroy(); chart = null; }
    routeDataRef = null;
    hoverIdx = null;
    highlightedClimb = null;
}

// Listen for route hover events to sync chart crosshair
window.addEventListener('route-hover', (e) => {
    if (!chart || !routeDataRef) return;
    const { dist } = e.detail;
    if (dist === null || dist === undefined) {
        hoverIdx = null;
        chart.setActiveElements([]);
        chart.update('none');
        return;
    }
    let nearestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < routeDataRef.length; i++) {
        const diff = Math.abs(routeDataRef[i].dist - dist);
        if (diff < minDiff) { minDiff = diff; nearestIdx = i; }
    }
    hoverIdx = nearestIdx;
    chart.setActiveElements([{ datasetIndex: 0, index: nearestIdx }]);
    chart.tooltip.setActiveElements(
        [{ datasetIndex: 0, index: nearestIdx }],
        { x: 0, y: 0 }
    );
    chart.update('none');
});
