// Summarises the voice-verification audit trail (stored in data/store.json, newest 500 events of ALL kinds).
// kind: accepted | voice (voice score too low) | phrase (voice matched, spoken phrase not recognised) |
//       recording (too short/quiet/service problem, no usable score) | replay (re-used recording)
function summarize(audit, max = 100) {
    const all = [];
    for (const a of audit || []) {
        if (a.event !== 'voice_verify') continue;
        const d = a.detail || '', m = /score=([\d.]+)/.exec(d);
        const phrase = /challenge=true/.test(d), voice = /speaker=true/.test(d), err = /err=(?!-)/.test(d), rep = /replay=(?!-)/.test(d);
        const kind = a.ok ? 'accepted' : rep ? 'replay' : err ? 'recording' : (voice && !phrase) ? 'phrase' : 'voice';
        all.push({ ts: a.ts, kind, ok: !!a.ok, replay: rep, score: m && !err ? +m[1] : null });
    }
    const n = k => all.filter(a => a.kind === k).length;
    return {
        total: all.length, accepted: n('accepted'), voice: n('voice'), phrase: n('phrase'), recording: n('recording'), replay: n('replay'),
        attempts: all.filter(a => a.score !== null).slice(-max), from: all[0] && all[0].ts, to: all.length && all[all.length - 1].ts,
    };
}
module.exports = { summarize };
