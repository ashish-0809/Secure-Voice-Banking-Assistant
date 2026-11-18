# Reproduces ALL speaker-verification results (stages 1-3) from the downloaded datasets.
# Run from the PROJECT ROOT after following ml\data\DATASETS.md:
#     .\ml\.venv\Scripts\Activate.ps1
#     .\ml\reproduce_speaker.ps1
$ErrorActionPreference = "Stop"
function Run($cmd) { Write-Host "`n>>> $cmd" -ForegroundColor Cyan; Invoke-Expression $cmd; if ($LASTEXITCODE -ne 0) { throw "FAILED: $cmd" } }

$dev  = "ml\data_raw\LibriSpeech\dev-clean"
$test = "ml\data_raw\LibriSpeech\test-clean"
if (-not (Test-Path $dev) -or -not (Test-Path $test)) { throw "LibriSpeech not found. Follow ml\data\DATASETS.md section 1." }

# 1. Trial lists (speaker-disjoint; leakage guard on the test list)
Run "python -m ml.data.make_trials --root $dev  --name libri_dev"
Run "python -m ml.data.make_trials --root $test --name libri_test --forbid-speakers-from ml\results\trials\libri_dev_meta.json"

# 2. VALIDATION: real model scores -> choose the threshold (never uses test data)
Run "python -m ml.eval.eval_speaker enroll --enroll ml\results\trials\libri_dev_enroll.csv --trials ml\results\trials\libri_dev_trials.csv --name libri_dev --split validation"
Run "python -m ml.eval.calibrate_threshold --scores ml\results\libri_dev\scores.csv --method far --target-far 0.01"
Run "python -m ml.eval.plot_speaker --run libri_dev --split validation --threshold-file ml\results\thresholds.json"

# 3. TEST: other speakers, threshold fixed from validation
Run "python -m ml.eval.eval_speaker enroll --enroll ml\results\trials\libri_test_enroll.csv --trials ml\results\trials\libri_test_trials.csv --name libri_test --split test --threshold-file ml\results\thresholds.json"
Run "python -m ml.eval.plot_speaker --run libri_test --split test --threshold-file ml\results\thresholds.json"

# 4. Benchmark sanity check on VoxCeleb1-O (only if you downloaded it)
$vox = "ml\data_raw\voxceleb1_test\wav"; $list = "ml\data_raw\veri_test2.txt"
if ((Test-Path $vox) -and (Test-Path $list)) {
    Run "python -m ml.data.prepare_voxceleb --wav-root $vox --trial-list $list"
    Run "python -m ml.eval.eval_speaker pairs --trials ml\results\trials\vox1o_pairs.csv --name vox1o --split test --no-threshold"
    Run "python -m ml.eval.plot_speaker --run vox1o --split test"
} else { Write-Host "`nVoxCeleb1 not found - skipping the benchmark step (optional)." -ForegroundColor Yellow }

Write-Host "`nDone. Numbers: ml\results\*\metrics.csv   Graphs: ml\figures\*.png" -ForegroundColor Green
