// Dependency-free baseline speaker embedding: mean + std of MFCCs over voiced frames.
// This is a FALLBACK. The intended production backend is ECAPA-TDNN (see speaker_service/).
const SR = 16000, FRAME = 400, HOP = 160, NFFT = 512, NMEL = 26, NCEP = 20;
const MIN_VOICED_FRAMES = 60; // ~0.6 s of speech

const hamming = Float64Array.from({ length: FRAME }, (_, i) => 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (FRAME - 1)));

function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let cr = 1, ci = 0;
            for (let k = 0; k < len / 2; k++) {
                const a = i + k, b = a + len / 2;
                const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
                re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
                const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
            }
        }
    }
}

const hz2mel = f => 2595 * Math.log10(1 + f / 700), mel2hz = m => 700 * (10 ** (m / 2595) - 1);
const filterbank = (() => {
    const pts = Array.from({ length: NMEL + 2 }, (_, i) => mel2hz(hz2mel(80) + (hz2mel(7600) - hz2mel(80)) * i / (NMEL + 1)));
    const bins = pts.map(f => Math.floor((NFFT + 1) * f / SR));
    return Array.from({ length: NMEL }, (_, m) => {
        const w = new Float64Array(NFFT / 2 + 1);
        for (let k = bins[m]; k < bins[m + 1]; k++) w[k] = (k - bins[m]) / Math.max(1, bins[m + 1] - bins[m]);
        for (let k = bins[m + 1]; k < bins[m + 2]; k++) w[k] = (bins[m + 2] - k) / Math.max(1, bins[m + 2] - bins[m + 1]);
        return w;
    });
})();
const dct = Array.from({ length: NCEP }, (_, c) => Float64Array.from({ length: NMEL }, (_, m) => Math.cos(Math.PI * c * (m + 0.5) / NMEL)));

function embedding(samples) {
    const x = new Float32Array(samples.length);
    for (let i = 1; i < x.length; i++) x[i] = samples[i] - 0.97 * samples[i - 1]; // pre-emphasis
    const frames = [];
    for (let s = 0; s + FRAME <= x.length; s += HOP) {
        let e = 0;
        for (let i = 0; i < FRAME; i++) e += x[s + i] * x[s + i];
        const re = new Float64Array(NFFT), im = new Float64Array(NFFT);
        for (let i = 0; i < FRAME; i++) re[i] = x[s + i] * hamming[i];
        fft(re, im);
        const logmel = filterbank.map(w => {
            let acc = 0;
            for (let k = 0; k < w.length; k++) if (w[k]) acc += w[k] * (re[k] * re[k] + im[k] * im[k]);
            return Math.log(acc + 1e-10);
        });
        frames.push({ db: 10 * Math.log10(e / FRAME + 1e-10), ceps: dct.map(row => row.reduce((a, v, m) => a + v * logmel[m], 0)) });
    }
    const peak = frames.reduce((m, f) => Math.max(m, f.db), -100);
    const voiced = frames.filter(f => f.db > Math.max(peak - 30, -55));
    if (voiced.length < MIN_VOICED_FRAMES) throw new Error('too_short');
    const dims = NCEP - 1, mean = new Array(dims).fill(0), std = new Array(dims).fill(0);
    voiced.forEach(f => { for (let d = 0; d < dims; d++) mean[d] += f.ceps[d + 1] / voiced.length; });
    voiced.forEach(f => { for (let d = 0; d < dims; d++) std[d] += (f.ceps[d + 1] - mean[d]) ** 2 / voiced.length; });
    return [...mean, ...std.map(Math.sqrt)];
}

module.exports = { embedding };
