import tempfile
import unittest
from pathlib import Path

import numpy as np

from ml.data.make_trials import build_trials, list_speaker_files
from ml.eval.eval_speaker import check_no_overlap, score_enroll, score_pairs
from ml.service.speaker import SpeakerVerifier


def fake_tree(root, n_speakers=6, chapters=3, per_chapter=5):
    """Empty files named like LibriSpeech (make_trials only lists names, it never opens them)."""
    for s in range(n_speakers):
        for c in range(chapters):
            d = Path(root) / f"{100 + s}" / f"{900 + c}"; d.mkdir(parents=True)
            for u in range(per_chapter):
                (d / f"{100 + s}-{900 + c}-{u:04d}.flac").touch()


class TrialsTest(unittest.TestCase):
    def test_trials_are_clean_and_reproducible(self):
        with tempfile.TemporaryDirectory() as d:
            fake_tree(d)
            spk = list_speaker_files(d)
            enroll, trials = build_trials(spk, 3, 5, 8, seed=7)
            enroll2, trials2 = build_trials(spk, 3, 5, 8, seed=7)
            self.assertEqual((enroll, trials), (enroll2, trials2))                 # same seed -> same lists
            self.assertNotEqual(trials, build_trials(spk, 3, 5, 8, seed=8)[1])     # different seed -> different lists
            enrolled_paths = {p for _, p in enroll}
            self.assertFalse(enrolled_paths & {r[3] for r in trials})              # enrollment clips never used as test clips
            for enroll_spk, test_spk, label, path in trials:
                self.assertEqual(label == 1, enroll_spk == test_spk)               # label matches the speaker relationship
            for s in spk:
                chapters = {Path(p).parent.name for sp, p in enroll if sp == s}
                self.assertEqual(len([1 for sp, _ in enroll if sp == s]), 3)
                self.assertGreaterEqual(len(chapters), 2)                          # enrollment spread over sessions
            self.assertEqual(sum(1 for r in trials if r[2] == 1), 6 * 5)
            self.assertEqual(sum(1 for r in trials if r[2] == 0), 6 * 8)


class ScoringTest(unittest.TestCase):
    def setUp(self):
        rng = np.random.default_rng(0)
        self.centers = {s: rng.normal(size=192) for s in "ABC"}
        self.embs = {}
        for s, c in self.centers.items():
            for k in range(8):                                           # synthetic unit embeddings: speaker centre + noise
                v = c + 0.6 * rng.normal(size=192)
                self.embs[f"{s}{k}"] = v / np.linalg.norm(v)

    def test_score_enroll_separates_synthetic_speakers(self):
        enroll = [{"speaker": s, "path": f"{s}{k}"} for s in "ABC" for k in range(3)]
        trials = [{"enroll_speaker": a, "test_speaker": b, "label": int(a == b), "test_path": f"{b}{k}"}
                  for a in "ABC" for b in "ABC" for k in range(3, 8)]
        rows = score_enroll(enroll, trials, self.embs)
        self.assertEqual(len(rows), len(trials))
        gen = [r["score"] for r in rows if r["label"] == 1]; imp = [r["score"] for r in rows if r["label"] == 0]
        self.assertGreater(min(gen), max(imp))

    def test_missing_audio_drops_trials(self):
        enroll = [{"speaker": "A", "path": "A0"}]
        trials = [{"enroll_speaker": "A", "test_speaker": "A", "label": 1, "test_path": "A1"},
                  {"enroll_speaker": "A", "test_speaker": "B", "label": 0, "test_path": "MISSING"}]
        self.assertEqual(len(score_enroll(enroll, trials, self.embs)), 1)

    def test_score_pairs(self):
        rows = [{"label": "1", "path_a": "A0", "path_b": "A1", "speaker_a": "A", "speaker_b": "A"},
                {"label": "0", "path_a": "A0", "path_b": "B1", "speaker_a": "A", "speaker_b": "B"}]
        out = score_pairs(rows, self.embs)
        self.assertGreater(out[0]["score"], out[1]["score"])

    def test_profile_is_unit_length(self):
        p = SpeakerVerifier.make_profile([self.embs["A0"], self.embs["A1"], self.embs["A2"]])
        self.assertAlmostEqual(float(np.linalg.norm(p)), 1.0, places=9)

    def test_leakage_guard(self):
        check_no_overlap({"1", "2"}, {"3", "4"})
        with self.assertRaises(SystemExit):
            check_no_overlap({"1", "2"}, {"2", "9"})


if __name__ == "__main__":
    unittest.main()
