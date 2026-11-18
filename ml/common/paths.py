"""Central place for folder locations, so no script hard-codes a path."""
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]      # .../voice-banking-assistant/ml
ROOT = ML_DIR.parent                              # project root (where server.js lives)
DATA_RAW = ML_DIR / "data_raw"                    # downloaded datasets (never committed)
MODELS = ML_DIR / "models"                        # downloaded / trained model files (never committed)
RESULTS = ML_DIR / "results"                      # CSV + JSON outputs of every experiment
FIGURES = ML_DIR / "figures"                      # PNG graphs
THRESHOLDS_FILE = RESULTS / "thresholds.json"     # calibrated decision thresholds (written by calibrate_threshold.py)


def ensure_dirs():
    for d in (DATA_RAW, MODELS, RESULTS, FIGURES, RESULTS / "trials", RESULTS / "cache"):
        d.mkdir(parents=True, exist_ok=True)
