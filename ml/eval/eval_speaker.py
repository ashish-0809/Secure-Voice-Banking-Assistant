"""
Evaluate the pretrained ECAPA-TDNN speaker verifier on a labelled trial list.

Two protocols:
  pairs   one test list of (clip A, clip B, same-speaker?)   -> VoxCeleb1-O (standard benchmark)
  enroll  profile = average of a speaker's enrollment clips, test clips scored against it
          -> LibriSpeech lists from make_trials.py (this is how the banking app really works)

Every run writes, to ml/results/<name>/ :
  scores.csv    one row per trial with the REAL model score
  metrics.json  EER, AUC, minDCF, counts, preprocessing flags, model/library versions
  metrics.csv   the same headline numbers in one spreadsheet row

Splits (be strict about this - it is what makes the result honest):
  validation  used ONLY to choose the threshold (calibrate_threshold.py)
  test        evaluated with the threshold that was fixed on validation. Never tune on test.

Examples
  python -m ml.eval.eval_speaker enroll --enroll ml/results/trials/libri_dev_enroll.csv --trials ml/results/trials/libri_dev_trials.csv --name libri_dev --split validation
  python -m ml.eval.eval_speaker enroll --enroll ml/results/trials/libri_test_enroll.csv --trials ml/results/trials/libri_test_trials.csv --name libri_test --split test --threshold-file ml/results/thresholds.json
  python -m ml.eval.eval_speaker pairs --trials ml/results/trials/vox1o_pairs.csv --name vox1o --split test --no-threshold
"""
import argparse
import csv
import json
from collections import Counter
from datetime import datetime, timezone

from ml.common import metrics
from ml.common.paths import RESULTS, ensure_dirs
from ml.service.speaker import SpeakerVerifier


def read_csv(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def score_pairs(rows, embs):
    """rows: dicts with label,path_a,path_b,speaker_a,speaker_b. Trials whose audio could not be embedded are dropped."""
    out = []
    for i, r in enumerate(rows):
        a, b = embs.get(r["path_a"]), embs.get(r["path_b"])
        if a is None or b is None:
            continue
        out.append({"trial_id": i, "label": int(r["label"]), "score": SpeakerVerifier.score(a, b),
                    "spk_a": r["speaker_a"], "spk_b": r["speaker_b"], "path_a": r["path_a"], "path_b": r["path_b"]})
    return out


def score_enroll(enroll_rows, trial_rows, embs):
    """Profile per speaker = mean of that speaker's enrollment embeddings; each test clip is scored against one profile."""
    by_spk = {}
    for r in enroll_rows:
        if r["path"] in embs:
            by_spk.setdefault(r["speaker"], []).append(embs[r["path"]])
    profiles = {s: SpeakerVerifier.make_profile(v) for s, v in by_spk.items()}
    out = []
    for i, r in enumerate(trial_rows):
        prof, emb = profiles.get(r["enroll_speaker"]), embs.get(r["test_path"])
        if prof is None or emb is None:
            continue
        out.append({"trial_id": i, "label": int(r["label"]), "score": SpeakerVerifier.score(prof, emb),
                    "spk_a": r["enroll_speaker"], "spk_b": r["test_speaker"],
                    "path_a": f"profile:{r['enroll_speaker']}({len(by_spk[r['enroll_speaker']])} clips)", "path_b": r["test_path"]})
    return out


def check_no_overlap(calibration_speakers, eval_speakers):
    overlap = set(calibration_speakers) & set(eval_speakers)
    if overlap:
        raise SystemExit(f"DATA LEAKAGE: {len(overlap)} speakers were used to pick the threshold AND appear in this test set, e.g. {sorted(overlap)[:5]}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("protocol", choices=["pairs", "enroll"])
    ap.add_argument("--trials", required=True)
    ap.add_argument("--enroll", help="enrollment CSV (enroll protocol only)")
    ap.add_argument("--name", required=True)
    ap.add_argument("--split", required=True, choices=["validation", "test", "demo"])
    ap.add_argument("--threshold-file", default=None, help="thresholds.json produced by calibrate_threshold.py")
    ap.add_argument("--no-threshold", action="store_true", help="report threshold-free metrics only (EER/AUC)")
    ap.add_argument("--no-trim", action="store_true", help="skip silence trimming (e.g. to compare with published numbers)")
    ap.add_argument("--device", default=None, help="cuda or cpu (default: cuda if available)")
    args = ap.parse_args()

    if args.protocol == "enroll" and not args.enroll:
        raise SystemExit("--enroll is required for the enroll protocol")
    if args.split == "test" and not (args.threshold_file or args.no_threshold):
        raise SystemExit("A TEST evaluation must use a threshold fixed on validation data: pass --threshold-file "
                         "(or --no-threshold if you only want EER/AUC).")
    ensure_dirs()
    trim = not args.no_trim
    out_dir = RESULTS / args.name
    out_dir.mkdir(parents=True, exist_ok=True)

    trial_rows = read_csv(args.trials)
    enroll_rows = read_csv(args.enroll) if args.protocol == "enroll" else []
    paths = ([r["path_a"] for r in trial_rows] + [r["path_b"] for r in trial_rows]) if args.protocol == "pairs" \
        else [r["path"] for r in enroll_rows] + [r["test_path"] for r in trial_rows]

    verifier = SpeakerVerifier(device=args.device)
    print(f"Model: {verifier.model_id} on {verifier.device} | {len(set(paths))} audio files | trim={trim}")
    cache = RESULTS / "cache" / f"{args.name}{'' if trim else '_notrim'}.npz"
    embs, failed = verifier.embed_files(paths, cache_path=cache, trim=trim)

    scored = score_pairs(trial_rows, embs) if args.protocol == "pairs" else score_enroll(enroll_rows, trial_rows, embs)
    if not scored:
        raise SystemExit("No trial could be scored (all audio failed?)")

    threshold, thr_source = None, None
    if args.threshold_file and not args.no_threshold:
        cal = json.loads(open(args.threshold_file, encoding="utf-8").read())["speaker"]
        speakers = {r["spk_a"] for r in scored} | {r["spk_b"] for r in scored}
        check_no_overlap(cal["calibration_speakers"], speakers)
        threshold, thr_source = cal["threshold"], args.threshold_file
        print(f"Using threshold {threshold:.4f} (calibrated on '{cal['calibrated_on']}', method {cal['method']})")

    scores = [r["score"] for r in scored]
    labels = [r["label"] for r in scored]
    result = metrics.summarize(scores, labels, threshold=threshold)

    with open(out_dir / "scores.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["trial_id", "label", "score", "spk_a", "spk_b", "path_a", "path_b"])
        w.writeheader(); w.writerows(scored)
    if failed:
        with open(out_dir / "failed_audio.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f); w.writerow(["path", "reason"]); w.writerows(failed.items())
    report = {"name": args.name, "split": args.split, "protocol": args.protocol, "trim_silence": trim,
              "threshold_source": thr_source, "model": verifier.info(), "created": datetime.now(timezone.utc).isoformat(),
              "counts": {"trials_in_list": len(trial_rows), "trials_scored": len(scored), "trials_dropped": len(trial_rows) - len(scored),
                         "audio_files_failed": len(failed), "failure_reasons": dict(Counter(failed.values()))},
              "metrics": result}
    (out_dir / "metrics.json").write_text(json.dumps(report, indent=2))
    at = result.get("at_threshold", {})
    with open(out_dir / "metrics.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["name", "split", "protocol", "n_genuine", "n_impostor", "eer_percent", "eer_ci95_low_percent", "eer_ci95_high_percent",
                    "auc", "min_dcf", "threshold", "far_percent", "frr_percent", "accuracy_percent", "balanced_accuracy_percent"])
        pct = lambda v: "" if v is None else round(100 * v, 3)
        w.writerow([args.name, args.split, args.protocol, result["n_genuine"], result["n_impostor"], pct(result["eer"]),
                    pct(result["eer_ci95_low"]), pct(result["eer_ci95_high"]), round(result["auc"], 5), round(result["min_dcf_p0.01"], 4),
                    "" if threshold is None else round(threshold, 5), pct(at.get("far")), pct(at.get("frr")),
                    pct(at.get("accuracy")), pct(at.get("balanced_accuracy"))])

    print(f"\n=== {args.name} [{args.split.upper()}] ===")
    print(f"trials scored: {len(scored)}/{len(trial_rows)}  (genuine {result['n_genuine']}, impostor {result['n_impostor']})")
    print(f"EER: {100 * result['eer']:.2f}%  (95% CI {100 * result['eer_ci95_low']:.2f}-{100 * result['eer_ci95_high']:.2f})   AUC: {result['auc']:.4f}   minDCF(0.01): {result['min_dcf_p0.01']:.4f}")
    if at:
        print(f"At threshold {threshold:.4f}:  FAR {100 * at['far']:.2f}%   FRR {100 * at['frr']:.2f}%   accuracy {100 * at['accuracy']:.2f}%")
    print(f"Saved to {out_dir}")


if __name__ == "__main__":
    main()
