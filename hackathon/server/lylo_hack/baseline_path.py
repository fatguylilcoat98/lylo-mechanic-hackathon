"""Put baseline/backend on sys.path so its modules import unchanged."""
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
BASELINE_BACKEND = os.path.join(REPO_ROOT, "baseline", "backend")


def ensure():
    if BASELINE_BACKEND not in sys.path:
        sys.path.insert(0, BASELINE_BACKEND)
    return BASELINE_BACKEND
