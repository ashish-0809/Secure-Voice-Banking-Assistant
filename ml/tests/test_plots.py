"""Checks that the plotting code runs and writes PNGs. The scores here are random test data, written to a temp folder only."""
import tempfile
import unittest
from pathlib import Path

import numpy as np

from ml.eval.plot_speaker import make_speaker_figures


class PlotTest(unittest.TestCase):
    def test_figures_are_written(self):
        rng = np.random.default_rng(0)
        scores = np.concatenate([rng.normal(0.7, 0.1, 300), rng.normal(0.1, 0.15, 900)])
        labels = np.concatenate([np.ones(300), np.zeros(900)])
        with tempfile.TemporaryDirectory() as d:
            paths = make_speaker_figures(scores, labels, d, "unit_test", "demo", threshold=0.4, dpi=80)
            self.assertEqual(len(paths), 4)
            for p in paths:
                self.assertTrue(Path(p).exists() and Path(p).stat().st_size > 5000)


if __name__ == "__main__":
    unittest.main()
