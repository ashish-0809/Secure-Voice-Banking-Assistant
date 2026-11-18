"""Small helpers shared by the evaluation, calibration and plotting scripts."""
import csv
import hashlib

import numpy as np


def load_scores(path):
    """Read a scores.csv written by eval_speaker. Returns (scores, labels, set_of_speaker_ids)."""
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        raise SystemExit(f"{path} contains no trials")
    scores = np.array([float(r["score"]) for r in rows])
    labels = np.array([int(r["label"]) for r in rows])
    speakers = {r["spk_a"] for r in rows} | {r["spk_b"] for r in rows}
    return scores, labels, speakers


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()
