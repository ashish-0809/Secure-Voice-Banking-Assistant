import unittest
from statistics import NormalDist

import numpy as np

from ml.common import metrics


class MetricsTest(unittest.TestCase):
    def test_hand_computed_example(self):
        # genuine 0.4 0.8 0.9 / impostor 0.1 0.3 0.5. At threshold 0.5: FAR = 1/3, FRR = 1/3.
        scores = [0.9, 0.8, 0.4, 0.5, 0.3, 0.1]
        labels = [1, 1, 1, 0, 0, 0]
        eer, thr = metrics.compute_eer(scores, labels)
        self.assertAlmostEqual(eer, 1 / 3, places=9)
        self.assertAlmostEqual(thr, 0.5, places=9)
        r = metrics.rates_at_threshold(scores, labels, 0.5)
        self.assertEqual((r["tp"], r["fn"], r["fp"], r["tn"]), (2, 1, 1, 2))
        t, far, frr = metrics.threshold_at_far(scores, labels, 0.0)
        self.assertAlmostEqual(t, 0.8); self.assertAlmostEqual(far, 0.0); self.assertAlmostEqual(frr, 1 / 3)

    def test_perfect_separation(self):
        scores, labels = [0.9, 0.8, 0.2, 0.1], [1, 1, 0, 0]
        self.assertAlmostEqual(metrics.compute_eer(scores, labels)[0], 0.0, places=9)
        self.assertAlmostEqual(metrics.roc_auc(scores, labels), 1.0, places=9)

    def test_gaussian_scores_match_theory(self):
        # genuine ~ N(2,1), impostor ~ N(0,1): theoretical EER = Phi(-1) = 0.1587, AUC = Phi(2/sqrt(2)) = 0.9214
        rng = np.random.default_rng(0)
        g, i = rng.normal(2, 1, 40000), rng.normal(0, 1, 40000)
        scores, labels = np.concatenate([g, i]), np.concatenate([np.ones(len(g)), np.zeros(len(i))])
        nd = NormalDist()
        self.assertAlmostEqual(metrics.compute_eer(scores, labels)[0], nd.cdf(-1), delta=0.006)
        self.assertAlmostEqual(metrics.roc_auc(scores, labels), nd.cdf(2 / 2 ** 0.5), delta=0.004)

    def test_identical_distributions_give_eer_half_and_auc_half(self):
        rng = np.random.default_rng(1)
        scores, labels = rng.normal(size=40000), np.tile([0, 1], 20000)
        self.assertAlmostEqual(metrics.compute_eer(scores, labels)[0], 0.5, delta=0.01)
        self.assertAlmostEqual(metrics.roc_auc(scores, labels), 0.5, delta=0.01)

    def test_far_decreases_and_frr_increases(self):
        rng = np.random.default_rng(2)
        scores, labels = rng.normal(size=500), rng.integers(0, 2, 500)
        _, far, frr = metrics.far_frr_curve(scores, labels)
        self.assertTrue(np.all(np.diff(far) <= 1e-12)); self.assertTrue(np.all(np.diff(frr) >= -1e-12))

    def test_min_dcf_range_and_summary(self):
        scores, labels = [0.9, 0.8, 0.2, 0.1], [1, 1, 0, 0]
        self.assertAlmostEqual(metrics.min_dcf(scores, labels), 0.0, places=9)
        s = metrics.summarize(scores, labels, threshold=0.5, with_ci=False)
        self.assertEqual(s["at_threshold"]["accuracy"], 1.0)

    def test_needs_both_classes(self):
        with self.assertRaises(ValueError):
            metrics.compute_eer([0.1, 0.2], [1, 1])


if __name__ == "__main__":
    unittest.main()
