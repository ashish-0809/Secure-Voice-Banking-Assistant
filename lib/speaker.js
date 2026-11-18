// Owner-specific speaker verification.
//   backend "ecapa": ECAPA-TDNN embeddings from the Python microservice (set SPEAKER_SERVICE_URL)
//   backend "mfcc" : dependency-free baseline (works out of the box, much weaker)
const { parseWav } = require('./wav');
const mfcc = require('./mfcc');

const SERVICE_URL = process.env.SPEAKER_SERVICE_URL || '';
const BACKEND = SERVICE_URL ? 'ecapa' : 'mfcc';
// Decision thresholds. MUST be calibrated on real recordings: run `node scripts/calibrate_samples.js`.
// ECAPA default 0.45, chosen from the LibriSpeech train-clean-100 test (60 speakers, 10,620 impostor trials): FAR 0.23%, FRR 1.1%
// (0.55 gave FAR ~0.01% but rejected 3.3% of owner trials and several live attempts of the owner on a laptop mic).
// Too many false rejections of the owner? Calibrate and lower it a little - never below the highest impostor score.
const THRESHOLD = Number(process.env.SPEAKER_THRESHOLD) || (BACKEND === 'ecapa' ? 0.45 : 0.25);
const MIN_ENROLL = 3, MAX_ENROLL = 5;
// Samples of one enrollment must resemble each other (rejects another speaker / noise). Independent of the accept threshold.
const ENROLL_CONSISTENCY = Number(process.env.ENROLL_CONSISTENCY) || (BACKEND === 'ecapa' ? 0.35 : 0.2);
const FLOOR_MEAN = 0.9, FLOOR_STD = 0.45; // variance floors for the mfcc backend

async function embed(wavBuffer) {
    const samples = parseWav(wavBuffer);               // validates the WAV
    if (samples.length < 16000 * 0.8) throw new Error('too_short');
    if (BACKEND === 'mfcc') return mfcc.embedding(samples);
    const r = await fetch(SERVICE_URL.replace(/\/$/, '') + '/embed', {
        method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wavBuffer,
    });
    if (!r.ok) {
        // Keep a machine-readable reason in the server audit log while the UI stays generic.
        let reason = `http_${r.status}`;
        try {
            const body = await r.json();
            if (body && typeof body.error === 'string') reason = body.error;
        } catch {}
        throw new Error(`speaker_service_${reason}`);
    }
    const body = await r.json();
    if (!Array.isArray(body.embedding) || body.embedding.length !== 192 || body.embedding.some(v => !Number.isFinite(v))) {
        throw new Error('speaker_service_invalid_embedding');
    }
    return body.embedding;
}

const cosine = (a, b) => {
    let d = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
    return d / (Math.sqrt(na * nb) || 1);
};

function buildProfile(embs) {
    const dim = embs[0].length, n = embs.length;
    const mean = Array.from({ length: dim }, (_, i) => embs.reduce((s, e) => s + e[i], 0) / n);
    const std = Array.from({ length: dim }, (_, i) => Math.sqrt(embs.reduce((s, e) => s + (e[i] - mean[i]) ** 2, 0) / n));
    return { backend: BACKEND, count: n, mean, std, created: new Date().toISOString() };
}

// score in (0,1]; higher = more likely the enrolled owner
function score(profile, emb) {
    if (profile.backend !== BACKEND) throw new Error('backend_mismatch'); // re-enroll after switching backends
    let s;
    if (BACKEND === 'ecapa') {
        s = cosine(profile.mean, emb);
    } else { // per-dimension normalised distance, with a variance floor so 3 samples don't over-fit
        let acc = 0;
        for (let i = 0; i < emb.length; i++) {
            const sd = Math.max(profile.std[i], i < emb.length / 2 ? FLOOR_MEAN : FLOOR_STD);
            acc += ((emb[i] - profile.mean[i]) / sd) ** 2;
        }
        s = 1 / (1 + Math.sqrt(acc / emb.length));
    }
    return { score: s, pass: s >= THRESHOLD };
}

// Leave-one-out check so one stray sample (other person / noise) cannot poison the profile.
function consistent(embs) {
    return embs.every((e, i) => {
        const rest = embs.filter((_, j) => j !== i);
        return score(buildProfile(rest), e).score >= ENROLL_CONSISTENCY;
    });
}

module.exports = { cosine, embed, buildProfile, score, consistent, BACKEND, THRESHOLD, MIN_ENROLL, MAX_ENROLL };
