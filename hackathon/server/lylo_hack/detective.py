"""Muse Detective (hackathon build) over the Evidence Ledger.

Muse proposes ranked hypotheses and a plain-English explanation. Every claim
must cite ledger ids; claims citing ids that don't exist are moved to
`unverified_claims`. Safety stays rule-based: Muse may agree with or raise
the rule level (only with verified citations), never lower it. Any Muse
failure returns the deterministic result untouched with muse_status set.
Flag: LYLO_HACK_MUSE (default 0 = off).
"""
import hashlib
import json
import os

from . import ledger as L
from . import muse, wiring
from . import vin as V

CLAIM = {"type": "object", "additionalProperties": False,
         "required": ["text", "cites"],
         "properties": {"text": {"type": "string"}, "cites": {"type": "array", "items": {"type": "string"}}}}
SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["hypotheses", "explanation", "cleared_codes_warning", "safety_opinion"],
    "properties": {
        "hypotheses": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["rank", "cause", "reasoning", "confidence", "cites", "next_check"],
            "properties": {"rank": {"type": "integer"}, "cause": {"type": "string"}, "reasoning": {"type": "string"},
                           "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
                           "cites": {"type": "array", "items": {"type": "string"}},
                           "next_check": {"type": "string"}}}},
        "explanation": CLAIM,
        "cleared_codes_warning": CLAIM,
        "safety_opinion": {"type": "object", "additionalProperties": False,
                           "required": ["level", "reason", "cites"],
                           "properties": {"level": {"type": "string", "enum": L.SAFETY_ORDER},
                                          "reason": {"type": "string"},
                                          "cites": {"type": "array", "items": {"type": "string"}}}},
    },
}

INSTRUCTIONS = """You are the LYLO Mechanic "Detective". You explain a car's OBD-II scan to a non-mechanic, often a used-car buyer.
You get an EVIDENCE LEDGER: a JSON list of facts, each with an "id". Rules:
1. Use ONLY facts in the ledger. Every claim must list the ledger ids it relies on in "cites". Never cite an id that is not in the ledger. If evidence is missing, say so instead of guessing.
2. Give up to 4 hypotheses ranked most-likely first, each with a cheap next check a buyer or mechanic can do.
3. "explanation": 2-4 plain-English sentences, no jargon without a short definition.
4. If the ledger has codes_cleared or codes_cleared_evidence items, "cleared_codes_warning" must explain plainly why recently cleared codes are a red flag for a used-car buyer (problems can be hidden until readiness monitors finish and codes return), citing the cleared-counter and evidence ids. Otherwise set its text to "" and cites to [].
5. "safety_opinion": the rule engine's level is in item rule:safety. You may agree or argue for a HIGHER level from this order: SAFE_TO_DRIVE < INSPECT_SOON < DRIVE_SHORT_DISTANCE_ONLY < DO_NOT_DRIVE < TOW_RECOMMENDED < EMERGENCY_STOP_IMMEDIATELY. A lower level will be ignored.
6. Items with "source": "photo" come from a camera photo read by a vision model. They are LESS reliable than sensor data: say "the photo suggests", and never let a photo item override a sensor reading that contradicts it.
7. If the ledger has rule:wiring_first, those are sensor/circuit codes: for them, the first next check must be the connector and wiring (corrosion, loose plug, chafed wire) before replacing the sensor; say plainly "often it's the wire or plug, not the sensor" and cite rule:wiring_first.
8. An item with "source": "vin_decode" is the factory build decoded from the VIN by NHTSA. It assumes the factory engine (engines can be swapped): when you use it, say "for a <year> <make> <model> with the factory engine" and cite vin:decoded. If a sensor fact contradicts it, trust the sensor and say so.
9. Do not claim certainty; this is a scan, not an inspection. Output only the JSON object."""


def enabled():
    return os.environ.get("LYLO_HACK_MUSE", "0") == "1"


def _check(cites, ids):
    cites = [c for c in (cites or []) if isinstance(c, str)]
    bad = [c for c in cites if c not in ids]
    return bool(cites) and not bad, bad


def verify(out, ids):
    """Split Muse output into verified and unverified claims. Pure function."""
    verified, unverified = {"hypotheses": []}, []
    hyps = out.get("hypotheses")
    for h in hyps if isinstance(hyps, list) else []:
        if not isinstance(h, dict):
            unverified.append({"kind": "hypothesis", "claim": str(h)[:200], "missing_ids": [], "status": "unverified"})
            continue
        ok, bad = _check(h.get("cites"), ids)
        if ok:
            verified["hypotheses"].append(h)
        else:
            unverified.append({"kind": "hypothesis", "claim": h, "missing_ids": bad, "status": "unverified"})
    verified["hypotheses"].sort(key=lambda h: h.get("rank") if isinstance(h.get("rank"), int) else 99)
    for key in ("explanation", "cleared_codes_warning"):
        c = out.get(key)
        if not isinstance(c, dict) or not str(c.get("text", "")).strip():
            verified[key] = None
            continue
        ok, bad = _check(c.get("cites"), ids)
        if ok:
            verified[key] = c
        else:
            verified[key] = None
            unverified.append({"kind": key, "claim": c, "missing_ids": bad, "status": "unverified"})
    so = out.get("safety_opinion")
    so = so if isinstance(so, dict) else {}
    ok, bad = _check(so.get("cites"), ids)
    verified["safety_opinion"] = so if ok and so.get("level") in L.SAFETY_ORDER else None
    if so and not verified["safety_opinion"]:
        unverified.append({"kind": "safety_opinion", "claim": so, "missing_ids": bad, "status": "unverified"})
    return verified, unverified


def merge_safety(rule_level, opinion):
    """Never lower. Returns (final_level, action)."""
    if rule_level not in L.SAFETY_ORDER:
        return rule_level, "kept_rule_level"
    if not opinion:
        return rule_level, "kept_rule_level"
    m = opinion.get("level")
    ri, mi = L.SAFETY_ORDER.index(rule_level), L.SAFETY_ORDER.index(m)
    if mi > ri:
        return m, "raised_by_detective"
    if mi < ri:
        return rule_level, "detective_lower_ignored"
    return rule_level, "agreed"


COLD_ENGINE_F = 150.0


def cold_engine_no_codes(items):
    """(True, temp_F) when coolant is known, under ~150 F, and the ledger has no DTCs. Else (False, temp_F|None)."""
    if any(i.get("type") == "dtc" for i in items):
        return False, None
    for i in items:
        if i.get("name") == "ENGINE_COOLANT_TEMP":
            try:
                v = float(i.get("value"))
            except (TypeError, ValueError):
                return False, None
            f = v if "F" in str(i.get("unit", "")).upper() else v * 9 / 5 + 32
            return f < COLD_ENGINE_F, round(f)
    return False, None


def cap_for_cold_engine(rule_level, final, action, items):
    """Cold engine + no codes: the AI may raise to INSPECT_SOON at most. Never below the rule level."""
    cold, temp_f = cold_engine_no_codes(items)
    if not cold:
        return final, action, None
    note = (f"Engine was cold ({temp_f} \u00b0F) and there are no trouble codes. Fuel trims and idle readings "
            "are unreliable before warm-up; recheck when the engine is warm.")
    cap = "INSPECT_SOON"
    if action == "raised_by_detective" and L.SAFETY_ORDER.index(final) > L.SAFETY_ORDER.index(cap):
        capped = cap if L.SAFETY_ORDER.index(cap) > L.SAFETY_ORDER.index(rule_level) else rule_level
        return capped, ("raised_by_detective" if capped != rule_level else "kept_rule_level"), note
    return final, action, note


def _cited(verified):
    ids = set()
    for h in verified["hypotheses"]:
        ids.update(h.get("cites", []))
    for k in ("explanation", "cleared_codes_warning", "safety_opinion"):
        if verified.get(k):
            ids.update(verified[k].get("cites", []))
    return sorted(ids)


def run(data, result, call=None, extra_items=None, force_call=False):
    """Adds result['detective'] and may raise result['safety']['level'].
    extra_items: already-typed ledger items from other sources (e.g. photo)."""
    items = L.build_ledger(data, result) + [i for i in (extra_items or []) if isinstance(i, dict) and i.get("id")]
    items += V.ledger_items(data)
    _w = wiring.hint_item(items)
    if _w:
        items.append(_w)
    ids = L.ledger_ids(items)
    rule_level = (result.get("safety") or {}).get("level")
    det = {"muse_status": "off", "ledger": items, "rule_safety_level": rule_level,
           "final_safety_level": rule_level, "safety_action": "kept_rule_level",
           "recently_cleared": L.recently_cleared(items)}
    result["detective"] = det
    if not enabled() and not force_call:  # force_call: demo proof with an injected, labeled simulated answer
        det["muse_status"] = "off (LYLO_HACK_MUSE is not 1)"
        return result
    ledger_json = json.dumps(items, sort_keys=True, ensure_ascii=False)
    messages = [{"role": "system", "content": INSTRUCTIONS},
                {"role": "user", "content": "EVIDENCE LEDGER:\n" + ledger_json}]
    prompt_hash = hashlib.sha256(json.dumps(messages, sort_keys=True).encode()).hexdigest()[:16]
    receipt = {"prompt_sha256_16": prompt_hash, "ledger_size": len(items)}
    det["receipt"] = receipt
    try:
        out, meta = (call or muse.chat_json)(messages, SCHEMA,
                                             timeout=float(os.environ.get("LYLO_HACK_MUSE_TIMEOUT_S", "25")))
    except muse.MuseError as e:
        det["muse_status"] = f"error: {e.code}; deterministic result returned unchanged"
        receipt.update(getattr(e, "meta", {}) or {})
        return result
    except Exception as e:  # fail closed on anything unexpected
        det["muse_status"] = f"error: {type(e).__name__}; deterministic result returned unchanged"
        return result
    receipt.update({k: meta.get(k) for k in ("model", "latency_ms", "usage", "finish_reason")})
    if not isinstance(out, dict):
        det["muse_status"] = "error: BAD_SHAPE; deterministic result returned unchanged"
        return result
    try:
        verified, unverified = verify(out, ids)
        final, action = merge_safety(rule_level, verified["safety_opinion"])
        final, action, cold_note = cap_for_cold_engine(rule_level, final, action, items)
    except Exception as e:
        det["muse_status"] = f"error: BAD_SHAPE ({type(e).__name__}); deterministic result returned unchanged"
        return result
    det.update({"muse_status": "ok", "hypotheses": verified["hypotheses"], "explanation": verified["explanation"],
                "cleared_codes_warning": verified["cleared_codes_warning"],
                "safety_opinion": verified["safety_opinion"], "unverified_claims": unverified,
                "final_safety_level": final, "safety_action": action, "cold_engine_note": cold_note})
    receipt["cited_ledger_ids"] = _cited(verified)
    if action == "raised_by_detective":
        s = result["safety"]
        s["rule_level"] = rule_level
        s["level"] = final
        s.setdefault("triggering_conditions", []).append(
            "Muse Detective raised the level: " + str(verified["safety_opinion"].get("reason", ""))[:200])
    return result
