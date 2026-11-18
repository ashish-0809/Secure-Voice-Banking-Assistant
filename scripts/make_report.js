#!/usr/bin/env node
// Builds reports/security_report.html: FAR/FRR graphs + replay-detection test + live attempts.
//   PowerShell:  $env:SPEAKER_SERVICE_URL="http://127.0.0.1:5005"; node scripts\make_report.js
//   Layout preview with made-up numbers (clearly labelled):  node scripts\make_report.js --demo
// Open the result while logged in at  http://localhost:3000/report   (or double-click the HTML file).
const fs = require('fs'), path = require('path');
const { summarize } = require('../lib/liveStats'), speaker = require('../lib/speaker'), metrics = require('../lib/metrics'), { render } = require('../lib/reportHtml');
const { createGuard } = require('../lib/replay'), { parseWav, encodeWav } = require('../lib/wav');
const root = path.join(__dirname, '..'), demo = process.argv.includes('--demo');
const argVal = (k, d) => { const i = process.argv.indexOf(k); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const scoresArg = argVal('--scores', null), thresholdArg = argVal('--threshold', null);   // --scores: render a JSON made by ml/eval/make_scores.py (no model needed)
const dirArg = argVal('--dir', null);                       // public-dataset mode: <dir>/<speaker>/<n>.wav (see ml/eval/prepare_public_dataset.py)
const ENROLL = Number(argVal('--enroll', 3)), REPLAY_SPEAKERS = Number(argVal('--replay-speakers', 10));
const label = argVal('--label', dirArg ? 'Public dataset: LibriSpeech (clean read speech - easier than a laptop microphone)' : 'Your own recordings (data/voice_samples)');
// Own recordings: prefer the 16 kHz converted copies, then the raw folder.
const samplesDir = ['data/voice_samples/converted_16k', 'data/voice_samples', 'samples/own_18'].map(d => path.join(root, d))
    .find(d => fs.existsSync(d) && fs.readdirSync(d).some(f => /_voice_\d+\.wav$/i.test(f))) || path.join(root, 'data/voice_samples');

function liveAttempts() {
    try { return summarize(JSON.parse(fs.readFileSync(path.join(root, 'data/store.json'), 'utf8')).audit); }
    catch { return summarize([]); }
}

function rng(seed) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296); }
function gauss(r, m, sd) { return m + sd * Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r()); }

async function accuracyAndReplay() {
    if (demo) {
        const r = rng(7), g = Array.from({ length: 18 }, () => gauss(r, 0.68, 0.08)), i = Array.from({ length: 90 }, () => Math.max(0, gauss(r, 0.18, 0.1)));
        return { genuine: g, impostor: i, people: 6, replay: [
            { label: 'Same audio re-sent', blocked: 18, total: 18, goodWhenBlocked: true },
            { label: 'Copy with changed volume + noise', blocked: 18, total: 18, goodWhenBlocked: true },
            { label: 'Different live recording (must NOT be flagged)', blocked: 0, total: 18, goodWhenBlocked: false }] };
    }
    if (scoresArg) {
        const j = JSON.parse(fs.readFileSync(path.resolve(scoresArg), 'utf8'));
        return { genuine: j.genuine, impostor: j.impostor, people: j.people, replay: j.replay, meta: j };
    }
    if (speaker.BACKEND !== 'ecapa') throw new Error('Set SPEAKER_SERVICE_URL (ECAPA service must be running). MFCC numbers are not meaningful.');
    const by = {};
    const add = async (who, f, buf) => {
        try { (by[who] ||= []).push({ f, wav: buf, emb: await speaker.embed(buf) }); }
        catch (e) { console.warn('skip', f, e.message); }
    };
    if (dirArg) {
        const dir = path.resolve(dirArg);
        const spk = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
        let n = 0;
        for (const who of spk) {
            for (const f of fs.readdirSync(path.join(dir, who)).filter(f => /\.wav$/i.test(f)).sort())
                await add(who, `${who}/${f}`, fs.readFileSync(path.join(dir, who, f)));
            if (++n % 5 === 0) console.log(`  embedded ${n}/${spk.length} speakers`);
        }
    } else {
        for (const f of fs.readdirSync(samplesDir).filter(f => /_voice_\d+\.wav$/i.test(f)).sort())
            await add(f.replace(/_voice_\d+\.wav$/i, ''), f, fs.readFileSync(path.join(samplesDir, f)));
    }
    const need = dirArg ? ENROLL + 1 : 3;
    const names = Object.keys(by).filter(n => by[n].length >= need);
    if (names.length < 2) throw new Error(`Need >= 2 people with ${need}+ usable recordings.`);
    const genuine = [], impostor = [];
    if (dirArg) {      // like the app: profile from the first ENROLL clips, the rest are test clips
        const prof = {};
        for (const n of names) prof[n] = speaker.buildProfile(by[n].slice(0, ENROLL).map(x => x.emb));
        for (const n of names) {
            by[n].slice(ENROLL).forEach(s => genuine.push(speaker.score(prof[n], s.emb).score));
            names.filter(o => o !== n).forEach(o => by[o].slice(ENROLL).forEach(s => impostor.push(speaker.score(prof[n], s.emb).score)));
        }
    } else {
        for (const n of names) {
            by[n].forEach((s, i) => genuine.push(speaker.score(speaker.buildProfile(by[n].filter((_, j) => j !== i).map(x => x.emb)), s.emb).score));
            const prof = speaker.buildProfile(by[n].map(x => x.emb));
            names.filter(o => o !== n).forEach(o => by[o].forEach(s => impostor.push(speaker.score(prof, s.emb).score)));
        }
    }
    // Replay tests with the real guard (in-memory db, near-duplicate check ON).
    const mk = () => createGuard({ db: {}, persist() {}, cosine: speaker.cosine, nearDuplicateEnabled: true });
    let same = 0, mod = 0, live = 0, total = 0, modTotal = 0, liveTotal = 0;
    const modSims = [], liveSims = [];
    for (const n of names.slice(0, dirArg ? REPLAY_SPEAKERS : names.length)) {
        const guard = mk();
        for (const s of by[n]) {
            total++;
            guard.check(n, s.wav, s.emb);                                            // original, accepted earlier
            if (guard.check(n, s.wav, s.emb).replay) same++;                         // byte-identical re-send
            try {
                const x = parseWav(s.wav), rr = rng(total * 31);
                const y = Float32Array.from(x, v => Math.max(-1, Math.min(1, v * 0.7 + (rr() - 0.5) * 0.004)));
                const wavMod = encodeWav(y, 16000), modEmb = await speaker.embed(wavMod);
                modTotal++; modSims.push(+speaker.cosine(s.emb, modEmb).toFixed(4));
                if (guard.check(n, wavMod, modEmb).replay) mod++;                    // copy with other volume + noise
            } catch { /* clip could not be re-encoded: not counted */ }
        }
        const g2 = mk(), first = by[n][0];
        g2.check(n, first.wav, first.emb);
        for (const s of by[n].slice(1)) { liveTotal++; const g = g2.check(n, s.wav, s.emb); liveSims.push(g.similarity || 0); if (g.replay) live++; }   // different live clip: false alarm?
    }
    return { genuine, impostor, people: names.length, replayMeta: { copyRange: [Math.min(...modSims), Math.max(...modSims)], liveMax: Math.max(...liveSims), nearDup: 0.985 }, replay: [
        { label: 'Same audio re-sent', blocked: same, total, goodWhenBlocked: true },
        { label: 'Copy with changed volume + noise', blocked: mod, total: modTotal, goodWhenBlocked: true },
        { label: 'Different live recording (must NOT be flagged)', blocked: live, total: liveTotal, goodWhenBlocked: false }] };
}

(async () => {
    fs.mkdirSync(path.join(root, 'reports'), { recursive: true });   // must exist before anything is written (zips ship without it)
    const live = liveAttempts();
    let r = null, accuracyError = null;
    try { r = await accuracyAndReplay(); } catch (e) { accuracyError = e.message; console.warn('Accuracy section skipped:', e.message); }
    const meta = r && r.meta;
    const th = thresholdArg !== null ? Number(thresholdArg) : (meta && meta.threshold) || speaker.THRESHOLD;
    const dataLabel = meta ? `${meta.label} - scores computed with ${meta.model} on ${meta.device}${thresholdArg !== null ? ` (what-if threshold ${th})` : ''}` : label;
    let data;
    if (r) {
        const pts = metrics.curve(r.genuine, r.impostor), e = metrics.eer(pts);
        data = { demo, generated: new Date().toLocaleString(), backend: demo ? 'DEMO' : (meta ? meta.backend : speaker.BACKEND), datasetLabel: demo ? 'Synthetic demo' : dataLabel, threshold: th, eerPoint: e, forFar: metrics.forFar(pts, 0.01), atThreshold: metrics.at(r.genuine, r.impostor, th),
            accuracy: { people: r.people, genuine: r.genuine, impostor: r.impostor, pts, histGen: metrics.histogram(r.genuine), histImp: metrics.histogram(r.impostor), maxImpostor: Math.max(...r.impostor), minGenuine: Math.min(...r.genuine) },
            replayTest: r.replay, replayMeta: r.replayMeta || (meta && { copyRange: meta.copy_similarity_range, liveMax: meta.live_similarity_max, nearDup: meta.near_duplicate_threshold }), live };
        if (!demo) fs.writeFileSync(path.join(root, 'reports', 'accuracy.json'), JSON.stringify({ threshold: th, eer: e, atThreshold: data.atThreshold, genuine: r.genuine, impostor: r.impostor }, null, 1));
        console.log(`At threshold ${th}: FAR ${(data.atThreshold.far * 100).toFixed(1)}%  FRR ${(data.atThreshold.frr * 100).toFixed(1)}%  | EER ${(e.rate * 100).toFixed(1)}% @ ${e.t.toFixed(2)}`);
    } else {
        // Still produce the live-attempts section and say clearly what is missing.
        data = { demo, generated: new Date().toLocaleString(), backend: speaker.BACKEND, datasetLabel: label, threshold: th, accuracy: null, accuracyError, replayTest: null, live };
    }
    fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
    const out = path.join(root, 'reports', demo ? 'security_report_DEMO.html' : scoresArg ? `security_report_${path.basename(scoresArg, '.json')}.html` : dirArg ? 'security_report_public.html' : 'security_report.html');
    fs.writeFileSync(out, render(data));
    console.log('Report written:', out);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
