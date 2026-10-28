"""Strict validation for POST /api/v1/live/live (hackathon build).

The baseline route accepted anything and turned bad input into HTTP 500.
Here every problem is collected and returned as a 400 with a list of
plain-language errors. Unknown PID names are rejected on purpose: the
baseline safety classifier looks PIDs up by exact name, so a misspelled
name (e.g. "coolant_temp") silently hides an overheating engine.
"""
import os

from . import baseline_path

baseline_path.ensure()
from normalization.normalizer import PID_RANGES  # noqa: E402  (baseline, read-only)

# PIDs the mobile app reads that have no baseline range entry. They pass
# through un-ranged (the baseline ignores them for safety) and are allowed.
PASSTHROUGH_PIDS = {
    "RUN_TIME_SINCE_START", "FUEL_LEVEL", "DIST_MIL_ON", "TIME_MIL_ON",
    "TIME_SINCE_CODES_CLEARED", "WARMUPS_SINCE_CLEAR", "DIST_SINCE_CODES_CLEARED",
}
KNOWN_PID_NAMES = set(PID_RANGES) | PASSTHROUGH_PIDS

DTC_STATUSES = {"active", "pending", "history", "permanent"}
MONITOR_STATUSES = {"complete", "incomplete", "not_applicable"}
CONNECTION_QUALITIES = {"stable", "unstable", "dropped"}
SYMPTOM_CATEGORIES = None  # baseline accepts free text; not narrowed today
MAX_LIST = 200

VEHICLE_STR_FIELDS = ("vin", "make", "model", "trim", "engine", "engine_type",
                      "transmission", "drive_type")


def _is_dtc(code):
    return isinstance(code, str) and len(code) == 5 and code[0].upper() in "PCBU" and all(c in "0123456789ABCDEFabcdef" for c in code[1:])


def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def validate_live_payload(data):
    """Return a list of error strings; empty means valid."""
    errs = []
    if not isinstance(data, dict):
        return ["Body must be a JSON object."]

    for key in ("adapter_id", "protocol"):
        if key in data and not isinstance(data[key], str):
            errs.append(f"{key} must be a string.")
    cq = data.get("connection_quality", "stable")
    if cq not in CONNECTION_QUALITIES:
        errs.append(f"connection_quality must be one of {sorted(CONNECTION_QUALITIES)}.")
    for key in ("read_complete", "codes_cleared_before_scan"):
        if key in data and not isinstance(data[key], bool):
            errs.append(f"{key} must be true or false.")

    vp = data.get("vehicle_profile", {})
    if not isinstance(vp, dict):
        errs.append("vehicle_profile must be an object.")
    else:
        for f in VEHICLE_STR_FIELDS:
            if vp.get(f) is not None and not isinstance(vp[f], str):
                errs.append(f"vehicle_profile.{f} must be a string.")
        vin = vp.get("vin")
        if isinstance(vin, str) and len(vin) != 17:
            errs.append("vehicle_profile.vin must be 17 characters.")
        yr = vp.get("year")
        if yr is not None and (not isinstance(yr, int) or isinstance(yr, bool) or not 1980 <= yr <= 2100):
            errs.append("vehicle_profile.year must be an integer between 1980 and 2100.")
        odo = vp.get("odometer")
        if odo is not None and (not isinstance(odo, int) or isinstance(odo, bool) or not 0 <= odo <= 2_000_000):
            errs.append("vehicle_profile.odometer must be a whole number of miles (0 to 2,000,000).")
        for f in ("is_hybrid", "is_ev"):
            if f in vp and not isinstance(vp[f], bool):
                errs.append(f"vehicle_profile.{f} must be true or false.")
        from . import engine_user  # v0.4.8; adds nothing unless LYLO_HACK_ENGINE_OVERRIDE=1
        errs += engine_user.validation_errors(vp)

    for list_key in ("raw_dtcs", "raw_pids", "readiness_monitors"):
        v = data.get(list_key, [])
        if not isinstance(v, list):
            errs.append(f"{list_key} must be a list.")
        elif len(v) > MAX_LIST:
            errs.append(f"{list_key} has more than {MAX_LIST} entries.")

    for i, d in enumerate(data.get("raw_dtcs", []) if isinstance(data.get("raw_dtcs", []), list) else []):
        if not isinstance(d, dict):
            errs.append(f"raw_dtcs[{i}] must be an object."); continue
        code = d.get("code")
        if not isinstance(code, str) or not (len(code) == 5 and code[0].upper() in "PCBU" and all(c in "0123456789ABCDEFabcdef" for c in code[1:])):
            errs.append(f"raw_dtcs[{i}].code must look like P0301.")
        if d.get("status", "active") not in DTC_STATUSES:
            errs.append(f"raw_dtcs[{i}].status must be one of {sorted(DTC_STATUSES)}.")

    for i, p in enumerate(data.get("raw_pids", []) if isinstance(data.get("raw_pids", []), list) else []):
        if not isinstance(p, dict):
            errs.append(f"raw_pids[{i}] must be an object."); continue
        name = p.get("name")
        if not isinstance(name, str) or name not in KNOWN_PID_NAMES:
            errs.append(f"raw_pids[{i}].name {name!r} is not a known PID name; the safety check would not see it. "
                        f"Use one of {sorted(KNOWN_PID_NAMES)}.")
        rv = p.get("raw_value")
        if rv is not None and not _is_num(rv):
            errs.append(f"raw_pids[{i}].raw_value must be a number or null.")
        if not isinstance(p.get("unit", ""), str):
            errs.append(f"raw_pids[{i}].unit must be a string.")
        rng = PID_RANGES.get(name) if isinstance(name, str) else None
        if rng and isinstance(p.get("unit"), str) and p["unit"] and p["unit"] != rng[0]:
            errs.append(f"raw_pids[{i}].unit {p['unit']!r} is wrong for {name}; send {rng[0]!r}.")

    for i, m in enumerate(data.get("readiness_monitors", []) if isinstance(data.get("readiness_monitors", []), list) else []):
        if not isinstance(m, dict) or not isinstance(m.get("name"), str):
            errs.append(f"readiness_monitors[{i}] must be an object with a name."); continue
        if m.get("status", "incomplete") not in MONITOR_STATUSES:
            errs.append(f"readiness_monitors[{i}].status must be one of {sorted(MONITOR_STATUSES)}.")

    sym = data.get("symptoms")
    if sym is not None:
        if not isinstance(sym, dict):
            errs.append("symptoms must be an object.")
        else:
            for f in ("primary_category", "severity", "frequency"):
                if f in sym and not isinstance(sym[f], str):
                    errs.append(f"symptoms.{f} must be a string.")

    ff = data.get("freeze_frame")
    if ff is not None:
        if not isinstance(ff, dict):
            errs.append("freeze_frame must be an object.")
        else:
            if ff.get("dtc") is not None and not _is_dtc(ff["dtc"]):
                errs.append("freeze_frame.dtc must look like P0301.")
            for k, v in (ff.get("values") or {}).items() if isinstance(ff.get("values", {}), dict) else []:
                if k not in KNOWN_PID_NAMES or not (_is_num(v) or v is None):
                    errs.append(f"freeze_frame.values.{k} must be a known PID name with a number.")
            if "values" in ff and not isinstance(ff["values"], dict):
                errs.append("freeze_frame.values must be an object.")

    ev = data.get("codes_cleared_evidence")
    if ev is not None and not (isinstance(ev, list) and all(isinstance(x, str) for x in ev)):
        errs.append("codes_cleared_evidence must be a list of strings.")

    # Empty-scan gate (flag LYLO_HACK_REQUIRE_DATA, default on; "0" disables).
    # A scan with no codes and no readings would otherwise come back as a
    # confident-looking result built from nothing.
    if not errs and os.environ.get("LYLO_HACK_REQUIRE_DATA", "1") != "0":
        dtcs = data.get("raw_dtcs") or []
        pids = data.get("raw_pids") or []
        has_reading = any(isinstance(p, dict) and _is_num(p.get("raw_value")) for p in pids)
        if not dtcs and not has_reading:
            errs.append("Scan has no trouble codes and no sensor readings, so there is nothing to diagnose. "
                        "Check the adapter connection and run the scan again.")
    return errs
