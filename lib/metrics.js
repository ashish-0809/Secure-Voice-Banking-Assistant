// Verification metrics. Score >= threshold => accept.
//   FAR (false accept rate)  = share of IMPOSTOR trials accepted  -> security risk
//   FRR (false reject rate)  = share of GENUINE trials rejected   -> annoyance
function curve(genuine, impostor, step = 0.01) {
    const pts = [];
    for (let t = 0; t <= 1.0001; t += step) {
        const th = +t.toFixed(4);
        pts.push({ t: th, far: impostor.filter(x => x >= th).length / impostor.length, frr: genuine.filter(x => x < th).length / genuine.length });
    }
    return pts;
}
function eer(pts) {
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.far - p.frr) < Math.abs(best.far - best.frr)) best = p;
    return { t: best.t, rate: (best.far + best.frr) / 2 };
}
function at(genuine, impostor, th) {
    return { t: th, far: impostor.filter(x => x >= th).length / impostor.length, frr: genuine.filter(x => x < th).length / genuine.length };
}
function histogram(values, bins = 20) {
    const h = new Array(bins).fill(0);
    values.forEach(v => { h[Math.max(0, Math.min(bins - 1, Math.floor(v * bins)))]++; });
    return h;
}
// Lowest threshold whose FAR is <= target (e.g. 0.01), with the FRR you pay for it.
function forFar(pts, target) { const p = pts.find(x => x.far <= target) || pts[pts.length - 1]; return { t: p.t, far: p.far, frr: p.frr, target }; }
module.exports = { curve, eer, at, histogram, forFar };
