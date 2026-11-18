// Optional server-side speech-to-text for the anti-replay challenge.
// Without it the server trusts the transcript the browser sends - fine for a demo, but a hijacked
// client could forge it. With STT_SERVICE_URL set, the server transcribes the SAME audio it
// verifies (contract: POST audio/wav -> { "text": "..." }), so the phrase must really be in the audio.
const URL_ = process.env.STT_SERVICE_URL || '';
module.exports = {
    enabled: !!URL_,
    async transcribe(wav) {
        const r = await fetch(URL_.replace(/\/$/, '') + '/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
        if (!r.ok) throw new Error('stt_error');
        return (await r.json()).text || '';
    },
};
