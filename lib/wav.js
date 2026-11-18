// Minimal WAV (PCM16) parser -> mono Float32Array at 16 kHz.
const TARGET_SR = 16000;

function parseWav(buf) {
    if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
        throw new Error('bad_wav');
    }
    let pos = 12, fmt = null, data = null;
    while (pos + 8 <= buf.length) {
        const id = buf.toString('ascii', pos, pos + 4);
        const size = buf.readUInt32LE(pos + 4);
        const body = pos + 8;
        if (id === 'fmt ') {
            fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2),
                    sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
        } else if (id === 'data') {
            data = buf.subarray(body, Math.min(body + size, buf.length));
            break;
        }
        pos = body + size + (size % 2);
    }
    if (!fmt || !data || fmt.format !== 1 || fmt.bits !== 16) throw new Error('unsupported_wav');
    const frames = Math.floor(data.length / (2 * fmt.channels));
    let x = new Float32Array(frames);
    for (let i = 0; i < frames; i++) x[i] = data.readInt16LE(i * 2 * fmt.channels) / 32768; // channel 0
    if (fmt.sampleRate !== TARGET_SR) x = resample(x, fmt.sampleRate, TARGET_SR);
    return x;
}

function resample(x, from, to) {
    const n = Math.floor(x.length * to / from), y = new Float32Array(n), r = from / to;
    for (let i = 0; i < n; i++) {
        const p = i * r, i0 = Math.floor(p), f = p - i0;
        y[i] = x[i0] * (1 - f) + (x[Math.min(i0 + 1, x.length - 1)]) * f;
    }
    return y;
}

function encodeWav(samples, sr = TARGET_SR) { // used by tests / eval tooling
    const buf = Buffer.alloc(44 + samples.length * 2);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVEfmt ', 8);
    buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
    buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
    for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
    return buf;
}

module.exports = { parseWav, encodeWav, TARGET_SR };
