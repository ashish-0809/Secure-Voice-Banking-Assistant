# Starts the ECAPA speaker service using the project's venv Python, with logs preserved.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File ml\start_speaker_service.ps1
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$Py = Join-Path $Root "ml\.venv\Scripts\python.exe"
$LogDir = Join-Path $Root "logs"
$Out = Join-Path $LogDir "speaker_service.out.log"
$Err = Join-Path $LogDir "speaker_service.err.log"
$Url = "http://127.0.0.1:5005"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Get-Health {
    try { return Invoke-RestMethod "$Url/health" -TimeoutSec 2 } catch { return $null }
}

if (-not (Test-Path $Py)) { Write-Host "ERROR: $Py not found. Run ml\setup_windows.ps1" -ForegroundColor Red; exit 2 }

# Do not start a duplicate service: reuse a healthy one, fail clearly on a foreign port owner.
$h = Get-Health
$PidFile = Join-Path $LogDir "speaker_service.pid"
if ($h) {
    Remove-Item $PidFile -ErrorAction SilentlyContinue   # not started by us -> never stopped by us
    Write-Host "Speaker service already running on port 5005."
} else {
    $busy = Get-NetTCPConnection -LocalPort 5005 -State Listen -ErrorAction SilentlyContinue
    if ($busy) { Write-Host "ERROR: port 5005 is in use by PID $($busy[0].OwningProcess), which is not the speaker service." -ForegroundColor Red; exit 3 }
    $env:PYTHONUNBUFFERED = "1"
    # Argument list is an array: python.exe is the FILE to run, "-m speaker_service.app" are its arguments.
    $proc = Start-Process -FilePath $Py -ArgumentList @("-u", "-m", "speaker_service.app") `
        -WorkingDirectory $Root -WindowStyle Minimized -PassThru `
        -RedirectStandardOutput $Out -RedirectStandardError $Err
    Set-Content -Path $PidFile -Value $proc.Id
    Write-Host "Started speaker service (PID $($proc.Id)). Logs: $LogDir"

    $up = $false
    for ($i = 0; $i -lt 60; $i++) {
        if ($proc.HasExited) {
            Write-Host "ERROR: speaker service exited with code $($proc.ExitCode). Last log lines:" -ForegroundColor Red
            if (Test-Path $Err) { Get-Content $Err -Tail 25 }
            exit 4
        }
        if (Get-Health) { $up = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $up) {
        Write-Host "ERROR: service did not open port 5005 within 60s. Last log lines:" -ForegroundColor Red
        if (Test-Path $Err) { Get-Content $Err -Tail 25 }
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        exit 5
    }
}

Write-Host "Loading ECAPA model (first run may download it; up to 5 minutes)..."
try {
    $r = Invoke-RestMethod -Method Post "$Url/warmup" -TimeoutSec 300
} catch {
    Write-Host "ERROR: model warmup failed: $($_.Exception.Message)" -ForegroundColor Red
    if (Test-Path $Err) { Get-Content $Err -Tail 30 }
    exit 6
}
$h = Get-Health
if (-not ($r.ok -and $h -and $h.ok -and $h.model_loaded)) {
    Write-Host "ERROR: service reports model not ready." -ForegroundColor Red
    if (Test-Path $Err) { Get-Content $Err -Tail 30 }
    exit 7
}
Write-Host "ECAPA speaker service ready (device: $($r.device))."
exit 0
