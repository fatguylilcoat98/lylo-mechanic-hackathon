"""Hackathon live-diagnosis adapter around the baseline pipeline."""
import os

from . import baseline_path

baseline_path.ensure()
import api.orchestrator as orchestrator  # noqa: E402  (baseline, read-only)
from models.schemas import (  # noqa: E402
    OBDSessionInput, VehicleProfile, RawDTC, RawPIDValue, ReadinessMonitor, SymptomIntake,
)

PERMANENT_NOTE = ("PERMANENT (Mode 0A): the engine computer still holds this fault and has not "
                  "verified a repair. Treated as active so the safety check sees it.")


def external_handshake_disabled():
    return os.environ.get("LYLO_HACK_DISABLE_EXTERNAL_HANDSHAKE", "1") != "0"


def _stub_classify(question, session_id=""):
    # Local stand-in for the onrender Handshake call. It never fails open:
    # the baseline local rules already decided acknowledgment is required.
    return {
        "mode": "SOFT_WARNING",
        "message": "External handshake service is disabled in the hackathon build; "
                   "the local safety acknowledgment still applies.",
        "requires_acknowledgment": True,
        "risk_score": 0,
        "stubbed": True,
    }


def install_handshake_stub():
    """Swap the names the orchestrator imported, without editing baseline files."""
    if external_handshake_disabled():
        orchestrator.classify_with_claspion = _stub_classify
        orchestrator.handshake_classify = _stub_classify
        return True
    return False


def install_shared_list_fix():
    """Baseline bug (found Oct 26): _build_hypothesis hands the rule table's own
    `what_could_be_wrong` list to each hypothesis, and _apply_confidence_cap then
    appends to it, so the shared rule data grows on every request and later
    replies repeat the "Confidence capped" line. Copy the list per hypothesis.
    Flag LYLO_HACK_FIX_SHARED_LIST (default on; "0" disables). Baseline unedited."""
    if os.environ.get("LYLO_HACK_FIX_SHARED_LIST", "1") == "0":
        return False
    import diagnosis.hypothesis_engine as he  # baseline, read-only
    if getattr(he._build_hypothesis, "_lylo_hack_fixed", False):
        return True
    orig = he._build_hypothesis

    def fixed(*a, **k):
        h = orig(*a, **k)
        if h is not None:
            h.what_could_make_this_wrong = list(h.what_could_make_this_wrong or [])
        return h
    fixed._lylo_hack_fixed = True
    he._build_hypothesis = fixed
    return True


def build_session(data):
    """Validated payload -> (OBDSessionInput, SymptomIntake|None, notes)."""
    notes = []
    seen = {}
    for d in data.get("raw_dtcs", []):
        code = d["code"].upper()
        status = d.get("status", "active")
        desc = d.get("description")
        if status == "permanent":
            status = "active"
            desc = f"{PERMANENT_NOTE} {desc}" if desc else PERMANENT_NOTE
            notes.append(f"{code}: permanent code treated as active.")
        rank = {"active": 3, "pending": 2, "history": 1}[status]
        if code not in seen or rank > seen[code][0]:
            seen[code] = (rank, RawDTC(code=code, status=status, description=desc))
    raw_dtcs = [v[1] for v in seen.values()]

    raw_pids = [RawPIDValue(name=p["name"], pid_code=p.get("pid_code", ""),
                            raw_value=float(p["raw_value"]) if p.get("raw_value") is not None else None,
                            unit=p.get("unit", ""))
                for p in data.get("raw_pids", [])]

    vp = data.get("vehicle_profile") or {}
    vehicle = VehicleProfile(
        vin=vp.get("vin"), year=vp.get("year"), make=vp.get("make"), model=vp.get("model"),
        trim=vp.get("trim"), engine=vp.get("engine"), engine_type=vp.get("engine_type"),
        transmission=vp.get("transmission"), drive_type=vp.get("drive_type"),
        odometer=vp.get("odometer"), is_hybrid=vp.get("is_hybrid", False), is_ev=vp.get("is_ev", False),
    )
    session = OBDSessionInput(
        adapter_id=data.get("adapter_id", "unknown"),
        protocol=data.get("protocol", "unknown"),
        connection_quality=data.get("connection_quality", "stable"),
        read_complete=data.get("read_complete", True),
        vehicle_profile=vehicle,
        raw_dtcs=raw_dtcs,
        raw_pids=raw_pids,
        readiness_monitors=[ReadinessMonitor(name=m["name"], status=m.get("status", "incomplete"))
                            for m in data.get("readiness_monitors", [])],
        codes_cleared_before_scan=data.get("codes_cleared_before_scan", False),
    )
    symptoms = None
    if data.get("symptoms"):
        s = data["symptoms"]
        symptoms = SymptomIntake(primary_category=s.get("primary_category", "warning_light_only"),
                                 severity=s.get("severity", "noticeable"),
                                 frequency=s.get("frequency", "occasional"))
    return session, symptoms, notes


def diagnose(data, muse=True, extra_items=None):
    session, symptoms, notes = build_session(data)
    result = orchestrator.run_diagnosis(session, symptoms).to_dict()
    result["hackathon"] = {
        "build": "lylo-mechanic-hackathon",
        "external_handshake": "stubbed" if external_handshake_disabled() else "live",
        "conversion_notes": notes,
        "codes_cleared_evidence": data.get("codes_cleared_evidence", []),
        "vehicle_received": {k: getattr(session.vehicle_profile, k) for k in ("vin", "model", "odometer")},
    }
    from . import detective
    out = detective.run(data, result, extra_items=extra_items) if muse else _det_off(data, result, extra_items)
    from . import prove
    if muse and prove.enabled():  # LYLO_HACK_PROVE=1: lock a testable prediction (off = unchanged)
        det = out.get("detective") or {}
        prove.lock(out, data, proposal=det.pop("prediction_proposal", None))
    return out


def _det_off(data, result, extra_items):
    """Deterministic ledger only (no Muse call), used by vision/voice to rebuild the scan."""
    from . import ledger as L
    items = L.build_ledger(data, result) + list(extra_items or [])
    from . import engine_user as E
    E.apply_to_items(items, data, result)  # no-op unless LYLO_HACK_ENGINE_OVERRIDE=1
    level = (result.get("safety") or {}).get("level")
    result["detective"] = {"muse_status": "skipped (deterministic rebuild)", "ledger": items,
                           "rule_safety_level": level, "final_safety_level": level,
                           "safety_action": "kept_rule_level", "recently_cleared": L.recently_cleared(items)}
    return result
