let chart = null;
let routeDataRef = null;

export function renderElevationProfile(routeData, canvasId) {
    routeDataRef = routeData;
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (chart) {
        chart.destroy();
        chart = null;
    }

    const hasElevation = routeData.some((pt) => pt.eleFt !== null);
    if (!hasElevation) {
        canvas.parentElement.querySelector('.no-elevation')?.remove();
        const msg = document.createElement('div');
        msg.className = 'no-elevation';
        msg.textContent = 'Elevation data not available for this route';
        canvas.parentElement.appendChild(msg);
        canvas.style.display = 'none';
        return;
    }

    canvas.style.display = 'block';
    canvas.parentElement.querySelector('.no-elevation')?.remove();

    const labels = routeData.map((pt) => pt.dist.toFixed(1));
    const elevations = routeData.map((pt) => pt.eleFt);

    chart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Elevation (ft)',
                    data: elevations,
                    borderColor: '#2563eb',
                    backgroundColor: 'rgba(37, 99, 235, 0.08)',
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    fill: true,
                    tension: 0.2,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: (items) => `Mile ${items[0].label}`,
                        label: (item) => {
                            const val = item.raw;
                            return val !== null
                                ? `${Math.round(val).toLocaleString()} ft`
                                : 'N/A';
                        },
                    },
                },
            },
            scales: {
                x: {
                    title: { display: true, text: 'Distance (mi)', font: { size: 12 } },
                    ticks: {
                        maxTicksLimit: 15,
                        callback: (val, idx) => {
                            const d = parseFloat(labels[idx]);
                            return d % 5 < 0.3 ? d.toFixed(0) : '';
                        },
                    },
                    grid: { display: false },
                },
                y: {
                    title: { display: true, text: 'Elevation (ft)', font: { size: 12 } },
                    ticks: {
                        callback: (val) => val.toLocaleString(),
                    },
                    grid: { color: 'rgba(0,0,0,0.06)' },
                },
            },
            onHover: (event, elements) => {
                if (elements.length > 0) {
                    const idx = elements[0].index;
                    const pt = routeData[idx];
                    if (pt) {
                        window.dispatchEvent(
                            new CustomEvent('chart-hover', {
                                detail: { lat: pt.lat, lon: pt.lon, dist: pt.dist },
                            })
                        );
                    }
                } else {
                    window.dispatchEvent(
                        new CustomEvent('chart-hover', { detail: { lat: null } })
                    );
                }
            },
        },
    });

    // Listen for route hover events to sync chart crosshair
    window.addEventListener('route-hover', (e) => {
        if (!chart || !routeDataRef) return;
        const { dist } = e.detail;
        if (dist === null) {
            chart.setActiveElements([]);
            chart.update('none');
            return;
        }
        // Find nearest index
        let nearestIdx = 0;
        let minDiff = Infinity;
        for (let i = 0; i < routeDataRef.length; i++) {
            const diff = Math.abs(routeDataRef[i].dist - dist);
            if (diff < minDiff) {
                minDiff = diff;
                nearestIdx = i;
            }
        }
        chart.setActiveElements([{ datasetIndex: 0, index: nearestIdx }]);
        chart.tooltip.setActiveElements(
            [{ datasetIndex: 0, index: nearestIdx }],
            { x: 0, y: 0 }
        );
        chart.update('none');
    });
}

export function destroyChart() {
    if (chart) {
        chart.destroy();
        chart = null;
    }
    routeDataRef = null;
}
