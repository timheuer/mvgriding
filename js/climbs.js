// Climb detection: group contiguous stretches with avg grade ≥ threshold and
// total length ≥ minLen. Uses a simple state machine over routeData segments.
//
// routeData point: { lat, lon, eleFt, dist, grade }
//
// Returns array of climbs: {
//   startIdx, endIdx, startDist, endDist, lengthMi, gainFt, avgGrade
// }

const MIN_AVG_GRADE = 3;   // percent
const MIN_LENGTH = 0.5;    // miles
const DIP_TOLERANCE = 0.15; // allow small dips inside a climb (miles)

export function detectClimbs(routeData) {
    if (!routeData || routeData.length < 2) return [];
    const hasEle = routeData.some((pt) => pt.eleFt !== null);
    if (!hasEle) return [];

    const climbs = [];
    let i = 0;
    while (i < routeData.length - 1) {
        if ((routeData[i + 1]?.grade ?? 0) < 1) { i++; continue; }

        // Start potential climb
        const startIdx = i;
        let endIdx = i;
        let negRun = 0; // consecutive descending distance

        for (let j = i + 1; j < routeData.length; j++) {
            const g = routeData[j].grade ?? 0;
            if (g < 0) {
                negRun += routeData[j].dist - routeData[j - 1].dist;
                if (negRun > DIP_TOLERANCE) break;
            } else {
                negRun = 0;
            }
            endIdx = j;
        }

        const startDist = routeData[startIdx].dist;
        const endDist = routeData[endIdx].dist;
        const lengthMi = endDist - startDist;
        const startEle = routeData[startIdx].eleFt ?? 0;
        const endEle = routeData[endIdx].eleFt ?? 0;
        const gainFt = endEle - startEle;
        const avgGrade = lengthMi > 0 ? (gainFt / (lengthMi * 5280)) * 100 : 0;

        if (lengthMi >= MIN_LENGTH && avgGrade >= MIN_AVG_GRADE && gainFt > 100) {
            climbs.push({ startIdx, endIdx, startDist, endDist, lengthMi, gainFt, avgGrade });
        }
        i = endIdx + 1;
    }
    return climbs;
}

export function climbDifficulty(avgGrade) {
    if (avgGrade < 5) return 'easy';
    if (avgGrade < 8) return 'mod';
    return 'hard';
}
