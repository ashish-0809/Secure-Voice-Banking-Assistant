"""
Verification metrics, written in plain NumPy so every formula is visible and explainable.

Convention used everywhere:
    label 1 = genuine trial (test voice IS the enrolled owner)
    label 0 = impostor trial (test voice is someone else)
    the system ACCEPTS when score >= threshold

    FAR (False Acceptance Rate) = fraction of impostor trials that were accepted   (security risk)
    FRR (False Rejection Rate)  = fraction of genuine trials that were rejected    (annoyance)
    EER (Equal Error Rate)      = the point where FAR == FRR (lower is better)
"""
import numpy as np

_trapz = getattr(np, "trapezoid", None) or np.trapz


def _split(scores, labels):
    scores, labels = np.asarray(scores, dtype=float), np.asarray(labels).astype(int)
    gen, imp = np.sort(scores[labels == 1]), np.sort(scores[labels == 0])
    if len(gen) == 0 or len(imp) == 0:
        raise ValueError("Need at least one genuine and one impostor trial")
    return gen, imp


def far_frr_curve(scores, labels):
    """Return (thresholds, far, frr) evaluated at every distinct score (plus one threshold above the maximum)."""
    gen, imp = _split(scores, labels)
    thr = np.unique(np.concatenate([gen, imp]))
    thr = np.concatenate([thr, [thr[-1] + 1e-6]])
    far = (len(imp) - np.searchsorted(imp, thr, side="left")) / len(imp)
    frr = np.searchsorted(gen, thr, side="left") / len(gen)
    return thr, far, frr


def compute_eer(scores, labels):
    """Equal Error Rate by linear interpolation. Returns (eer, threshold_at_eer)."""
    thr, far, frr = far_frr_curve(scores, labels)
    diff = far - frr                       # starts positive, ends negative
    i = int(np.argmax(diff <= 0))
    if i == 0:
        return float((far[0] + frr[0]) / 2), float(thr[0])
    a = diff[i - 1] / (diff[i - 1] - diff[i])
    return float(far[i - 1] + a * (far[i] - far[i - 1])), float(thr[i - 1] + a * (thr[i] - thr[i - 1]))


def roc_curve(scores, labels):
    """ROC: x = FAR, y = TPR (= 1 - FRR), sorted by increasing FAR."""
    thr, far, frr = far_frr_curve(scores, labels)
    tpr = 1.0 - frr
    order = np.lexsort((tpr, far))          # primary key: FAR; ties broken by TPR so vertical ROC segments go UP
    return far[order], tpr[order], thr[order]


def roc_auc(scores, labels):
    fpr, tpr, _ = roc_curve(scores, labels)
    return float(_trapz(tpr, fpr))


def rates_at_threshold(scores, labels, threshold):
    scores, labels = np.asarray(scores, dtype=float), np.asarray(labels).astype(int)
    accept = scores >= threshold
    tp = int(np.sum(accept & (labels == 1)))
    fn = int(np.sum(~accept & (labels == 1)))
    fp = int(np.sum(accept & (labels == 0)))
    tn = int(np.sum(~accept & (labels == 0)))
    far, frr = fp / max(fp + tn, 1), fn / max(tp + fn, 1)
    return {"threshold": float(threshold), "tp": tp, "fn": fn, "fp": fp, "tn": tn, "far": far, "frr": frr,
            "accuracy": (tp + tn) / max(tp + tn + fp + fn, 1), "balanced_accuracy": 1.0 - (far + frr) / 2}


def threshold_at_far(scores, labels, target_far):
    """Lowest threshold whose FAR is <= target_far (security-first choice). Returns (threshold, far, frr)."""
    thr, far, frr = far_frr_curve(scores, labels)
    ok = np.where(far <= target_far)[0]
    i = int(ok[0])                         # far decreases as thr grows, so the first hit has the smallest threshold
    return float(thr[i]), float(far[i]), float(frr[i])


def min_dcf(scores, labels, p_target=0.01, c_miss=1.0, c_fa=1.0):
    """Normalised minimum detection cost (the standard speaker-verification cost metric)."""
    _, far, frr = far_frr_curve(scores, labels)
    cost = c_miss * frr * p_target + c_fa * far * (1 - p_target)
    return float(cost.min() / min(c_miss * p_target, c_fa * (1 - p_target)))


def bootstrap_eer_ci(scores, labels, n_boot=500, seed=0, alpha=0.05):
    """95% bootstrap interval for the EER. Note: trials of one speaker are correlated, so this is optimistic."""
    scores, labels = np.asarray(scores, dtype=float), np.asarray(labels).astype(int)
    rng = np.random.default_rng(seed)
    gen, imp = scores[labels == 1], scores[labels == 0]
    eers = []
    for _ in range(n_boot):
        g, i = rng.choice(gen, len(gen)), rng.choice(imp, len(imp))
        eers.append(compute_eer(np.concatenate([g, i]), np.concatenate([np.ones(len(g)), np.zeros(len(i))]))[0])
    return float(np.quantile(eers, alpha / 2)), float(np.quantile(eers, 1 - alpha / 2))


def summarize(scores, labels, threshold=None, with_ci=True):
    gen, imp = _split(scores, labels)
    eer, eer_thr = compute_eer(scores, labels)
    out = {"n_genuine": int(len(gen)), "n_impostor": int(len(imp)), "eer": eer, "eer_threshold": eer_thr,
           "auc": roc_auc(scores, labels), "min_dcf_p0.01": min_dcf(scores, labels),
           "genuine_mean": float(gen.mean()), "impostor_mean": float(imp.mean())}
    if with_ci:
        out["eer_ci95_low"], out["eer_ci95_high"] = bootstrap_eer_ci(scores, labels)
    if threshold is not None:
        out["at_threshold"] = rates_at_threshold(scores, labels, threshold)
    return out
