"""v0.5.2 generic SAE J2012 trouble-code titles (titles only, no causes or prices).

Data: lylo_hack/data/dtc_titles.json, built from Wal33D/dtc-database (MIT, see
data/DTC_TITLES_LICENSE.txt). P0037 / P2241 wording per the 2026-10-31 diag.
Flag LYLO_HACK_DTC_TITLES=1: live.build_session fills a missing DTC description
with the generic title. Unset = previous behaviour exactly (description stays None).
"""
import json
import os
import re

_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "dtc_titles.json")
_TITLES = None
_CODE = re.compile(r"^[PBCU][0-9A-F]{4}$")
MANUFACTURER = re.compile(r"^(P[13]|B[12]|C[12]|U[12])")


def on():
    return os.environ.get("LYLO_HACK_DTC_TITLES") == "1"


def titles():
    global _TITLES
    if _TITLES is None:
        try:
            with open(_PATH, encoding="utf8") as f:
                _TITLES = json.load(f).get("titles", {})
        except (OSError, ValueError):
            _TITLES = {}
    return _TITLES


def lookup(code):
    """-> {"code", "title" or None, "known": bool, "manufacturer_range": bool}. Never raises."""
    c = str(code or "").strip().upper()
    t = titles().get(c) if _CODE.match(c) else None
    return {"code": c, "title": t, "known": t is not None, "manufacturer_range": bool(MANUFACTURER.match(c))}


def describe(code):
    """Plain description for a code, or a clear unknown-code note. Never raises."""
    r = lookup(code)
    if r["title"]:
        return r["title"] + (" (meaning can vary by make)" if r["manufacturer_range"] else "")
    if r["manufacturer_range"]:
        return f"{r['code']}: manufacturer-specific code; meaning depends on the make and model."
    return f"{r['code']}: unknown code, not in the generic list. The rules still check the rest of the scan."
