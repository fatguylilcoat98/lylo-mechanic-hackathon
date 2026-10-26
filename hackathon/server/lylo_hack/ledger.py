"""Evidence Ledger (hackathon build): typed, id-stable facts from one scan.

Every item has a stable id derived from its content (not its position), so
the same scan always gives the same ids. Only these ids may be cited by the
Muse Detective. Privacy: the VIN is masked to its 3-character manufacturer
prefix; adapter name, owner info and location are never put in the ledger.
"""
import re

SAFETY_ORDER = ["SAFE_TO_DRIVE", "INSPECT_SOON", "DRIVE_SHORT_DISTANCE_ONLY",
                "DO_NOT_DRIVE", "TOW_RECOMMENDED", "EMERGENCY_STOP_IMMEDIATELY"]
CLEARED_PIDS = ("DIST_SINCE_CODES_CLEARED", "WARMUPS_SINCE_CLEAR", "TIME_SINCE_CODES_CLEARED")


def mask_vin(vin):
    if not isinstance(vin, str) or not vin:
        return None
    return vin[:3] + "*" * (len(vin) - 3)


def _slug(s):
    return re.sub(r"[^a-z0-9]+", "_", str(s).lower()).strip("_")[:40] or "x"


def build_ledger(data, result):
    items = []
    seen = set()

    def add(item):
        if item["id"] in seen:
            return
        seen.add(item["id"])
        items.append(item)

    for d in data.get("raw_dtcs", []):
        code, status = d["code"].upper(), d.get("status", "active")
        add({"id": f"dtc:{code}:{status}", "type": "dtc", "code": code, "status": status})
    for p in data.get("raw_pids", []):
        if p.get("raw_value") is None:
            continue
        typ = "codes_cleared_counter" if p["name"] in CLEARED_PIDS else "pid"
        add({"id": f"pid:{p['name']}", "type": typ, "name": p["name"], "value": p["raw_value"], "unit": p.get("unit", "")})
    for m in data.get("readiness_monitors", []):
        add({"id": f"mon:{_slug(m['name'])}", "type": "readiness_monitor", "name": m["name"], "status": m.get("status", "incomplete")})
    if data.get("codes_cleared_before_scan"):
        add({"id": "clr:flag", "type": "codes_cleared", "value": True})
    for i, text in enumerate(data.get("codes_cleared_evidence", []) or []):
        add({"id": f"clr:e{i + 1}", "type": "codes_cleared_evidence", "text": text[:300]})
    ff = data.get("freeze_frame") or {}
    if ff:
        if ff.get("dtc"):
            add({"id": "ff:dtc", "type": "freeze_frame", "name": "trigger_dtc", "value": ff["dtc"].upper()})
        for k, v in (ff.get("values") or {}).items():
            if v is not None:
                add({"id": f"ff:{k}", "type": "freeze_frame", "name": k, "value": v})
    vp = data.get("vehicle_profile") or {}
    for k in ("year", "make", "model", "engine", "transmission", "drive_type", "odometer"):
        if vp.get(k) is not None:
            add({"id": f"veh:{k}", "type": "vehicle", "name": k, "value": vp[k]})
    if vp.get("vin"):
        add({"id": "veh:vin_masked", "type": "vehicle", "name": "vin_masked", "value": mask_vin(vp["vin"])})

    safety = (result or {}).get("safety") or {}
    if safety.get("level"):
        add({"id": "rule:safety", "type": "rule_safety", "level": safety["level"],
             "triggers": [str(t)[:200] for t in safety.get("triggering_conditions", [])][:6]})
    for h in ((result or {}).get("hypotheses") or [])[:5]:
        if h.get("cause_id"):
            add({"id": f"rule:hyp:{_slug(h['cause_id'])}", "type": "rule_hypothesis",
                 "cause": h.get("cause_name"), "rank": h.get("cause_rank"), "confidence": h.get("confidence_score")})
    return items


def ledger_ids(items):
    return {i["id"] for i in items}


def recently_cleared(items):
    return any(i["type"] in ("codes_cleared", "codes_cleared_evidence") for i in items)
