# STAGE 1 - one-time setup on Windows (PowerShell).  Run from the PROJECT ROOT:
#     Set-ExecutionPolicy -Scope Process Bypass
#     .\ml\setup_windows.ps1
# Optional: choose another CUDA wheel index, e.g.  .\ml\setup_windows.ps1 -TorchIndex cu128   (or cpu)
param([string]$TorchIndex = "cu126")

$ErrorActionPreference = "Stop"

# Prefer Python 3.11/3.12 through the 'py' launcher; fall back to whatever 'python' is.
$py = $null
foreach ($v in @("3.11", "3.12", "3.10")) {
    try { & py -$v --version *> $null; if ($LASTEXITCODE -eq 0) { $py = "py -$v"; break } } catch {}
}
if (-not $py) { $py = "python" }
Write-Host "Using: $py"

Invoke-Expression "$py -m venv ml\.venv"
& .\ml\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip

# 1) PyTorch. RTX 3050 (Ampere) works with the cu126 build. The default PyPI torch on Windows is CPU-only.
python -m pip install torch==2.9.1 torchaudio==2.9.1 --index-url "https://download.pytorch.org/whl/$TorchIndex"

# 2) Everything else
python -m pip install -r ml\requirements.txt

# 3) Check
python ml\check_env.py
Write-Host "`nNext time, activate the environment with:  .\ml\.venv\Scripts\Activate.ps1"
