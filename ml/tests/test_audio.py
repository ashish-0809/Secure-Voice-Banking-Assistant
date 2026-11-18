import io
import tempfile
import unittest
from pathlib import Path

import numpy as np
from scipy.io import wavfile

from ml.common import audio


def tone(sr, seconds, amp=0.3, f=220.0):
    t = np.arange(int(sr * seconds)) / sr
    return amp * np.sin(2 * np.pi * f * t) * (0.6 + 0.4 * np.sin(2 * np.pi * 3 * t))


def wav_bytes(x, sr):
    buf = io.BytesIO()
    wavfile.write(buf, sr, (np.clip(x, -1, 1) * 32767).astype(np.int16))
    return buf.getvalue()


class AudioTest(unittest.TestCase):
    def test_resamples_to_16k_mono(self):
        pre = audio.preprocess(wav_bytes(tone(44100, 3), 44100), trim=False)
        self.assertEqual(pre["sr"], 16000)
        self.assertAlmostEqual(len(pre["wave"]) / 16000, 3.0, delta=0.01)
        self.assertEqual(pre["wave"].dtype, np.float32); self.assertEqual(pre["original_sr"], 44100)

    def test_stereo_to_mono(self):
        x = tone(16000, 2); st = np.stack([x, x], axis=1)
        buf = io.BytesIO(); wavfile.write(buf, 16000, (st * 32767).astype(np.int16))
        self.assertEqual(audio.load_audio(buf.getvalue())[0].ndim, 1)

    def test_trim_removes_silence_edges(self):
        x = np.concatenate([np.zeros(16000 * 2), tone(16000, 2), np.zeros(16000 * 2)])
        pre = audio.preprocess(wav_bytes(x, 16000), trim=True)
        self.assertLess(pre["duration_sec"], 2.6); self.assertGreater(pre["duration_sec"], 1.9)

    def test_too_short_rejected(self):
        with self.assertRaises(audio.AudioError) as c:
            audio.preprocess(wav_bytes(tone(16000, 0.4), 16000))
        self.assertEqual(c.exception.code, "too_short")

    def test_too_quiet_rejected(self):
        with self.assertRaises(audio.AudioError) as c:
            audio.preprocess(wav_bytes(tone(16000, 3, amp=0.0004), 16000), trim=False)
        self.assertEqual(c.exception.code, "too_quiet")

    def test_clipping_warning_and_long_audio_cropped(self):
        pre = audio.preprocess(wav_bytes(np.clip(tone(16000, 30, amp=1.1), -1, 1), 16000), trim=False)
        self.assertIn("clipping", pre["warnings"]); self.assertLessEqual(pre["duration_sec"], audio.MAX_SEC + 1e-6)

    def test_severely_clipped_audio_rejected(self):
        # Most samples at full scale should fail the quality gate.
        x = np.ones(16000 * 2, dtype=np.float32)
        with self.assertRaises(audio.AudioError) as c:
            audio.preprocess(wav_bytes(x, 16000), trim=False)
        self.assertEqual(c.exception.code, "clipped_audio")

    def test_garbage_bytes_rejected(self):
        with self.assertRaises(audio.AudioError) as c:
            audio.load_audio(b"this is not audio")
        self.assertEqual(c.exception.code, "cannot_decode")

    def test_file_path_input(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "a.wav"; p.write_bytes(wav_bytes(tone(16000, 2), 16000))
            self.assertGreater(audio.preprocess(str(p))["duration_sec"], 1.0)


if __name__ == "__main__":
    unittest.main()
