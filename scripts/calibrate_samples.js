#!/usr/bin/env node
// Calibrates SPEAKER_THRESHOLD from the recordings in data/voice_samples/<name>_voice_<n>.wav
// (needs the speaker service running: SPEAKER_SERVICE_URL=http://127.0.0.1:5005).
// For each person: profile = mean of their first 2 samples, genuine trial = their other sample(s),
// impostor trials = every sample of every other person.
// Usage:  set SPEAKER_SERVICE_URL=http://127.0.0.1:5005 && node scripts/calibrate_samples.js [dir]
const fs = require('fs'), path = require('path');
const speaker = require('../lib/speaker');
const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data', 'voice_samples'));
if (speaker.BACKEND !== 'ecapa') { console.error('Set SPEAKER_SERVICE_URL (ECAPA service) first - MFCC numbers are not meaningful here.'); process.exit(1); }

(async () => {
    const data = {};
    for (const f of fs.readdirSync(dir).filter(f => /_voice_\d+\.wav$/i.test(f)).sort()) {
        const who = f.replace(/_voice_\d+\.wav$/i, '');
        try { (data[who] ||= []).push(await speaker.embed(fs.readFileSync(path.join(dir, f)))); }
        catch (e) { console.warn(`skip ${f}: ${e.message}`); }
    }
    const names = Object.keys(data).filter(n => data[n].length >= 3);
    if (names.length < 2) { console.error('Need >= 2 people with 3 usable samples each.'); process.exit(1); }
    const genuine = [], impostor = [];
    for (const n of names) {
        const profile = speaker.buildProfile(data[n].slice(0, 2));
        data[n].slice(2).forEach(e => genuine.push(speaker.score(profile, e).score));
        names.filter(o => o !== n).forEach(o => data[o].forEach(e => impostor.push(speaker.score(profile, e).score)));
    }
    const stat = a => `min ${Math.min(...a).toFixed(3)}  mean ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3)}  max ${Math.max(...a).toFixed(3)}`;
    console.log(`People: ${names.join(', ')}\nGenuine  (${genuine.length}): ${stat(genuine)}\nImpostor (${impostor.length}): ${stat(impostor)}`);
    const maxImp = Math.max(...impostor), minGen = Math.min(...genuine);
    console.log(`\nCurrent threshold: ${speaker.THRESHOLD}`);
    console.log(`Impostors accepted at this threshold: ${impostor.filter(x => x >= speaker.THRESHOLD).length}/${impostor.length}`);
    console.log(`Genuine rejected at this threshold:   ${genuine.filter(x => x < speaker.THRESHOLD).length}/${genuine.length}`);
    if (maxImp < minGen) console.log(`\nClean gap: set SPEAKER_THRESHOLD between ${maxImp.toFixed(2)} and ${minGen.toFixed(2)} (nearer the middle-to-high side for a bank).`);
    else console.log(`\nNo clean gap (best impostor ${maxImp.toFixed(2)} >= worst genuine ${minGen.toFixed(2)}). Keep the threshold ABOVE ${maxImp.toFixed(2)}; owners must then re-record cleaner samples.`);
    console.log('Small dataset: treat this as a sanity check, not a guarantee. Test with real friends via the app and `node scripts/last_verify.js`.');
})().catch(e => { console.error(e); process.exit(1); });
