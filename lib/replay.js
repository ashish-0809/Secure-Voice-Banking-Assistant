// Replay guard for voice verification.
// Stops an attacker who captured a verification request (or its audio) and sends it again:
//  1. same_audio      - byte-identical audio (SHA-256) was already submitted for this user.
//  2. near_duplicate  - ECAPA only: a "new" clip whose embedding is almost identical (cosine >= REPLAY_NEAR_DUP) to an
//                       earlier clip. Two live utterances never match that closely; a copy that was re-encoded,
//                       re-gained or noise-added does.
// Not covered (see README): a high-quality live re-recording of the owner saying the random phrase, or voice
// cloning / text-to-speech. The random challenge phrase + speech-to-text check is the defence for the first case.
const crypto = require('crypto');

const NEAR_DUP = Number(process.env.REPLAY_NEAR_DUP) || 0.985;
const MAX_KEEP = 100;

function createGuard({ db, persist, cosine, nearDuplicateEnabled }) {
    db.replayHashes = db.replayHashes || {};          // userId -> [{ h, ts }]   (hashes only, no audio, no embeddings)
    const embs = new Map();                           // userId -> [embedding]   (memory only, biometric data is not stored)

    function check(userId, wav, emb) {
        const h = crypto.createHash('sha256').update(wav).digest('hex');
        const list = db.replayHashes[userId] = db.replayHashes[userId] || [];
        let result = { replay: false };
        if (list.some(x => x.h === h)) result = { replay: true, reason: 'same_audio', similarity: 1 };
        else if (nearDuplicateEnabled && emb) {
            const prev = embs.get(userId) || [];
            let best = 0;
            for (const p of prev) best = Math.max(best, cosine(p, emb));
            if (best >= NEAR_DUP) result = { replay: true, reason: 'near_duplicate', similarity: +best.toFixed(4) };
            else result = { replay: false, similarity: +best.toFixed(4) };
        }
        if (!result.replay) {
            list.push({ h, ts: Date.now() });
            if (list.length > MAX_KEEP) list.splice(0, list.length - MAX_KEEP);
            if (emb) { const a = embs.get(userId) || []; a.push(emb); if (a.length > MAX_KEEP) a.shift(); embs.set(userId, a); }
            persist();
        }
        return result;
    }
    return { check, NEAR_DUP };
}
module.exports = { createGuard, NEAR_DUP };
