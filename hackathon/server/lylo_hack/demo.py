"""Judge demo (hackathon v0.4.7). Flag LYLO_HACK_DEMO=1.

replay(case): a bundled scan (demo_scans/<case>.json) through the SAME pipeline as /api/v1/live/live
              (rules, then Muse Detective if LYLO_HACK_MUSE=1, never-lower merge, receipts).
proof():      "AI vs rules". No recorded run exists where Muse proposed a lower level than the rules,
              so this injects a SIMULATED AI answer (SAFE_TO_DRIVE) into the real detective.run /
              merge_safety code on the 260 F overheat scan, and shows which verdict won. No model call.
"""
import copy
import json
import os

from . import detective, live

DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "demo_scans")
CASE_IDS = ("truck", "usedcar", "overheat")
SIMULATED_LABEL = "Simulated AI answer for this test (no AI model was called)"


def enabled():
    return os.environ.get("LYLO_HACK_DEMO", "0") == "1"


def load(case_id):
    if case_id not in CASE_IDS:
        return None
    with open(os.path.join(DIR, case_id + ".json"), encoding="utf-8") as f:
        return json.load(f)


def cases():
    return [{k: c[k] for k in ("id", "title", "source")} for c in (load(i) for i in CASE_IDS)]


def replay(case_id):
    c = load(case_id)
    if not c:
        return None
    out = live.diagnose(copy.deepcopy(c["scan"]))
    out["demo"] = {"case": c["id"], "title": c["title"], "source": c["source"], "replay": True}
    return out


def _simulated_safe(messages, schema, timeout=None):
    """Stands in for Muse. Cites real ledger ids so it passes verification; only the level is wrong."""
    return ({"hypotheses": [{"rank": 1, "cause": "Gauge or sensor glitch", "reasoning": "SIMULATED: argues the reading is a fluke.",
                             "confidence": "low", "cites": ["pid:ENGINE_COOLANT_TEMP"], "next_check": "SIMULATED"}],
             "explanation": {"text": "SIMULATED answer for the AI-vs-rules test.", "cites": ["pid:ENGINE_COOLANT_TEMP"]},
             "cleared_codes_warning": {"text": "", "cites": []},
             "safety_opinion": {"level": "SAFE_TO_DRIVE", "reason": "SIMULATED: the AI says it is fine to drive.",
                                "cites": ["pid:ENGINE_COOLANT_TEMP", "rule:safety"]}},
            {"model": "simulated (no model call)", "latency_ms": 0, "usage": None, "finish_reason": "simulated"})


def proof():
    c = load("overheat")
    data = copy.deepcopy(c["scan"])
    result = live.diagnose(data, muse=False)
    result = detective.run(data, result, call=_simulated_safe, force_call=True)
    det = result["detective"]
    ai = (det.get("safety_opinion") or {}).get("level")
    rules = det.get("rule_safety_level")
    final = det.get("final_safety_level")
    return {"proof": {"label": SIMULATED_LABEL, "simulated": True, "case": c["id"], "title": c["title"],
                      "ai_verdict": ai, "rules_verdict": rules, "final_verdict": final,
                      "winner": "rules" if final == rules and ai != rules else ("ai" if final == ai else "rules"),
                      "safety_action": det.get("safety_action"),
                      "explain": "The AI proposed a lower level. LYLO's merge never lowers the rule level, so the rules won.",
                      "receipt": det.get("receipt")},
            "safety": result.get("safety"), "detective": det}
