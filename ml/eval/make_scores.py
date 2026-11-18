#!/usr/bin/env python
"""Computes speaker-verification scores with the SAME model + audio preprocessing as the live service and writes a
small JSON file. The report is then rendered anywhere (no model needed):
    node scripts/make_report.js --scores reports/scores_public.json

Run it where the ECAPA model works (Google Colab / Kaggle notebook / any machine with PyTorch + SpeechBrain):
    python ml/eval/make_scores.py --dir data/public_samples --out reports/scores_public.json
    python ml/eval/make_scores.py --own samples/own_18       --out reports/scores_own.json
--dir  : <dir>/<speaker>/<n>.wav  (profile from the first --enroll clips, the rest are test clips)
--own  : <dir>/<name>_voice_<n>.wav (leave-one-out, like the app's enrollment)
"""
import argparse, hashlib, io, json, re, sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
NEAR_DUP = 0.985          # same value as lib/replay.js (REPLAY_NEAR_DUP)
embed_bytes = None        # set by main() (real model) - tests may replace it


def real_embedder():
    from ml.common import audio
    from ml.service.speaker import SpeakerVerifier
    v = SpeakerVerifier()
    return (lambda raw: np.asarray(v.embed_waveform(audio.preprocess(raw, trim=True)["wave"]), dtype=np.float64),
            {"model": v.model_id, "device": v.device})


def cos(a, b):
    return float(np.dot(a, b) / ((np.linalg.norm(a) or 1.0) * (np.linalg.norm(b) or 1.0)))


class Guard:
    """Mirror of lib/replay.js: exact same audio (SHA-256) or near-identical embedding = replay."""
    def __init__(self):
        self.hashes, self.embs = set(), []

    def check(self, raw, emb):
        h = hashlib.sha256(raw).hexdigest()
        if h in self.hashes:
            return True, "same_audio", 1.0
        best = max((cos(p, emb) for p in self.embs), default=0.0)
        if best >= NEAR_DUP:
            return True, "near_duplicate", best
        self.hashes.add(h); self.embs.append(emb)
        return False, None, best


def load(args):
    by = {}
    def add(who, path):
        raw = path.read_bytes()
        try:
            by.setdefault(who, []).append({"raw": raw, "emb": embed_bytes(raw), "name": path.name})
        except Exception as e:                       # unusable clip: skip, like the service would reject it
            print(f"skip {path.name}: {e}")
    if args.dir:
        folders = sorted(p for p in Path(args.dir).iterdir() if p.is_dir())
        for i, d in enumerate(folders, 1):
            for f in sorted(d.glob("*.wav")):
                add(d.name, f)
            if i % 5 == 0:
                print(f"  embedded {i}/{len(folders)} speakers", flush=True)
    else:
        for f in sorted(Path(args.own).glob("*_voice_*.wav")):
            add(re.sub(r"_voice_\d+\.wav$", "", f.name, flags=re.I), f)
    return by


def modified_copy(raw, seed):
    """Replay of a captured clip played back louder/quieter with a little noise, re-encoded."""
    sr, x = wavfile.read(io.BytesIO(raw))
    x = x.astype(np.float64) / (32768.0 if x.dtype == np.int16 else 1.0)
    if x.ndim > 1:
        x = x.mean(axis=1)
    rng = np.random.default_rng(seed)
    y = np.clip(x * 0.7 + (rng.random(len(x)) - 0.5) * 0.004, -1, 1)
    buf = io.BytesIO(); wavfile.write(buf, sr, (y * 32767).astype(np.int16))
    return buf.getvalue()


def config(args, by, names):
    """Everything needed to repeat this run (paper 'reproducibility' section)."""
    import datetime, platform
    v = {"python": platform.python_version(), "numpy": np.__version__}
    for mod in ("torch", "torchaudio", "speechbrain", "scipy"):
        try:
            v[mod] = __import__(mod).__version__
        except Exception:
            pass
    src = Path(args.dir) / "SOURCE.txt" if args.dir else None
    return {"created_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "args": {k: v_ for k, v_ in vars(args).items()}, "versions": v, "platform": platform.platform(),
            "dataset_source": src.read_text().strip() if src and src.exists() else None,
            "model": INFO["model"], "device": INFO["device"], "near_duplicate_threshold": NEAR_DUP,
            "scoring": "cosine(mean of L2-normalised enrollment embeddings, test embedding)",
            "clips": {n: [s["name"] for s in by[n]] for n in names},
            "randomness": "none: clip choice is deterministic (see prepare_public_dataset.py); modified-copy noise uses seed = 31 * clip index"}


def run(args):
    by = load(args)
    need = args.enroll + 1 if args.dir else 3
    names = [n for n in sorted(by) if len(by[n]) >= need]
    if len(names) < 2:
        sys.exit(f"Need >= 2 people with {need}+ usable clips.")
    genuine, impostor = [], []
    trials = {"enrolled": [], "tested": [], "genuine": [], "score": []}    # one row per trial, for the paper export
    def rec(enrolled, tested, label, score):
        trials["enrolled"].append(enrolled); trials["tested"].append(tested); trials["genuine"].append(label); trials["score"].append(round(float(score), 5))
    if args.dir:
        prof = {n: np.mean([s["emb"] for s in by[n][:args.enroll]], axis=0) for n in names}
        for n in names:
            for s in by[n][args.enroll:]:
                sc = cos(prof[n], s["emb"]); genuine.append(sc); rec(n, n, 1, sc)
            for o in names:
                if o != n:
                    for s in by[o][args.enroll:]:
                        sc = cos(prof[n], s["emb"]); impostor.append(sc); rec(n, o, 0, sc)
    else:
        for n in names:
            for i, s in enumerate(by[n]):
                sc = cos(np.mean([t["emb"] for j, t in enumerate(by[n]) if j != i], axis=0), s["emb"]); genuine.append(sc); rec(n, n, 1, sc)
            p = np.mean([s["emb"] for s in by[n]], axis=0)
            for o in names:
                if o != n:
                    for s in by[o]:
                        sc = cos(p, s["emb"]); impostor.append(sc); rec(n, o, 0, sc)

    same = mod = live = total = mod_total = live_total = 0
    mod_sims, live_sims = [], []
    for n in names[: args.replay_speakers if args.dir else len(names)]:
        g = Guard()
        for k, s in enumerate(by[n]):
            total += 1
            g.check(s["raw"], s["emb"])                          # original, accepted earlier
            if g.check(s["raw"], s["emb"])[0]:                   # same audio re-sent
                same += 1
            try:
                raw2 = modified_copy(s["raw"], total * 31)
                e2 = embed_bytes(raw2); mod_total += 1
                rep, _, sim = g.check(raw2, e2)
                mod += rep; mod_sims.append(round(cos(s["emb"], e2), 4))
            except Exception as e:
                print("modified copy skipped:", e)
        g2 = Guard(); g2.check(by[n][0]["raw"], by[n][0]["emb"])
        for s in by[n][1:]:
            live_total += 1
            rep, _, sim = g2.check(s["raw"], s["emb"])
            live += rep; live_sims.append(round(sim, 4))
    out = {
        "label": args.label or ("Public dataset: LibriSpeech (clean read speech - easier than a laptop microphone)" if args.dir else "Your own recordings"),
        "backend": "ecapa", "model": INFO["model"], "device": INFO["device"], "threshold": args.threshold,
        "people": len(names), "genuine": [round(x, 5) for x in genuine], "impostor": [round(x, 5) for x in impostor],
        "replay": [
            {"label": "Same audio re-sent", "blocked": same, "total": total, "goodWhenBlocked": True},
            {"label": "Copy with changed volume + noise", "blocked": mod, "total": mod_total, "goodWhenBlocked": True},
            {"label": "Different live recording (must NOT be flagged)", "blocked": live, "total": live_total, "goodWhenBlocked": False}],
        "trials": trials,
        "config": config(args, by, names),
        "near_duplicate_threshold": NEAR_DUP,
        "copy_similarity_range": [min(mod_sims, default=None), max(mod_sims, default=None)],
        "live_similarity_max": max(live_sims, default=None),
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out))
    g_, i_ = np.array(genuine), np.array(impostor)
    print(f"{len(names)} people | owner trials {len(g_)} (mean {g_.mean():.3f}, min {g_.min():.3f}) | impostor trials {len(i_)} (mean {i_.mean():.3f}, max {i_.max():.3f})")
    print(f"At threshold {args.threshold}: FAR {(i_ >= args.threshold).mean():.2%}  FRR {(g_ < args.threshold).mean():.2%}")
    print(f"Replay: same-audio {same}/{total}, modified copy {mod}/{mod_total} (copy similarity {out['copy_similarity_range']}), live false alarms {live}/{live_total}")
    print("Wrote", args.out)


INFO = {"model": "?", "device": "?"}


def main():
    global embed_bytes, INFO
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--dir"); g.add_argument("--own")
    ap.add_argument("--out", required=True); ap.add_argument("--label")
    ap.add_argument("--enroll", type=int, default=3); ap.add_argument("--replay-speakers", type=int, default=10)
    ap.add_argument("--threshold", type=float, default=0.45)
    args = ap.parse_args()
    embed_bytes, INFO = real_embedder()
    run(args)


if __name__ == "__main__":
    main()
