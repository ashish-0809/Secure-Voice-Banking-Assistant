# ml/ - deep-learning speaker verification (Stages 1-3)

The Node.js app (`server.js`) is unchanged. This folder adds the **Python machine-learning part**:
a pretrained **ECAPA-TDNN** neural network that decides *"is this the account owner's voice?"*,
plus the code that measures how well it works on real datasets.

## The idea in 6 sentences (for your viva)
1. Speech recognition tells us *what* was said; speaker verification tells us *who* said it.
2. A neural network (ECAPA-TDNN, trained by SpeechBrain on VoxCeleb) turns a voice clip into an **embedding**: 192 numbers describing the speaker's voice.
3. **Enrollment:** the owner records 3-5 clips; we average their embeddings into a **voice profile**.
4. **Verification:** embed the new clip and compute the **cosine similarity** with the profile (1 = identical, 0 = unrelated).
5. Accept only if similarity >= a **threshold**. The threshold is not guessed - it is chosen on *validation* speakers (e.g. "at most 1% of impostors accepted").
6. We then report honest results on **test** speakers the threshold never saw: **FAR** (impostors accepted), **FRR** (owners rejected), **EER**, ROC/AUC.

We do **not** train the network (that would need weeks of GPU time); we use the published model and *evaluate* it.

## Folder map
| Path | Purpose |
|---|---|
| `check_env.py`, `setup_windows.ps1`, `requirements.txt` | Stage 1: install + environment check |
| `common/audio.py` | load -> mono -> 16 kHz -> trim silence -> quality checks (same code later used for live audio) |
| `common/metrics.py` | EER, ROC/AUC, FAR/FRR, minDCF written in plain NumPy |
| `service/speaker.py` | loads the ECAPA-TDNN model, makes embeddings, profiles, similarity |
| `data/DATASETS.md`, `make_trials.py`, `prepare_voxceleb.py` | Stage 2: datasets + speaker-disjoint trial lists |
| `eval/eval_speaker.py`, `calibrate_threshold.py`, `plot_speaker.py` | Stage 3: scores, threshold, graphs |
| `reproduce_speaker.ps1` | runs everything in order |
| `tests/` | unit tests (`python -m unittest discover -s ml/tests -t . -v`) |
| `results/` , `figures/` | outputs: CSV/JSON and 300-dpi PNGs |

## Commands (Windows PowerShell, from the project root)
```powershell
# Stage 1 - once
Set-ExecutionPolicy -Scope Process Bypass
.\ml\setup_windows.ps1
.\ml\.venv\Scripts\Activate.ps1
python ml\check_env.py --load-model

# Stage 2 - download datasets by following ml\data\DATASETS.md, then:
# Stage 3 - everything in one go
.\ml\reproduce_speaker.ps1
```

## Why validation and test are separate
If the threshold were tuned on the same speakers we report, the result would look better than reality
(data leakage). So: **validation speakers (LibriSpeech dev-clean) pick the threshold; test speakers (test-clean) are
evaluated with that fixed threshold.** The code enforces it: `eval_speaker` refuses a `--split test` run without a
threshold file, and stops if a speaker appears in both sets.

## Result labels
Every graph and metrics file says VALIDATION, TEST or DEMO. Only TEST numbers (threshold fixed beforehand) are final results.
VoxCeleb1-O is reported separately as a benchmark check against the ~0.8% EER the model's authors publish.
