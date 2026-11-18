"""
Research graphs for ONE evaluation run, drawn from its real scores.csv (nothing is typed in by hand).

  1. score distributions: genuine vs impostor    3. FAR / FRR vs threshold (EER point marked)
  2. ROC curve with AUC                          4. confusion matrix at the chosen threshold

The graph title says whether the set is VALIDATION, TEST or DEMO so results are never mixed up.
PNG files are saved at 300 dpi to ml/figures/.

Example
  python -m ml.eval.plot_speaker --run libri_test --split test --threshold-file ml/results/thresholds.json
"""
import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from ml.common import metrics
from ml.common.paths import FIGURES, RESULTS
from ml.common.scores_io import load_scores

GEN, IMP = "#1f77b4", "#d62728"


def _title(base, name, split, n_gen, n_imp):
    return f"{base}\n{name} · {split.upper()} set · {n_gen} genuine / {n_imp} impostor trials"


def make_speaker_figures(scores, labels, out_dir, name, split, threshold=None, dpi=300):
    out_dir = Path(out_dir); out_dir.mkdir(parents=True, exist_ok=True)
    scores, labels = np.asarray(scores), np.asarray(labels)
    gen, imp = scores[labels == 1], scores[labels == 0]
    eer, eer_thr = metrics.compute_eer(scores, labels)
    auc = metrics.roc_auc(scores, labels)
    thr = eer_thr if threshold is None else threshold
    thr_label = f"threshold {thr:.3f}" + (" (EER point)" if threshold is None else " (calibrated)")
    paths = []

    def finish(fig, suffix):
        p = out_dir / f"{name}_{split}_{suffix}.png"
        fig.tight_layout(); fig.savefig(p, dpi=dpi); plt.close(fig); paths.append(p)

    fig, ax = plt.subplots(figsize=(7.5, 4.8))                                    # 1. distributions
    bins = np.linspace(min(scores.min(), -0.2), max(scores.max(), 1.0), 70)
    ax.hist(imp, bins=bins, density=True, alpha=0.6, color=IMP, label=f"Impostor (n={len(imp)})")
    ax.hist(gen, bins=bins, density=True, alpha=0.6, color=GEN, label=f"Genuine (n={len(gen)})")
    ax.axvline(thr, color="k", ls="--", label=thr_label)
    ax.set_xlabel("Cosine similarity score"); ax.set_ylabel("Density"); ax.legend()
    ax.set_title(_title("Genuine vs impostor score distributions", name, split, len(gen), len(imp)), fontsize=10)
    finish(fig, "score_distribution")

    fig, ax = plt.subplots(figsize=(5.6, 5.4))                                    # 2. ROC
    fpr, tpr, _ = metrics.roc_curve(scores, labels)
    ax.plot(fpr, tpr, color=GEN, lw=2, label=f"ROC (AUC = {auc:.4f})")
    ax.plot([0, 1], [0, 1], "k:", lw=1, label="Chance")
    ax.plot([eer], [1 - eer], "o", color=IMP, label=f"EER = {100 * eer:.2f}%")
    ax.set_xlabel("False Acceptance Rate (FAR)"); ax.set_ylabel("True Acceptance Rate (1 - FRR)"); ax.legend(loc="lower right")
    ax.set_title(_title("ROC curve", name, split, len(gen), len(imp)), fontsize=10)
    finish(fig, "roc")

    fig, ax = plt.subplots(figsize=(7.5, 4.8))                                    # 3. FAR / FRR
    t, far, frr = metrics.far_frr_curve(scores, labels)
    ax.plot(t, 100 * far, color=IMP, lw=2, label="FAR (impostors accepted)")
    ax.plot(t, 100 * frr, color=GEN, lw=2, label="FRR (owners rejected)")
    ax.plot([eer_thr], [100 * eer], "ko", label=f"EER = {100 * eer:.2f}% at {eer_thr:.3f}")
    ax.axvline(thr, color="gray", ls="--", label=thr_label)
    ax.set_xlabel("Decision threshold"); ax.set_ylabel("Error rate (%)"); ax.legend()
    ax.set_title(_title("FAR and FRR versus threshold", name, split, len(gen), len(imp)), fontsize=10)
    finish(fig, "far_frr")

    r = metrics.rates_at_threshold(scores, labels, thr)                           # 4. confusion matrix
    cm = np.array([[r["tn"], r["fp"]], [r["fn"], r["tp"]]])
    fig, ax = plt.subplots(figsize=(5.2, 4.6))
    ax.imshow(cm / cm.sum(axis=1, keepdims=True), cmap="Blues", vmin=0, vmax=1)
    for i in range(2):
        for j in range(2):
            ax.text(j, i, f"{cm[i, j]}\n({100 * cm[i, j] / cm[i].sum():.1f}%)", ha="center", va="center",
                    color="white" if cm[i, j] / cm[i].sum() > 0.5 else "black")
    ax.set_xticks([0, 1], ["Rejected", "Accepted"]); ax.set_yticks([0, 1], ["Impostor", "Genuine"])
    ax.set_xlabel("System decision"); ax.set_ylabel("Actual speaker")
    ax.set_title(_title(f"Confusion matrix at {thr_label}", name, split, len(gen), len(imp)), fontsize=9)
    finish(fig, "confusion_matrix")
    return paths


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run", required=True, help="name of a run folder inside ml/results/")
    ap.add_argument("--split", required=True, choices=["validation", "test", "demo"])
    ap.add_argument("--threshold-file", default=None)
    ap.add_argument("--out-dir", default=str(FIGURES))
    args = ap.parse_args()
    scores, labels, _ = load_scores(RESULTS / args.run / "scores.csv")
    thr = json.loads(Path(args.threshold_file).read_text())["speaker"]["threshold"] if args.threshold_file else None
    for p in make_speaker_figures(scores, labels, args.out_dir, args.run, args.split, thr):
        print("saved", p)


if __name__ == "__main__":
    main()
