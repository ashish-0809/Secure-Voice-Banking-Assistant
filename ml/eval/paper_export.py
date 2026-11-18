#!/usr/bin/env python
"""Paper-ready results from a scores JSON written by ml/eval/make_scores.py.

    python ml/eval/paper_export.py --scores reports/scores_public.json --out paper/public --seed 1

What it does (all numbers come from the trials in the JSON, nothing is typed in by hand):
  1. Speaker-DISJOINT dev/test split. The decision threshold is chosen on the dev speakers only (rule: --rule far:0.01
     = lowest threshold with dev FAR <= 1 %, or --rule eer); error rates are then reported on the unseen test speakers.
  2. 95 % confidence intervals by cluster bootstrap over enrolled speakers (--boot resamples).
  3. Files: trials.csv, results.json, table_summary.tex, table_thresholds.tex, methods_text.txt,
     fig_far_frr / fig_det / fig_roc / fig_hist as .png (300 dpi) and .pdf (vector).
Re-running with the same --seed gives identical numbers.
"""
import argparse, csv, json, sys
from pathlib import Path

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy.stats import norm


# ---------------------------------------------------------------- metrics
def far_frr_at(g, i, t):
    return float((i >= t).mean()), float((g < t).mean())          # FAR, FRR


def sweep(g, i):
    t = np.unique(np.concatenate([g, i, [0.0, 1.0]]))
    gs, is_ = np.sort(g), np.sort(i)
    frr = np.searchsorted(gs, t, side="left") / len(g)              # genuine trials below t
    far = 1.0 - np.searchsorted(is_, t, side="left") / len(i)       # impostor trials at/above t
    return t, far, frr


def eer(g, i):
    t, far, frr = sweep(g, i)
    k = int(np.argmin(np.abs(far - frr)))
    return float((far[k] + frr[k]) / 2), float(t[k])


def threshold_for_far(g, i, target):
    t, far, _ = sweep(g, i)
    k = int(np.argmax(far <= target))                               # first (lowest) t with FAR <= target
    return float(t[k])


def pick_threshold(g, i, rule):
    if rule == "eer":
        return eer(g, i)[1]
    kind, _, val = rule.partition(":")
    if kind == "far":
        return threshold_for_far(g, i, float(val))
    raise SystemExit(f"unknown --rule {rule!r} (use eer or far:0.01)")


# ---------------------------------------------------------------- data
def load(path):
    j = json.loads(Path(path).read_text())
    t = j.get("trials")
    if not t:
        raise SystemExit("This scores file has no per-trial records. Re-run ml/eval/make_scores.py (v23 or newer).")
    return j, np.array(t["enrolled"]), np.array(t["tested"]), np.array(t["genuine"], dtype=bool), np.array(t["score"], dtype=float)


def by_enrolled(enr, tst, lab, sc, speakers):
    out = {}
    for s in speakers:
        m = enr == s
        out[s] = (sc[m & lab], sc[m & ~lab])
    return out


def pool(d, chosen):
    return np.concatenate([d[s][0] for s in chosen]), np.concatenate([d[s][1] for s in chosen])


def bootstrap(d, speakers, t, B, rng):
    far, frr, e = [], [], []
    for _ in range(B):
        pick = rng.choice(speakers, size=len(speakers), replace=True)
        g, i = pool(d, pick)
        if len(g) == 0 or len(i) == 0:
            continue
        f, r = far_frr_at(g, i, t); far.append(f); frr.append(r); e.append(eer(g, i)[0])
    q = lambda a: [float(np.percentile(a, 2.5)), float(np.percentile(a, 97.5))]
    return {"far": q(far), "frr": q(frr), "eer": q(e), "resamples": len(far)}


# ---------------------------------------------------------------- output helpers
pc = lambda x: f"{100 * x:.2f}"
def tex_ci(v, ci):
    return f"{pc(v)} [{pc(ci[0])}, {pc(ci[1])}]"


def save(fig, out, name):
    fig.tight_layout()
    fig.savefig(out / f"{name}.png", dpi=300)
    fig.savefig(out / f"{name}.pdf")
    plt.close(fig)


def make_figures(out, g, i, t_sel, label):
    plt.rcParams.update({"font.size": 10, "axes.grid": True, "grid.alpha": 0.3})
    t, far, frr = sweep(g, i)
    e_rate, e_t = eer(g, i)
    fig, ax = plt.subplots(figsize=(5.5, 3.6))                      # FAR / FRR vs threshold
    ax.plot(t, far * 100, color="#d62839", label="FAR (impostor accepted)")
    ax.plot(t, frr * 100, color="#2f6fed", label="FRR (owner rejected)")
    ax.axvline(t_sel, color="k", ls="--", lw=1, label=f"chosen threshold {t_sel:.2f}")
    ax.plot([e_t], [e_rate * 100], "o", color="#e08a00", label=f"EER {e_rate * 100:.2f}%")
    ax.set(xlabel="Decision threshold (cosine score)", ylabel="Error rate (%)", xlim=(0, 1), ylim=(0, 100)); ax.legend(fontsize=8)
    save(fig, out, "fig_far_frr")

    fig, ax = plt.subplots(figsize=(4.4, 4.4))                      # DET (normal-deviate axes)
    eps = 1e-4; z = lambda x: norm.ppf(np.clip(x, eps, 1 - eps))
    ax.plot(z(far), z(frr), color="#2f6fed")
    ticks = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 40]
    ax.set_xticks([z(x / 100) for x in ticks]); ax.set_xticklabels([str(x) for x in ticks])
    ax.set_yticks([z(x / 100) for x in ticks]); ax.set_yticklabels([str(x) for x in ticks])
    ax.set(xlabel="False accept rate (%)", ylabel="False reject rate (%)", xlim=(z(0.001), z(0.5)), ylim=(z(0.001), z(0.5)))
    ax.plot([z(e_rate)], [z(e_rate)], "o", color="#e08a00", label=f"EER {e_rate * 100:.2f}%"); ax.legend(fontsize=8)
    save(fig, out, "fig_det")

    fig, ax = plt.subplots(figsize=(4.4, 4.0))                      # ROC: genuine accept vs FAR
    ax.plot(far * 100, (1 - frr) * 100, color="#1f9d55")
    ax.set(xlabel="False accept rate (%)", ylabel="True accept rate (%)", xlim=(0, 20), ylim=(0, 100))
    save(fig, out, "fig_roc")

    fig, ax = plt.subplots(figsize=(5.5, 3.6))                      # score distributions (share of each group)
    bins = np.linspace(0, 1, 41)
    ax.hist(i, bins=bins, weights=np.full(len(i), 100 / len(i)), color="#d62839", alpha=0.7, label=f"impostor (n={len(i)})")
    ax.hist(g, bins=bins, weights=np.full(len(g), 100 / len(g)), color="#1f9d55", alpha=0.7, label=f"owner (n={len(g)})")
    ax.axvline(t_sel, color="k", ls="--", lw=1, label=f"threshold {t_sel:.2f}")
    ax.set(xlabel="Cosine similarity score", ylabel="Share of trials (%)"); ax.legend(fontsize=8)
    save(fig, out, "fig_hist")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scores", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=1); ap.add_argument("--dev-fraction", type=float, default=0.5)
    ap.add_argument("--rule", default="far:0.01"); ap.add_argument("--boot", type=int, default=2000)
    ap.add_argument("--no-anonymize", action="store_true", help="keep real speaker names (default: replace non-numeric names by S01, S02, ...)")
    a = ap.parse_args()
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    j, enr, tst, lab, sc = load(a.scores)
    speakers = sorted(set(enr.tolist()))
    mapping = {}
    if not a.no_anonymize and not all(x.isdigit() for x in speakers):      # real names -> S01..., mapping stays private
        mapping = {x: f"S{k:02d}" for k, x in enumerate(speakers, 1)}
        enr = np.array([mapping[x] for x in enr]); tst = np.array([mapping[x] for x in tst])
        if j.get("config", {}).get("clips"):
            j["config"]["clips"] = {mapping[k]: [f"{mapping[k]}_clip{n}" for n, _ in enumerate(v, 1)] for k, v in j["config"]["clips"].items()}
        speakers = sorted(set(enr.tolist()))
        (out / "speaker_map.PRIVATE_do_not_publish.json").write_text(json.dumps(mapping, indent=1))
    if len(speakers) < 4:
        raise SystemExit("Need at least 4 speakers for a speaker-disjoint dev/test split.")
    app_t = float(j.get("threshold", 0.45))

    with open(out / "trials.csv", "w", newline="") as f:               # raw trials: anyone can recompute everything
        w = csv.writer(f, lineterminator="\n"); w.writerow(["enrolled_speaker", "tested_speaker", "is_genuine", "score"])
        w.writerows(zip(enr, tst, lab.astype(int), sc))

    rng = np.random.default_rng(a.seed)
    perm = list(rng.permutation(speakers)); n_dev = max(2, min(len(speakers) - 2, round(a.dev_fraction * len(speakers))))
    dev, test = sorted(perm[:n_dev]), sorted(perm[n_dev:])
    in_set = lambda S: np.isin(enr, S) & np.isin(tst, S)             # speaker-disjoint: enrolled AND tested speakers in the set
    D = by_enrolled(enr, tst, lab, sc, speakers)
    mdev, mtest, mall = in_set(dev), in_set(test), np.ones(len(sc), bool)
    sets = {}
    for name, m in (("dev", mdev), ("test", mtest), ("all", mall)):
        sets[name] = (sc[m & lab], sc[m & ~lab])
        if len(sets[name][0]) == 0 or len(sets[name][1]) == 0:
            raise SystemExit(f"Split '{name}' has no genuine or impostor trials.")

    t_sel = pick_threshold(*sets["dev"], a.rule)
    # bootstrap on the test split: resample enrolled speakers, keep trials restricted to test speakers
    Dt = {s: (sc[(enr == s) & lab & np.isin(tst, test)], sc[(enr == s) & ~lab & np.isin(tst, test)]) for s in test}
    boot = bootstrap(Dt, test, t_sel, a.boot, np.random.default_rng(a.seed + 1))
    Dall = D
    boot_all = bootstrap(Dall, speakers, t_sel, a.boot, np.random.default_rng(a.seed + 2))

    def summary(name, ci):
        g, i = sets[name]; far, frr = far_frr_at(g, i, t_sel); e_rate, e_t = eer(g, i)
        r = {"genuine_trials": int(len(g)), "impostor_trials": int(len(i)), "far": far, "frr": frr, "eer": e_rate, "eer_threshold": e_t,
             "balanced_accuracy": 1 - (far + frr) / 2}
        if ci: r["ci95"] = ci
        return r
    res = {"config": j.get("config"), "scores_file": Path(a.scores).name, "seed": a.seed, "rule": a.rule, "chosen_threshold": t_sel,
           "app_threshold_in_scores_file": app_t,
           "split": {"dev_speakers": dev, "test_speakers": test, "n_dev": len(dev), "n_test": len(test)},
           "dev": summary("dev", None), "test": summary("test", boot), "all_speakers_not_independent": summary("all", boot_all),
           "at_app_threshold": {"threshold": app_t, **dict(zip(("far", "frr"), far_frr_at(*sets["all"], app_t)))},
           "replay": j.get("replay"), "copy_similarity_range": j.get("copy_similarity_range"), "live_similarity_max": j.get("live_similarity_max")}
    (out / "results.json").write_text(json.dumps(res, indent=1))

    # ---- LaTeX
    T, Dv, A = res["test"], res["dev"], res["all_speakers_not_independent"]
    cap = (r"\begin{table}[t]\centering\caption{Speaker verification error rates (\%). Threshold chosen on dev speakers (rule: @RULE@) = @T@; "
           r"test speakers are disjoint from dev speakers. 95\% confidence intervals: cluster bootstrap over enrolled speakers (@B@ resamples).}")
    cap = cap.replace("@RULE@", a.rule.replace("_", r"\_")).replace("@T@", f"{t_sel:.3f}").replace("@B@", str(boot["resamples"]))
    tex = [cap,
           r"\begin{tabular}{lrrrr}\hline Set & Owner trials & Impostor trials & FAR [95\% CI] & FRR [95\% CI]\\\hline",
           f"Dev ({len(dev)} spk) & {Dv['genuine_trials']} & {Dv['impostor_trials']} & {pc(Dv['far'])} & {pc(Dv['frr'])}" + r"\\",
           f"Test ({len(test)} spk) & {T['genuine_trials']} & {T['impostor_trials']} & {tex_ci(T['far'], boot['far'])} & {tex_ci(T['frr'], boot['frr'])}" + r"\\",
           f"EER (test) & \\multicolumn{{4}}{{r}}{{{tex_ci(T['eer'], boot['eer'])}}}" + r"\\\hline\end{tabular}\end{table}"]
    (out / "table_summary.tex").write_text("\n".join(tex) + "\n")
    g, i = sets["test"]; rows = []
    for th in sorted({0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, round(t_sel, 2)}):
        f, r = far_frr_at(g, i, th); rows.append(f"{th:.2f} & {pc(f)} & {pc(r)}\\\\")
    (out / "table_thresholds.tex").write_text(
        "\\begin{table}[t]\\centering\\caption{FAR and FRR (\\%) on the test speakers for fixed thresholds.}\n\\begin{tabular}{rrr}\\hline "
        "Threshold & FAR & FRR\\\\\\hline\n" + "\n".join(rows) + "\n\\hline\\end{tabular}\\end{table}\n")
    make_figures(out, g, i, t_sel, a.scores)

    cfg = j.get("config") or {}
    (out / "methods_text.txt").write_text(
        f"DRAFT METHODS TEXT (check every sentence against what you actually did; add citations: ECAPA-TDNN, SpeechBrain, the dataset).\n\n"
        f"Speaker embeddings were extracted with the pretrained {cfg.get('model', 'ECAPA-TDNN')} model (SpeechBrain, "
        f"{(cfg.get('versions') or {}).get('speechbrain', '?')}; {cfg.get('device', '?')}). Each speaker was enrolled with the mean of "
        f"{(cfg.get('args') or {}).get('enroll', 3)} L2-normalised embeddings, and a trial score is the cosine similarity between this profile "
        f"and the embedding of a test clip. {len(speakers)} speakers were split at random (seed {a.seed}) into {len(dev)} development and "
        f"{len(test)} test speakers with no overlap. The decision threshold ({t_sel:.3f}) was selected on the development speakers only "
        f"(rule: {a.rule}) and then applied unchanged to the test speakers: FAR = {pc(T['far'])}% [{pc(boot['far'][0])}, {pc(boot['far'][1])}] "
        f"({T['impostor_trials']} impostor trials), FRR = {pc(T['frr'])}% [{pc(boot['frr'][0])}, {pc(boot['frr'][1])}] "
        f"({T['genuine_trials']} genuine trials), EER = {pc(T['eer'])}%. Confidence intervals are 95% percentile intervals from "
        f"{boot['resamples']} bootstrap resamples of enrolled speakers.\n\nDataset: {cfg.get('dataset_source') or 'describe the dataset'}\n")
    print(f"threshold {t_sel:.3f} (rule {a.rule}, chosen on {len(dev)} dev speakers)")
    ci = lambda c: f"[{pc(c[0])}, {pc(c[1])}]"
    print(f"TEST  FAR {pc(T['far'])}% {ci(boot['far'])}   FRR {pc(T['frr'])}% {ci(boot['frr'])}   EER {pc(T['eer'])}% {ci(boot['eer'])}")
    print("Wrote", out.resolve())


if __name__ == "__main__":
    main()
