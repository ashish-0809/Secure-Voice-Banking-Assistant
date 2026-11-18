"""
Audio loading and preprocessing.

The SAME function (`preprocess`) is used for dataset evaluation and, later, for audio that arrives
from the browser. That is deliberate: if training/evaluation and the live system pre-process audio
differently, the accuracy you measure is not the accuracy you get.

Steps:  decode -> mono -> resample to 16 kHz -> trim leading/trailing silence -> limit length
        -> quality checks (too short / too quiet / clipping)
"""
import io
from math import gcd

import numpy as np
from scipy.signal import resample_poly

TARGET_SR = 16000        # the ECAPA model was trained on 16 kHz mono audio
MIN_SPEECH_SEC = 1.0     # shorter clips give unreliable embeddings
MAX_SEC = 20.0           # keeps GPU memory small and time predictable
MIN_RMS_DBFS = -50.0     # quieter than this is treated as "no usable speech"
MAX_CLIPPED_RATIO = 0.10  # heavily clipped audio is rejected; mild clipping is reported as a warning


class AudioError(ValueError):
    """Raised when an audio clip cannot be used. `code` is a short machine-readable reason."""

    def __init__(self, code, detail=""):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code


def load_audio(source):
    """Read a file path or raw bytes (wav/flac/ogg). Returns (mono float32 array, sample_rate)."""
    try:
        try:
            import soundfile as sf
        except ImportError:
            sf = None
        if sf is not None:
            handle = io.BytesIO(source) if isinstance(source, (bytes, bytearray)) else str(source)
            data, sr = sf.read(handle, dtype="float32", always_2d=True)
        else:  # fallback: plain WAV only (used when soundfile is not installed)
            from scipy.io import wavfile
            handle = io.BytesIO(source) if isinstance(source, (bytes, bytearray)) else str(source)
            sr, data = wavfile.read(handle)
            if data.dtype == np.int16:
                data = data.astype(np.float32) / 32768.0
            elif data.dtype == np.int32:
                data = data.astype(np.float32) / 2147483648.0
            elif data.dtype == np.uint8:
                data = (data.astype(np.float32) - 128.0) / 128.0
            else:
                data = data.astype(np.float32)
            if data.ndim == 1:
                data = data[:, None]
    except Exception as exc:  # corrupt / unsupported file
        raise AudioError("cannot_decode", str(exc)) from exc
    return data.mean(axis=1).astype(np.float32), int(sr)   # stereo -> mono by averaging


def resample(x, sr, target=TARGET_SR):
    if sr == target:
        return x
    g = gcd(int(sr), int(target))
    return resample_poly(x, int(target) // g, int(sr) // g).astype(np.float32)


def trim_silence(x, sr, top_db=35.0, frame_ms=25, hop_ms=10, pad_ms=100):
    """Cut leading/trailing silence. A frame counts as speech if it is within `top_db` of the loudest frame."""
    frame, hop, pad = int(sr * frame_ms / 1000), int(sr * hop_ms / 1000), int(sr * pad_ms / 1000)
    if len(x) < frame:
        return x
    n = 1 + (len(x) - frame) // hop
    idx = np.arange(frame)[None, :] + hop * np.arange(n)[:, None]
    db = 10.0 * np.log10((x[idx] ** 2).mean(axis=1) + 1e-12)
    keep = np.where(db > db.max() - top_db)[0]
    if len(keep) == 0:
        return x
    return x[max(0, keep[0] * hop - pad): min(len(x), keep[-1] * hop + frame + pad)]


def preprocess(source, trim=True):
    """Full pipeline. Returns a dict with the 16 kHz waveform and quality information."""
    x, sr = load_audio(source)
    if len(x) == 0 or not np.isfinite(x).all():
        raise AudioError("invalid_samples")
    if not isinstance(sr, (int, np.integer)) or sr <= 0:
        raise AudioError("invalid_sample_rate")
    original_sec = len(x) / sr
    x = resample(x, sr, TARGET_SR)
    if trim:
        x = trim_silence(x, TARGET_SR)
    x = x[: int(MAX_SEC * TARGET_SR)]
    duration = len(x) / TARGET_SR
    if duration < MIN_SPEECH_SEC:
        raise AudioError("too_short", f"{duration:.2f}s of audio after trimming (need >= {MIN_SPEECH_SEC}s)")
    rms_dbfs = float(20.0 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12))
    if rms_dbfs < MIN_RMS_DBFS:
        raise AudioError("too_quiet", f"level {rms_dbfs:.1f} dBFS")
    clipped = float(np.mean(np.abs(x) >= 0.999))
    if clipped > MAX_CLIPPED_RATIO:
        raise AudioError("clipped_audio", f"{clipped:.1%} of samples are clipped (maximum {MAX_CLIPPED_RATIO:.0%})")
    return {
        "wave": x.astype(np.float32), "sr": TARGET_SR, "duration_sec": duration, "original_sec": original_sec,
        "original_sr": sr, "rms_dbfs": rms_dbfs, "clipped_ratio": clipped,
        "warnings": ["clipping"] if clipped > 0.01 else [],
    }
