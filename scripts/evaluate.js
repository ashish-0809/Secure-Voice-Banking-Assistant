#!/usr/bin/env node
// Speaker-verification evaluation: FAR, FRR, EER, authentication time.
// Usage:  node scripts/evaluate.js [dir]        (default: ./eval)
// Layout: <dir>/<speaker>/*.wav   (16-bit PCM WAV, >= 5 files per speaker, >= 2 speakers)
//   For every speaker the first 3 files (sorted) enroll the profile; the remaining files are
//   genuine trials, and every test file of every OTHER speaker is an impostor trial.
// Use the same backend you deploy with (set SPEAKER_SERVICE_URL for ECAPA-TDNN).
const fs = require('fs');
const path = require('path');
const speaker = require('../lib/speaker');

const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'eval'));
if (!fs.existsSync(dir)) { console.error(`Dataset folder not found: ${dir}\nSee the header of this file for the expected layout.`); process.exit(1); }

(async () => {
    const speakers = fs.readdirSync(dir).filter(d => fs.statSync(path.join(dir, d)).isDirectory());
    const data = {}, embedMs = [];
    for (const s of speakers) {
        const files = fs.readdirSync(path.join(dir, s)).filter(f => /\.wav$/i.test(f)).sort();
        if (files.length < 5) { console.warn(`skip ${s}: needs >= 5 wav files`); continue; }
        data[s] = [];
        for (const f of files) { const t0 = process.hrtime.bigint(); data[s].push(await speaker.embed(fs.readFileSync(path.join(dir, s, f)))); embedMs.push(Number(process.hrtime.bigint() - t0) / 1e6); }
    }
    const names = Object.keys(data);
    if (names.length < 2) { console.error('Need at least 2 speakers.'); process.exit(1); }

    const genuine = [], impostor = [];
    for (const s of names) {
        const profile = speaker.buildProfile(data[s].slice(0, 3));
        data[s].slice(3).forEach(e => genuine.push(speaker.score(profile, e).score));
        names.filter(o => o !== s).forEach(o => data[o].slice(3).forEach(e => impostor.push(speaker.score(profile, e).score)));
    }
    const rate = (arr, th, accept) => arr.filter(x => (x >= th) === accept).length / arr.length;
    const rows = [];
    for (let th = 0; th <= 1.0001; th += 0.01) rows.push({ th, far: rate(impostor, th, true), frr: rate(genuine, th, false) });
    const eer = rows.reduce((b, r) => (Math.abs(r.far - r.frr) < Math.abs(b.far - b.frr) ? r : b));
    const at = rows.reduce((b, r) => (Math.abs(r.th - speaker.THRESHOLD) < Math.abs(b.th - speaker.THRESHOLD) ? r : b));
    const pct = x => (100 * x).toFixed(1) + '%';

    console.log(`Backend: ${speaker.BACKEND} | speakers: ${names.length} | genuine trials: ${genuine.length} | impostor trials: ${impostor.length}`);
    console.log(`At configured threshold ${speaker.THRESHOLD}:  FAR ${pct(at.far)}   FRR ${pct(at.frr)}`);
    console.log(`EER ≈ ${pct((eer.far + eer.frr) / 2)} at threshold ${eer.th.toFixed(2)}  -> set SPEAKER_THRESHOLD accordingly (higher = stricter)`);
    console.log(`Mean embedding+scoring time per sample: ${(embedMs.reduce((a, b) => a + b, 0) / embedMs.length).toFixed(1)} ms`);
    console.log('\nthreshold   FAR     FRR');
    rows.filter((_, i) => i % 5 === 0).forEach(r => console.log(`${r.th.toFixed(2)}        ${pct(r.far).padStart(6)}  ${pct(r.frr).padStart(6)}`));
    console.log('\nNote: this measures speaker discrimination only. Replay resistance comes from the random challenge (test it by replaying a recording: it must fail because the phrase differs).');
})().catch(e => { console.error(e); process.exit(1); });
