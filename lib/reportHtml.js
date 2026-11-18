// Self-contained HTML (inline SVG) for the security report. No external scripts or fonts.
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = x => (x * 100).toFixed(1) + '%';
// Small rates need more digits (0.0% would hide "2 of 10,620").
const pctS = x => x === 0 ? '0%' : x < 0.1 ? (x * 100).toFixed(2) + '%' : (x * 100).toFixed(1) + '%';
const num = n => Number(n).toLocaleString('en-US');
const W = 640, H = 320, M = { l: 52, r: 16, t: 16, b: 40 };
const sx = v => M.l + v * (W - M.l - M.r);
const sy = (v, max = 1) => H - M.b - (v / max) * (H - M.t - M.b);

function axes(xLabel, yLabel, yTicks, yFmt) {
    let s = `<rect x="${M.l}" y="${M.t}" width="${W - M.l - M.r}" height="${H - M.t - M.b}" fill="none" stroke="var(--line)"/>`;
    for (let i = 0; i <= 10; i += 2) s += `<text x="${sx(i / 10)}" y="${H - M.b + 16}" text-anchor="middle" class="tick">${(i / 10).toFixed(1)}</text>`;
    yTicks.forEach(v => { s += `<line x1="${M.l}" x2="${W - M.r}" y1="${sy(v.pos)}" y2="${sy(v.pos)}" stroke="var(--line)" stroke-dasharray="2 4"/><text x="${M.l - 6}" y="${sy(v.pos) + 4}" text-anchor="end" class="tick">${yFmt(v.val)}</text>`; });
    return s + `<text x="${(W + M.l - M.r) / 2}" y="${H - 6}" text-anchor="middle" class="lbl">${esc(xLabel)}</text><text transform="translate(14 ${H / 2}) rotate(-90)" text-anchor="middle" class="lbl">${esc(yLabel)}</text>`;
}

function farFrrChart(pts, threshold, e) {
    const line = k => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.t).toFixed(1)} ${sy(p[k]).toFixed(1)}`).join(' ');
    const ticks = [0, .25, .5, .75, 1].map(v => ({ pos: v, val: v }));
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="FAR and FRR versus threshold">${axes('Decision threshold (score needed to accept)', 'Error rate', ticks, v => Math.round(v * 100) + '%')}
<path d="${line('far')}" fill="none" stroke="var(--bad)" stroke-width="2.5"/><path d="${line('frr')}" fill="none" stroke="var(--blue)" stroke-width="2.5"/>
<line x1="${sx(threshold)}" x2="${sx(threshold)}" y1="${M.t}" y2="${H - M.b}" stroke="var(--fg)" stroke-dasharray="5 4"/><text x="${sx(threshold) + 5}" y="${M.t + 14}" class="lbl">current ${threshold}</text>
<circle cx="${sx(e.t)}" cy="${sy(e.rate)}" r="5" fill="var(--warn)"/><text x="${sx(e.t) + 8}" y="${sy(e.rate) - 8}" class="lbl">EER ${pct(e.rate)} @ ${e.t.toFixed(2)}</text>
<g class="lbl"><rect x="${W - 190}" y="${M.t + 8}" width="12" height="12" fill="var(--bad)"/><text x="${W - 172}" y="${M.t + 18}">FAR (impostor accepted)</text><rect x="${W - 190}" y="${M.t + 28}" width="12" height="12" fill="var(--blue)"/><text x="${W - 172}" y="${M.t + 38}">FRR (owner rejected)</text></g></svg>`;
}

function histChart(gen, imp, threshold) {
    // Each group is drawn as a SHARE of its own trials, otherwise the (few) owner trials vanish next to thousands of impostor trials.
    const sum = h => h.reduce((a, b) => a + b, 0) || 1, g = gen.map(n => n / sum(gen)), im = imp.map(n => n / sum(imp));
    const bins = 20, max = Math.max(0.05, ...g, ...im), bw = (W - M.l - M.r) / bins;
    const bars = (h, cls, off) => h.map((n, i) => n ? `<rect x="${(M.l + i * bw + off).toFixed(1)}" y="${sy(n, max).toFixed(1)}" width="${(bw / 2 - 1).toFixed(1)}" height="${(H - M.b - sy(n, max)).toFixed(1)}" rx="2" fill="${cls}"/>` : '').join('');
    const ticks = [0, .5, 1].map(v => ({ pos: v, val: v * max }));
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Score distribution">${axes('Similarity score', 'Share of trials', ticks, v => Math.round(v * 100) + '%')}${bars(im, 'var(--bad)', 0)}${bars(g, 'var(--good)', bw / 2)}
<line x1="${sx(threshold)}" x2="${sx(threshold)}" y1="${M.t}" y2="${H - M.b}" stroke="var(--fg)" stroke-dasharray="5 4"/><text x="${sx(threshold) + 5}" y="${M.t + 14}" class="lbl">threshold ${threshold}</text>
<g class="lbl"><rect x="${W - 210}" y="${M.t + 8}" width="12" height="12" rx="2" fill="var(--good)"/><text x="${W - 192}" y="${M.t + 18}">Owner (genuine)</text><rect x="${W - 210}" y="${M.t + 28}" width="12" height="12" rx="2" fill="var(--bad)"/><text x="${W - 192}" y="${M.t + 38}">Other people (impostor)</text></g></svg>`;
}

function barChart(rows) { // rows: {label, blocked, total, goodWhenBlocked}
    const rh = 46, h = rows.length * rh + 20;
    const body = rows.map((r, i) => {
        const y = 10 + i * rh, frac = r.total ? r.blocked / r.total : 0, good = r.goodWhenBlocked ? frac : 1 - frac;
        return `<text x="0" y="${y + 14}" class="lbl">${esc(r.label)}</text><rect x="0" y="${y + 20}" width="420" height="14" rx="3" fill="var(--line)"/><rect x="0" y="${y + 20}" width="${(420 * frac).toFixed(0)}" height="14" rx="3" fill="${good >= 0.99 ? 'var(--good)' : 'var(--warn)'}"/><text x="430" y="${y + 32}" class="lbl">${r.blocked}/${r.total} flagged (${pct(frac)})</text>`;
    }).join('');
    return `<svg viewBox="0 0 640 ${h}" role="img" aria-label="Replay detection results">${body}</svg>`;
}

const KIND_COLOR = { accepted: 'var(--good)', voice: 'var(--bad)', phrase: 'var(--blue)', replay: 'var(--warn)' };
function timeline(att, threshold) {
    if (!att.length) return '<p class="hint">No voice verification attempts with a score recorded yet.</p>';
    const w = Math.max(1, att.length - 1);
    const dots = att.map((a, i) => {
        const x = M.l + (i / w) * (W - M.l - M.r), col = KIND_COLOR[a.kind] || 'var(--bad)';
        return a.kind === 'replay' ? `<path d="M${(x - 5).toFixed(1)} ${(sy(a.score) - 5).toFixed(1)}l10 10m0 -10l-10 10" stroke="${col}" stroke-width="2.5"/>` : `<circle cx="${x.toFixed(1)}" cy="${sy(a.score).toFixed(1)}" r="5" fill="${col}"/>`;
    }).join('');
    const ticks = [0, .25, .5, .75, 1].map(v => ({ pos: v, val: v }));
    const leg = (x, col, t) => `<circle cx="${x}" cy="${M.t + 14}" r="5" fill="${col}"/><text x="${x + 12}" y="${M.t + 18}">${t}</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Recent verification attempts">${axes('Attempt (oldest to newest)', 'Score', ticks, v => v.toFixed(2)).replace(/<text x="[\d.]+" y="\d+" text-anchor="middle" class="tick">[\d.]+<\/text>/g, '')}
<line x1="${M.l}" x2="${W - M.r}" y1="${sy(threshold)}" y2="${sy(threshold)}" stroke="var(--fg)" stroke-dasharray="5 4"/><text x="${W - M.r - 4}" y="${sy(threshold) - 6}" text-anchor="end" class="lbl">threshold ${threshold}</text>${dots}
<g class="lbl">${leg(M.l + 16, 'var(--good)', 'accepted')}${leg(M.l + 100, 'var(--bad)', 'voice too low')}${leg(M.l + 214, 'var(--blue)', 'voice ok, phrase wrong')}<text x="${M.l + 372}" y="${M.t + 18}" fill="var(--warn)">✕ replay</text></g></svg>`;
}

// Live part. liveInner() is also served by /report/live and polled by the page every 4 s.
function liveInner(l, threshold) {
    const card = (n, t, cls = '') => `<div class="kpi ${cls}"><b>${n}</b><span>${t}</span></div>`;
    const span = l.total ? `${esc(String(l.from).slice(0, 16).replace('T', ' '))} to ${esc(String(l.to).slice(0, 16).replace('T', ' '))} (UTC)` : 'no attempts yet';
    return `<p class="hint">Every voice check made in the app on this server: <b>${l.total}</b> attempt(s), ${span}. The server keeps the newest 500 audit events, so very old attempts drop out.</p>
<div class="cards">${card(l.total, 'total attempts')}${card(l.accepted, 'accepted', 'good')}${card(l.voice, 'rejected: voice score too low', l.voice ? 'bad' : '')}${card(l.phrase, 'voice matched, phrase not recognised', l.phrase ? 'info' : '')}${card(l.recording, 'recording problem (too short / quiet / service)', l.recording ? 'warn' : '')}${card(l.replay, 'replay blocked', l.replay ? 'warn' : '')}</div>
${timeline(l.attempts, threshold)}`;
}
function liveSection(l, threshold) {
    return `<!--LIVE_START--><section id="live-section"><div class="sechead"><h2>Live attempts</h2><span id="livebadge" class="badge">snapshot</span></div><div id="live">${liveInner(l, threshold)}</div></section><!--LIVE_END-->`;
}

function thresholdTable(gen, imp, cur, eerT) {
    const ths = [...new Set([0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, cur])].sort((a, b) => a - b);
    const rows = ths.map(t => {
        const fa = imp.filter(x => x >= t).length, fr = gen.filter(x => x < t).length, far = fa / imp.length, frr = fr / gen.length;
        const c = x => x <= 0.005 ? 'good' : x <= 0.02 ? 'warn' : 'bad';
        return `<tr class="${t === cur ? 'cur' : ''}"><td><b>${t.toFixed(2)}</b>${t === cur ? ' <small>app setting</small>' : ''}</td><td class="${c(far)}">${pctS(far)} <small>(${num(fa)} of ${num(imp.length)})</small></td><td>${pctS(frr)} <small>(${num(fr)} of ${num(gen.length)})</small></td></tr>`;
    }).join('');
    return `<div class="tablewrap"><table><thead><tr><th>Threshold</th><th>Impostors accepted (FAR) - lower is safer</th><th>Owner rejected (FRR) - lower is easier</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function render(d) {
    const A = d.accuracy, e = d.eerPoint;
    const demo = d.demo ? '<div class="demo">SYNTHETIC DEMO DATA - made-up numbers to preview the layout. NOT results of your system.</div>' : '';
    const farC = A ? (d.atThreshold.far <= 0.005 ? 'good' : d.atThreshold.far <= 0.02 ? 'warn' : 'bad') : '';
    const frrC = A ? (d.atThreshold.frr <= 0.05 ? 'good' : d.atThreshold.frr <= 0.15 ? 'warn' : 'bad') : '';
    const mod = d.replayTest && d.replayTest[1], modRate = mod && mod.total ? mod.blocked / mod.total : null, same = d.replayTest && d.replayTest[0];
    const hero = A ? `<div class="cards hero">
<div class="kpi ${farC}"><b>${pctS(d.atThreshold.far)}</b><span>Impostors accepted (FAR)<br><small>${num(Math.round(d.atThreshold.far * A.impostor.length))} of ${num(A.impostor.length)} trials at threshold ${d.threshold}</small></span></div>
<div class="kpi ${frrC}"><b>${pctS(d.atThreshold.frr)}</b><span>Owner rejected (FRR)<br><small>${num(Math.round(d.atThreshold.frr * A.genuine.length))} of ${num(A.genuine.length)} trials</small></span></div>
<div class="kpi"><b>${pct(1 - (d.atThreshold.far + d.atThreshold.frr) / 2)}</b><span>Balanced accuracy<br><small>1 - average(FAR, FRR)</small></span></div>
<div class="kpi"><b>${pct(e.rate)}</b><span>Equal error rate<br><small>FAR = FRR at threshold ${e.t.toFixed(2)}</small></span></div>
${same ? `<div class="kpi ${same.blocked === same.total ? 'good' : 'warn'}"><b>${same.total ? pct(same.blocked / same.total) : '-'}</b><span>Re-sent recordings blocked<br><small>${same.blocked} of ${same.total}</small></span></div>` : ''}
${mod ? `<div class="kpi ${modRate >= 0.9 ? 'good' : 'warn'}"><b>${modRate === null ? '-' : pct(modRate)}</b><span>Changed copies blocked<br><small>${mod.blocked} of ${mod.total}</small></span></div>` : ''}</div>
<div class="note"><b>In plain words.</b> At threshold <b>${d.threshold}</b>, ${pctS(d.atThreshold.far)} of impostor attempts got in and ${pctS(d.atThreshold.frr)} of genuine owner attempts were rejected on this dataset.
${d.forFar ? ` The lowest threshold that keeps FAR under ${pct(d.forFar.target)} is <b>${d.forFar.t.toFixed(2)}</b> (owner rejected: ${pctS(d.forFar.frr)}).` : ''}
A bank prefers a very low FAR, but a laptop microphone gives lower owner scores than this dataset, so check the live section below with your own voice.</div>` : '';
    const acc = A ? `
<section><div class="sechead"><h2>1. Speaker accuracy</h2></div>
<p class="hint">${A.people} people, ${num(A.genuine.length)} owner trials, ${num(A.impostor.length)} impostor trials. A trial = one recording compared with a person's voice profile. Impostor = a recording of someone else.</p>
<h3>Error rates for different thresholds</h3>${thresholdTable(A.genuine, A.impostor, d.threshold, e.t)}
<h3>FAR and FRR curves</h3>${farFrrChart(A.pts, d.threshold, e)}
<p class="hint">Raising the threshold lowers FAR (safer) but raises FRR (the owner is rejected more often). The orange dot is where both are equal.</p>
<h3>Where the scores fall</h3>${histChart(A.histGen, A.histImp, d.threshold)}
<p class="hint">${A.maxImpostor < A.minGenuine ? `Owner and impostor scores do not overlap (gap ${A.maxImpostor.toFixed(2)} to ${A.minGenuine.toFixed(2)}).` : `Owner and impostor scores overlap a little: highest impostor ${A.maxImpostor.toFixed(2)}, lowest owner ${A.minGenuine.toFixed(2)}. No single threshold separates them perfectly.`}</p></section>`
        : `<section><div class="sechead"><h2>1. Speaker accuracy</h2></div><p class="hint">Not generated: ${esc(d.accuracyError || 'no data')}</p><p class="hint">Needs the recordings and the ECAPA service (MAKE_REPORT.bat does both).</p></section>`;
    const rm = d.replayMeta || {};
    const rp = d.replayTest ? `
<section><div class="sechead"><h2>2. Replay detection test</h2></div>
<p class="hint">A "replay" re-submits a captured clip. A "live" clip is a different recording of the same person and must NOT be flagged.</p>
${barChart(d.replayTest)}
<div class="note ${modRate !== null && modRate < 0.9 ? 'warnbox' : ''}"><b>${modRate !== null && modRate < 0.9 ? 'Honest result.' : 'Result.'}</b> Identical re-sent recordings are blocked ${same && same.total ? pct(same.blocked / same.total) : '-'} of the time.
${modRate !== null && modRate < 0.9 ? ` A recording whose volume or noise was changed (or played through a speaker) was flagged only ${pct(modRate)} of the time, so this check does <b>not</b> stop that attack. The defences for it are the random phrase, the voice match and OTP/PIN for payments.` : ' Changed copies are caught as well.'}
${rm.copyRange && rm.copyRange[0] != null ? `<br><small>Similarity of changed copies to the original: ${rm.copyRange[0]} to ${rm.copyRange[1]}; a clip counts as a copy at ${rm.nearDup || 0.985} or above${rm.liveMax != null ? `; the most similar genuine new recording reached ${rm.liveMax}` : ''}.</small>` : ''}</div></section>` : '';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Voice Security Report</title><style>
:root{--bg:#f1f4f9;--card:#fff;--fg:#14213d;--mut:#5b6b85;--line:#dbe2ec;--bad:#d62839;--good:#1f9d55;--blue:#2f6fed;--warn:#e08a00;--head1:#0b2a55;--head2:#1d4f9c}
@media (prefers-color-scheme:dark){:root{--bg:#0b1018;--card:#151c27;--fg:#e8eef7;--mut:#93a1b6;--line:#2a3547;--head1:#0a1f3f;--head2:#173d78}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,Segoe UI,Arial,sans-serif}
header{background:linear-gradient(135deg,var(--head1),var(--head2));color:#fff;padding:28px 20px 34px}header .in,main{max-width:980px;margin:auto}
header h1{margin:0 0 4px;font-size:28px}header p{margin:2px 0;opacity:.85;font-size:14px}main{padding:0 16px 40px;margin-top:-18px}
section,.note{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin:16px 0;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.sechead{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px}h2{margin:0;font-size:19px}h3{margin:18px 0 4px;font-size:15px;color:var(--mut)}
svg{width:100%;height:auto;display:block;margin:8px 0}.tick{font-size:11px;fill:var(--mut)}.lbl{font-size:12.5px;fill:var(--fg)}.hint{color:var(--mut);font-size:13px}small{color:var(--mut);font-weight:400}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:12px 0}.kpi{background:var(--bg);border:1px solid var(--line);border-left:5px solid var(--line);border-radius:10px;padding:10px 12px}
.kpi b{font-size:26px;display:block;line-height:1.2}.kpi span{color:var(--mut);font-size:12.5px}.kpi.good{border-left-color:var(--good)}.kpi.bad{border-left-color:var(--bad)}.kpi.warn{border-left-color:var(--warn)}.kpi.info{border-left-color:var(--blue)}
.hero{margin-top:0}.note{border-left:5px solid var(--blue);font-size:14px}.note.warnbox{border-left-color:var(--warn)}
.tablewrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}th{color:var(--mut);font-weight:600;font-size:12.5px}
tr.cur td{background:rgba(47,111,237,.12)}td.good{color:var(--good);font-weight:600}td.warn{color:var(--warn);font-weight:600}td.bad{color:var(--bad);font-weight:600}
.badge{font-size:12px;padding:3px 10px;border-radius:99px;background:var(--line);color:var(--mut)}.badge.on{background:rgba(31,157,85,.15);color:var(--good)}
.demo{background:#e08a00;color:#000;padding:10px;border-radius:8px;font-weight:700;margin:14px 0}.warn-limits{border-left:5px solid var(--warn)}code{background:var(--line);padding:1px 5px;border-radius:4px}
</style></head><body>
<header><div class="in"><h1>Voice Security Report</h1><p>Speaker model: ${esc(d.backend)} &middot; threshold in this report: ${d.threshold} &middot; generated ${esc(d.generated)}</p><p>Data: ${esc(d.datasetLabel || '')}</p></div></header>
<main>${demo}${hero}${acc}${rp}${liveSection(d.live, d.threshold)}
<section class="warn-limits"><div class="sechead"><h2>Limits - read before quoting these numbers</h2></div><ul>
<li>${A ? `${A.people} people` : 'A small set of people'} is a sanity check, not proof of bank-grade security. Studio-clean read speech is easier than a laptop microphone.</li>
<li>Replay detection only stops re-sent recordings (see section 2). It does not stop voice cloning / text-to-speech or an attacker who can make the owner say the random phrase.</li>
<li>That is why every payment also needs OTP or PIN.</li></ul></section></main>
<script>(function(){var live=document.getElementById('live'),b=document.getElementById('livebadge');if(!live)return;
if(location.protocol==='file:'){b.textContent='saved snapshot - open via the app for live updates';return;}
function tick(){fetch('/report/live',{cache:'no-store',credentials:'same-origin'}).then(function(r){if(!r.ok)throw 0;return r.text();}).then(function(h){live.innerHTML=h;b.textContent='\u25CF live - updated '+new Date().toLocaleTimeString();b.className='badge on';}).catch(function(){b.textContent='live updates paused (log in via the app)';b.className='badge';});}
tick();setInterval(tick,4000);})();</script></body></html>`;
}
module.exports = { render, liveSection, liveInner };
