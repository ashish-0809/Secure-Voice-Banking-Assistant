"""
Choose the accept/reject threshold from VALIDATION scores only, and save it to thresholds.json.

Two ways to choose:
  --method far --target-far 0.01   (default) the lowest threshold that lets at most 1% of impostors in.
                                   Right choice for banking: a false accept is worse than asking the owner to retry.
  --method eer                     the point where false accepts and false rejects are equal.

The file records exactly which validation data/speakers were used, so the test script can refuse to
evaluate on any of those speakers.

Example
  python -m ml.eval.calibrate_threshold --scores ml/results/libri_dev/scores.csv --target-far 0.01
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from ml.common import metrics
from ml.common.paths import RESULTS, THRESHOLDS_FILE
from ml.common.scores_io import load_scores, sha256_file


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scores", required=True, help="scores.csv of the VALIDATION run")
    ap.add_argument("--method", choices=["far", "eer"], default="far")
    ap.add_argument("--target-far", type=float, default=0.01)
    ap.add_argument("--out", default=str(THRESHOLDS_FILE))
    args = ap.parse_args()

    scores, labels, speakers = load_scores(args.scores)
    eer, eer_thr = metrics.compute_eer(scores, labels)
    if args.method == "far":
        thr, far, frr = metrics.threshold_at_far(scores, labels, args.target_far)
    else:
        thr = eer_thr
        r = metrics.rates_at_threshold(scores, labels, thr)
        far, frr = r["far"], r["frr"]

    calibrated_on = Path(args.scores).parent.name
    model_id = None
    mj = Path(args.scores).parent / "metrics.json"
    if mj.exists():
        info = json.loads(mj.read_text())
        calibrated_on = info.get("name", calibrated_on)
        model_id = info["model"]["model_id"]
        if info.get("split") != "validation":
            raise SystemExit(f"Refusing: these scores are from a '{info.get('split')}' run. Calibrate on a VALIDATION run only.")
    entry = {"threshold": thr, "method": args.method, "target_far": args.target_far if args.method == "far" else None,
             "validation_far": far, "validation_frr": frr, "validation_eer": eer, "calibrated_on": calibrated_on,
             "n_genuine": int((labels == 1).sum()), "n_impostor": int((labels == 0).sum()),
             "calibration_speakers": sorted(speakers), "scores_file": str(args.scores), "scores_sha256": sha256_file(args.scores),
             "model_id": model_id, "created": datetime.now(timezone.utc).isoformat()}
    out = Path(args.out)
    data = json.loads(out.read_text()) if out.exists() else {}
    data["speaker"] = entry                    # other components (anti-spoofing) add their own key later
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2))
    print(f"Validation EER: {100 * eer:.2f}%")
    print(f"Chosen threshold ({args.method}): {thr:.4f}  ->  validation FAR {100 * far:.2f}%, FRR {100 * frr:.2f}%")
    print(f"Saved to {out}\nNow run the TEST evaluation with --threshold-file {out}")


if __name__ == "__main__":
    main()
