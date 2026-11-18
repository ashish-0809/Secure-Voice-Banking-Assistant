"""Needs the real model (torch + speechbrain + internet on first run). Skipped automatically if they are not installed."""
import importlib.util
import os
import unittest

import numpy as np

HAVE = all(importlib.util.find_spec(m) for m in ("torch", "speechbrain"))
RUN_REAL = os.environ.get("RUN_REAL_MODEL_TESTS") == "1"


@unittest.skipUnless(HAVE and RUN_REAL, "set RUN_REAL_MODEL_TESTS=1 with torch/speechbrain and model-download access to run real-model tests")
class RealModelTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from ml.service.speaker import SpeakerVerifier
        cls.v = SpeakerVerifier()

    def wave(self, seed):
        rng = np.random.default_rng(seed)
        t = np.arange(48000) / 16000
        f0 = rng.uniform(100, 200)
        return (0.2 * sum(np.sin(2 * np.pi * f0 * k * t) / k for k in range(1, 8)) + 0.01 * rng.normal(size=t.shape)).astype(np.float32)

    def test_embedding_shape_norm_and_determinism(self):
        a, b = self.v.embed_waveform(self.wave(1)), self.v.embed_waveform(self.wave(1))
        self.assertEqual(a.shape, (192,)); self.assertAlmostEqual(float(np.linalg.norm(a)), 1.0, places=5)
        self.assertGreater(float(np.dot(a, b)), 0.999)

    def test_different_signals_are_not_identical(self):
        self.assertLess(float(np.dot(self.v.embed_waveform(self.wave(1)), self.v.embed_waveform(self.wave(2)))), 0.999)


if __name__ == "__main__":
    unittest.main()
