// Synthetic "speakers" (harmonic source + formant envelope) for exercising the pipeline in tests.
// NOT a substitute for real recordings - accuracy numbers must come from `npm run evaluate`.
const { encodeWav } = require('../lib/wav');

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function voice({ f0, formants }, seed, seconds = 2, variation = 0.16) {
    const r = rng(seed), sr = 16000, n = Math.floor(sr * seconds), x = new Float32Array(n);
    const jf = 1 + (r() - 0.5) * 0.06, shift = [1, 2, 3].map(() => 1 + (r() - 0.5) * variation);
    let phase = 0;
    for (let i = 0; i < n; i++) {
        const tm = i / sr, syl = 0.55 + 0.45 * Math.sin(2 * Math.PI * 3.5 * tm + r() * 0.01 + seed);
        const fo = f0 * jf * (1 + 0.03 * Math.sin(2 * Math.PI * 0.8 * tm + seed));
        phase += 2 * Math.PI * fo / sr;
        let v = 0;
        for (let h = 1; h * fo < 7500; h++) {
            const fr = h * fo;
            const env = formants.reduce((a, F, k) => a + Math.exp(-(((fr - F * shift[k]) / (F * 0.12)) ** 2)), 0);
            v += (env / h) * Math.sin(h * phase);
        }
        x[i] = 0.25 * syl * v + (r() - 0.5) * 0.004;
    }
    const peak = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0.001);
    return x.map(v => (v / peak) * 0.6);
}

const SPEAKERS = {
    owner: { f0: 115, formants: [520, 1500, 2500] },
    other1: { f0: 190, formants: [350, 2200, 3000] },
    other2: { f0: 135, formants: [720, 1150, 2350] },
};
const wavB64 = (spk, seed) => encodeWav(voice(SPEAKERS[spk], seed, 2, 0.08)).toString('base64');

module.exports = { voice, wavB64, SPEAKERS, encodeWav };
