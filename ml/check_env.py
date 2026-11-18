"""
STAGE 1 - Environment check.  Run:   python ml/check_env.py            (quick)
                                      python ml/check_env.py --load-model   (also downloads + runs the ECAPA model)
Prints [PASS] / [WARN] / [FAIL] for everything the ML part needs, with a fix for each problem.
"""
import argparse
import importlib
import platform
import shutil
import socket
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))   # allow `python ml/check_env.py`
from ml.common.paths import ROOT  # noqa: E402

results = []


def report(level, msg, fix=""):
    results.append(level)
    print(f"[{level}] {msg}" + (f"\n       -> {fix}" if fix and level != "PASS" else ""))


def check_python():
    v = sys.version_info
    msg = f"Python {v.major}.{v.minor}.{v.micro} ({platform.system()} {platform.machine()})"
    if (3, 10) <= (v.major, v.minor) <= (3, 12):
        report("PASS", msg)
    elif v >= (3, 10):
        report("WARN", msg + " - newer than the versions this stack is usually tested on", "If installs fail, use Python 3.11 or 3.12.")
    else:
        report("FAIL", msg, "Install Python 3.11 from python.org (tick 'Add to PATH').")


def check_package(name, pip_name=None, required=True):
    try:
        m = importlib.import_module(name)
        try:
            from importlib.metadata import version
            ver = version(name.replace("_", "-"))
        except Exception:
            ver = getattr(m, "__version__", "")
        report("PASS", f"{name} {ver}".strip())
        return m
    except Exception as e:  # ImportError, or a broken binary install
        report("FAIL" if required else "WARN", f"{name} not usable ({type(e).__name__}: {str(e)[:80]})",
               f"pip install {pip_name or name}   (see ml/setup_windows.ps1)")
        return None


def check_gpu(torch):
    if torch is None:
        return
    if not torch.cuda.is_available():
        report("WARN", "PyTorch cannot see a CUDA GPU - everything will run on the CPU (slower but works)",
               "Install the CUDA build of PyTorch: pip install torch==2.9.1 torchaudio==2.9.1 --index-url https://download.pytorch.org/whl/cu126")
        return
    p = torch.cuda.get_device_properties(0)
    report("PASS", f"GPU: {p.name}, {p.total_memory / 1e9:.1f} GB VRAM, compute capability {p.major}.{p.minor}")
    try:
        x = torch.randn(1024, 1024, device="cuda")
        (x @ x).sum().item()
        report("PASS", "GPU matrix multiplication works")
    except Exception as e:
        report("FAIL", f"GPU test failed: {e}", "Update the NVIDIA driver, then reinstall the CUDA build of PyTorch.")


def check_disk():
    free = shutil.disk_usage(ROOT).free / 1e9
    if free >= 60:
        report("PASS", f"{free:.0f} GB free disk space")
    elif free >= 15:
        report("WARN", f"{free:.0f} GB free - enough for stages 1-3, but anti-spoofing data (ASVspoof PA ~16 GB, plus unzipping) needs ~45 GB", "Free some space before stage 4.")
    else:
        report("FAIL", f"only {free:.0f} GB free", "Free at least 15 GB.")


def check_network():
    for host, why in [("huggingface.co", "model download"), ("www.openslr.org", "LibriSpeech"), ("www.robots.ox.ac.uk", "VoxCeleb"),
                      ("datashare.ed.ac.uk", "ASVspoof (stage 4)")]:
        try:
            socket.create_connection((host, 443), timeout=6).close()
            report("PASS", f"can reach {host} ({why})")
        except OSError:
            report("WARN", f"cannot reach {host} ({why})", "Check internet / firewall / proxy / VPN.")


def load_model_test():
    print("\nLoading the ECAPA-TDNN model (first run downloads ~80 MB)...")
    import numpy as np
    from ml.service.speaker import EMBEDDING_DIM, SpeakerVerifier
    try:
        t0 = time.time()
        v = SpeakerVerifier()
        report("PASS", f"model loaded on {v.device} in {time.time() - t0:.1f}s")
        t = np.arange(48000) / 16000
        wave = (0.2 * sum(np.sin(2 * np.pi * f * t) / (i + 1) for i, f in enumerate([120, 240, 360, 480]))).astype(np.float32)
        t0 = time.time()
        e = v.embed_waveform(wave)
        ok = e.shape == (EMBEDDING_DIM,) and abs(np.linalg.norm(e) - 1) < 1e-6
        report("PASS" if ok else "FAIL", f"embedding shape {e.shape}, norm {np.linalg.norm(e):.4f}, {1000 * (time.time() - t0):.0f} ms for 3 s of audio",
               "Expected a unit-length vector of 192 numbers.")
    except Exception as e:
        report("FAIL", f"could not load/run the model: {type(e).__name__}: {str(e)[:200]}",
               "If the message mentions WinError 1314 / symlink, run the terminal as Administrator once, or enable Windows Developer Mode.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--load-model", action="store_true")
    args = ap.parse_args()
    print("=== ML environment check ===")
    check_python()
    for n, pip in [("numpy", None), ("scipy", None), ("matplotlib", None), ("soundfile", None), ("huggingface_hub", None), ("flask", None)]:
        check_package(n, pip)
    torch = check_package("torch", "torch (CUDA build, see setup_windows.ps1)")
    check_package("torchaudio", "torchaudio==2.9.1", required=True)      # SpeechBrain imports it
    check_package("speechbrain", "speechbrain")
    check_gpu(torch)
    check_disk()
    check_network()
    if shutil.which("ffmpeg"):
        report("PASS", "ffmpeg found (optional)")
    else:
        report("WARN", "ffmpeg not found (optional; only needed to convert odd audio formats)", "winget install Gyan.FFmpeg")
    if args.load_model and "FAIL" not in results:
        load_model_test()
    elif args.load_model:
        print("\nSkipping model test because of the FAIL items above - fix those first.")
    print(f"\nSummary: {results.count('PASS')} passed, {results.count('WARN')} warnings, {results.count('FAIL')} failed")
    sys.exit(1 if "FAIL" in results else 0)


if __name__ == "__main__":
    main()
