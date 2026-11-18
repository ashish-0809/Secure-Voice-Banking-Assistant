"""Unit tests for the live speaker service; all model inference is mocked."""
import io
import unittest
from unittest.mock import Mock, patch

import numpy as np
from scipy.io import wavfile

from ml.common import audio
try:
    import flask  # noqa: F401
except ImportError:
    flask = None
if flask is not None:
    from speaker_service.app import create_app


def make_wav(seconds=2.0, amplitude=0.25, sr=16000):
    t = np.arange(int(seconds * sr), dtype=np.float32) / sr
    wave = amplitude * np.sin(2 * np.pi * 220 * t)
    out = io.BytesIO()
    wavfile.write(out, sr, (wave * 32767).astype(np.int16))
    return out.getvalue()


@unittest.skipIf(flask is None, "Flask is not installed in this environment")
class SpeakerServiceAppTests(unittest.TestCase):
    def setUp(self):
        self.verifier = Mock()
        self.verifier.embed_waveform.return_value = np.array([0.6, 0.8], dtype=np.float32)
        self.app = create_app(verifier_factory=lambda: self.verifier)
        self.app.testing = True
        self.client = self.app.test_client()

    def test_embed_reuses_shared_preprocess_and_passes_processed_wave(self):
        processed = {
            "wave": np.zeros(16000, dtype=np.float32), "sr": 16000,
            "duration_sec": 1.0, "rms_dbfs": -20.0, "clipped_ratio": 0.0,
            "warnings": [],
        }
        with patch("speaker_service.app.audio.preprocess", return_value=processed) as preprocess:
            response = self.client.post("/embed", data=b"audio-bytes")
        self.assertEqual(response.status_code, 200)
        preprocess.assert_called_once_with(b"audio-bytes", trim=True)
        self.verifier.embed_waveform.assert_called_once_with(processed["wave"])
        self.assertEqual(response.get_json()["embedding"], [np.float32(0.6), np.float32(0.8)])

    def test_empty_request_rejected_without_loading_model(self):
        response = self.client.post("/embed", data=b"")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "empty_audio")
        self.verifier.embed_waveform.assert_not_called()

    def test_invalid_and_too_short_audio_rejected(self):
        for body, expected in [(b"not audio", "cannot_decode"), (make_wav(0.25), "too_short")]:
            response = self.client.post("/embed", data=body)
            self.assertEqual(response.status_code, 400, response.get_json())
            self.assertEqual(response.get_json()["error"], expected)
        self.verifier.embed_waveform.assert_not_called()

    def test_silent_audio_rejected(self):
        response = self.client.post("/embed", data=make_wav(2.0, amplitude=0.0))
        self.assertEqual(response.status_code, 400)
        self.assertIn(response.get_json()["error"], {"too_short", "too_quiet"})
        self.verifier.embed_waveform.assert_not_called()

    def test_model_failure_returns_503_not_an_embedding(self):
        self.verifier.embed_waveform.side_effect = RuntimeError("model unavailable")
        response = self.client.post("/embed", data=make_wav())
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["error"], "speaker_model_unavailable")

    def test_health_does_not_load_model(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.get_json()["model_loaded"])
        self.assertFalse(response.get_json()["ok"])

    def test_warmup_makes_health_ready(self):
        self.verifier.info.return_value = {"model_id": "test-model", "device": "cpu"}
        self.assertTrue(self.client.post("/warmup").get_json()["ok"])
        self.assertTrue(self.client.get("/health").get_json()["ok"])


if __name__ == "__main__":
    unittest.main()
