"""Point and prove (hackathon v0.5.0). Flag LYLO_HACK_PROVE=1 (default off = old behavior).

1. A testable prediction is committed BEFORE the reading:
   {hypothesis, pids, condition, threshold, window_s, if_fails}. Vague ones are rejected.
2. It is locked in an append-only, hash-chained ProveLedger (timestamp + sha256).
3. A deterministic checker (never the model) evaluates it on live or replayed readings
   taken AFTER the lock, and sets HELD or FAILED. No readings for its PIDs = stays LOCKED
   ("not proven yet").
4. The model can only PROPOSE a prediction. Any status/proof fields it sends are stripped;
   only check() can set HELD/FAILED. A failed prediction downgrades its hypothesis, never drops it.
5. Safety: nothing here can lower result['safety']['level']; a misfire can only raise it.
"""
import copy
import hashlib
import json
import math
import os
import re
import threading
import time
import uuid

from . import safety as S

CONDITIONS = ("above", "below", "between", "outside", "dtc_present")
STATUSES = ("LOCKED", "HELD", "FAILED")
MISFIRE_DTCS = tuple(f"P030{n}" for n in range(0, 9))  # P0300 random/multiple, P0301..P0308 cylinder N
NOT_REPORTED = "not reported by this vehicle"
MISFIRE_FLOOR = "DRIVE_SHORT_DISTANCE_ONLY"
MODE06_MISFIRE_COUNT = 10  # per-cylinder count above this in the window = misfire seen
KNOWN_PIDS = {
    "RPM", "ENGINE_RPM", "SHORT_TERM_FUEL_TRIM_BANK_1", "LONG_TERM_FUEL_TRIM_BANK_1",
    "SHORT_TERM_FUEL_TRIM_BANK_2", "LONG_TERM_FUEL_TRIM_BANK_2", "STFT_B1", "LTFT_B1", "STFT_B2", "LTFT_B2",
    "ENGINE_COOLANT_TEMP", "INTAKE_AIR_TEMP", "MAF", "MAF_AIR_FLOW_RATE", "ENGINE_LOAD", "CALCULATED_ENGINE_LOAD",
    "THROTTLE_POSITION", "INTAKE_MANIFOLD_PRESSURE", "TIMING_ADVANCE", "VEHICLE_SPEED", "CONTROL_MODULE_VOLTAGE",
    "O2_B1S1", "O2_B1S2", "O2_B2S1", "O2_B2S2", "FUEL_PRESSURE", "FUEL_RAIL_PRESSURE",
} | {f"MISFIRE_COUNT_CYL{n}" for n in range(1, 13)}
VAGUE = re.compile(r"\b(something|anything|maybe|might|possibly|perhaps|some issue|could be|various|may or may not|"
                   r"general(ly)? (problem|issue)|not sure)\b", re.I)
# Phrases that claim the outcome is already known. Phrases rather than bare words, so a normal mechanic sentence
# ("stays below 90C under certain loads") passes.
CLAIMS_PROOF = re.compile(r"\b(confirmed( by)?|is confirmed|proven|proved|verified (by|with)|definitely (is|has)|"
                          r"guaranteed|for sure|no doubt|sensor (shows|showed|confirms)|already (seen|measured))\b"
                          r"|\bproof\s*[:=]", re.I)
_CONFUSE = str.maketrans({"\u0430": "a", "\u0435": "e", "\u043e": "o", "\u0440": "p", "\u0441": "c", "\u0445": "x",
                          "\u0456": "i", "\u0443": "y", "\u0455": "s", "\u0501": "d", "\u0391": "A", "\u0395": "E",
                          "\u039f": "O", "\u03bf": "o", "\u0410": "A", "\u0415": "E", "\u041e": "O", "\u0420": "P",
                          "\u0421": "C", "\u0412": "B", "\u041d": "H", "\u041a": "K", "\u041c": "M", "\u0422": "T",
                          "\u200b": "", "\u200c": "", "\u200d": "", "\u2060": "", "\ufeff": "", "\u00ad": ""})


def fold(text):
    """NFKC, strip zero-width chars, map common Cyrillic/Greek look-alikes, drop accents."""
    import unicodedata
    t = unicodedata.normalize("NFKC", str(text or "")).translate(_CONFUSE)
    t = "".join(c for c in unicodedata.normalize("NFKD", t) if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", t)


def claims_proof(text):
    return bool(CLAIMS_PROOF.search(fold(text)))
MODEL_ONLY_FIELDS = ("status", "measured", "proven", "verified", "outcome", "checked_at", "result", "held", "failed")
SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["hypothesis", "pids", "condition", "threshold", "window_s", "if_fails"],
    "properties": {"hypothesis": {"type": "string"}, "pids": {"type": "array", "items": {"type": "string"}},
                   "condition": {"type": "string", "enum": list(CONDITIONS)},
                   "threshold": {"type": "array", "items": {"type": "number"}},
                   "window_s": {"type": "integer"}, "if_fails": {"type": "string"}},
}


def enabled():
    return os.environ.get("LYLO_HACK_PROVE", "0") == "1"


class Rejected(ValueError):
    pass


def _num(x):
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        raise Rejected("threshold must be numbers")
    if not math.isfinite(float(x)):
        raise Rejected("threshold must be a finite number")
    return float(x)


def validate(raw):
    """Model or rules output -> a clean, testable prediction. Raises Rejected if vague or malformed.
    Status/proof fields are stripped: a proposer can never mark its own claim as proven."""
    if not isinstance(raw, dict):
        raise Rejected("prediction must be an object")
    p = {k: v for k, v in raw.items() if k not in MODEL_ONLY_FIELDS}
    hyp = str(p.get("hypothesis") or "").strip()
    if len(hyp) < 12 or len(hyp) > 240:
        raise Rejected("hypothesis must be 12-240 characters")
    if VAGUE.search(hyp):
        raise Rejected("hypothesis is vague (hedging words are not testable)")
    if claims_proof(hyp) or claims_proof(p.get("if_fails")):
        raise Rejected("a prediction cannot claim it is already proven; only the checker decides")
    cond = p.get("condition")
    if cond not in CONDITIONS:
        raise Rejected("condition must be one of " + ", ".join(CONDITIONS))
    pids = p.get("pids")
    if not isinstance(pids, list) or not pids or len(pids) > 4 or not all(isinstance(x, str) for x in pids):
        raise Rejected("pids must be a list of 1-4 names")
    pids = [x.strip().upper() for x in pids]
    if cond == "dtc_present":
        if not all(re.fullmatch(r"[PBCU][0-9A-F]{4}", x) for x in pids):
            raise Rejected("dtc_present needs trouble codes like P0302")
        thr = []
    else:
        bad = [x for x in pids if x not in KNOWN_PIDS]
        if bad:
            raise Rejected("unknown PID(s): " + ", ".join(bad))
        t = p.get("threshold")
        t = t if isinstance(t, list) else [t]
        thr = [_num(x) for x in t]
        need = 2 if cond in ("between", "outside") else 1
        if len(thr) != need:
            raise Rejected(f"{cond} needs {need} threshold number(s)")
        if need == 2 and not thr[0] < thr[1]:
            raise Rejected("range must be low < high")
    w = p.get("window_s")
    if isinstance(w, bool) or not isinstance(w, (int, float)) or not 5 <= w <= 600:
        raise Rejected("window_s must be 5-600 seconds")
    fails = str(p.get("if_fails") or "").strip()
    if len(fails) < 8:
        raise Rejected("if_fails must say what it means if the reading disagrees")
    return {"hypothesis": hyp, "pids": pids, "condition": cond, "threshold": thr, "window_s": int(w),
            "if_fails": fails[:240]}


def canon(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


class ProveLedger:
    """Append-only, hash-chained. There is no update or delete; entries() returns copies."""

    def __init__(self):
        self._e = []
        self._lock = threading.Lock()

    def append(self, kind, body, now=None):
        with self._lock:
            prev = self._e[-1]["sha256"] if self._e else "0" * 64
            entry = {"seq": len(self._e), "kind": kind, "at": float(now if now is not None else time.time()),
                     "body": copy.deepcopy(body), "prev": prev}
            entry["sha256"] = hashlib.sha256(canon(entry).encode()).hexdigest()
            self._e.append(entry)
            return copy.deepcopy(entry)

    def entries(self):
        with self._lock:
            return copy.deepcopy(self._e)

    def verify(self, head=None, n=None):
        """Chain integrity. Pass the server-held head sha (and count) to also catch tail truncation."""
        if head is not None and (not self._e or self._e[-1]["sha256"] != head):
            return False
        if n is not None and len(self._e) != n:
            return False
        prev = "0" * 64
        for i, e in enumerate(self._e):
            body = {k: v for k, v in e.items() if k != "sha256"}
            if e["prev"] != prev or e["seq"] != i or hashlib.sha256(canon(body).encode()).hexdigest() != e["sha256"]:
                return False
            prev = e["sha256"]
        return True


def _hit(cond, thr, v):
    if cond == "above":
        return v > thr[0]
    if cond == "below":
        return v < thr[0]
    if cond == "between":
        return thr[0] <= v <= thr[1]
    return v < thr[0] or v > thr[1]  # outside


def check(pred, locked_at, samples):
    """Deterministic. samples: [{t (epoch s), pid, value}] and/or [{t, dtc}].
    Only readings with locked_at < t <= locked_at + window_s count (no peeking before the lock).
    Returns {status, measured, n, first_hit}."""
    end = locked_at + pred["window_s"]
    win = [s for s in samples or [] if isinstance(s, dict) and isinstance(s.get("t"), (int, float))
           and locked_at < s["t"] <= end]
    if pred["condition"] == "dtc_present":
        seen = [s for s in win if str(s.get("dtc", "")).upper() in pred["pids"]]
        any_dtc_read = [s for s in win if "dtc" in s or s.get("dtc_read")]
        if seen:
            s = seen[0]
            return {"status": "HELD", "measured": f"{s['dtc'].upper()} reported at +{round(s['t'] - locked_at)} s", "n": len(any_dtc_read)}
        if any_dtc_read:
            return {"status": "FAILED", "measured": "no " + "/".join(pred["pids"]) + " in the window", "n": len(any_dtc_read)}
        return {"status": "LOCKED", "measured": None, "n": 0}
    rel = [s for s in win if str(s.get("pid", "")).upper() in pred["pids"] and isinstance(s.get("value"), (int, float))
           and not isinstance(s.get("value"), bool)]
    if not rel:
        return {"status": "LOCKED", "measured": None, "n": 0}
    for s in rel:
        if _hit(pred["condition"], pred["threshold"], float(s["value"])):
            return {"status": "HELD", "measured": f"{s['pid'].upper()} = {s['value']} at +{round(s['t'] - locked_at)} s", "n": len(rel)}
    peak = max(rel, key=lambda s: s["value"]) if pred["condition"] != "below" else min(rel, key=lambda s: s["value"])
    return {"status": "FAILED", "measured": f"{peak['pid'].upper()} peaked at {peak['value']} ({len(rel)} readings)", "n": len(rel)}


DOWN = {"high": "medium", "medium": "low", "low": "low"}


def downgrade(hypotheses, pred):
    """On FAILED: keep every hypothesis; the one the prediction tested drops a confidence step and is marked."""
    out = copy.deepcopy(hypotheses or [])
    key = pred["hypothesis"].lower()
    matched = False
    for h in out:
        if not isinstance(h, dict):
            continue
        cause = str(h.get("cause") or h.get("cause_name") or "").lower()
        if cause and (cause in key or key in cause or h.get("tested_by_prediction")):
            h["confidence"] = DOWN.get(h.get("confidence"), "low")
            h["prediction_failed"] = True
            matched = True
    if not any(isinstance(h, dict) and h.get("prediction_failed") for h in out):
        out.append({"cause": pred["hypothesis"], "confidence": "low", "prediction_failed": True,
                    "source": "locked prediction", "next_check": pred["if_fails"]})
    return out


def misfire(data):
    """P0300-P0308 from the car, plus Mode 06 per-cylinder counts when the vehicle reports them."""
    codes = []
    dtcs = data.get("raw_dtcs") if isinstance(data.get("raw_dtcs"), list) else []
    for d in dtcs:
        if not isinstance(d, dict):
            continue
        c = str(d.get("code", "")).upper()
        if c in MISFIRE_DTCS:
            codes.append({"code": c, "status": d.get("status", "active"),
                          "cylinder": int(c[-1]) if c != "P0300" else None})
    m6 = data.get("mode06") if isinstance(data.get("mode06"), dict) else {}
    counts = m6.get("misfire_counts") if m6.get("supported") and isinstance(m6.get("misfire_counts"), dict) else None
    per_cyl = None
    if counts:
        per_cyl = {}
        for k, v in counts.items():
            if str(k).isdigit() and isinstance(v, (int, float)) and not isinstance(v, bool):
                per_cyl[int(k)] = v
    worst = max(per_cyl, key=per_cyl.get) if per_cyl else None
    return {"codes": codes,
            "per_cylinder_counts": per_cyl if per_cyl else NOT_REPORTED,
            "worst_cylinder": worst if worst and per_cyl[worst] > MODE06_MISFIRE_COUNT else None,
            "active": bool(codes) or bool(worst and per_cyl[worst] > MODE06_MISFIRE_COUNT)}


def misfire_items(mf):
    items = []
    for c in mf["codes"]:
        items.append({"id": f"misfire:{c['code']}", "type": "misfire", "source": "car", "code": c["code"],
                      "status": c["status"], "cylinder": c["cylinder"]})
    if isinstance(mf["per_cylinder_counts"], dict):
        for n, v in sorted(mf["per_cylinder_counts"].items()):
            items.append({"id": f"m06:misfire:cyl{n}", "type": "mode06_misfire", "source": "car", "cylinder": n, "count": v})
    else:
        items.append({"id": "m06:misfire:not_reported", "type": "mode06_misfire", "source": "car", "value": NOT_REPORTED})
    return items


def rule_prediction(data, mf):
    """Deterministic default proposal (used when the model gives none or a rejected one)."""
    cyl = next((c["cylinder"] for c in mf["codes"] if c["cylinder"]), None) or mf["worst_cylinder"]
    if cyl:
        if isinstance(mf["per_cylinder_counts"], dict):
            return {"hypothesis": f"Cylinder {cyl} is misfiring (coil, plug, injector or wiring on cylinder {cyl})",
                    "pids": [f"MISFIRE_COUNT_CYL{cyl}"], "condition": "above", "threshold": [MODE06_MISFIRE_COUNT],
                    "window_s": 90, "if_fails": f"Cylinder {cyl} is not misfiring now; the stored code may be old or intermittent."}
        return {"hypothesis": f"Cylinder {cyl} is misfiring (coil, plug, injector or wiring on cylinder {cyl})",
                "pids": [f"P030{cyl}"], "condition": "dtc_present", "threshold": [], "window_s": 90,
                "if_fails": f"The cylinder {cyl} code did not come back at idle; the fault may be intermittent."}
    pids = data.get("raw_pids") if isinstance(data.get("raw_pids"), list) else []
    for p in pids:
        if not isinstance(p, dict):
            continue
        if p.get("name") in ("SHORT_TERM_FUEL_TRIM_BANK_1", "STFT_B1") and isinstance(p.get("raw_value"), (int, float)) \
                and p["raw_value"] > 10:
            return {"hypothesis": "The engine is running lean at idle (air leak or weak fuel delivery)",
                    "pids": [p["name"]], "condition": "above", "threshold": [10], "window_s": 60,
                    "if_fails": "Fuel trim settled under 10 %, so the lean reading was likely a cold-engine effect."}
    return None


def text_for(pred):
    c, t, p = pred["condition"], pred["threshold"], "/".join(pred["pids"])
    if c == "dtc_present":
        return f"{pred['hypothesis']}: {p} will be reported within {pred['window_s']} s"
    rng = {"above": f"above {t[0]:g}", "below": f"below {t[0]:g}"}.get(c) or \
        (f"between {t[0]:g} and {t[1]:g}" if c == "between" else f"outside {t[0]:g}-{t[1]:g}")
    return f"{pred['hypothesis']}: {p} will read {rng} within {pred['window_s']} s"


class Store:
    """In-memory prove sessions (bounded). Each session owns its append-only ledger."""

    def __init__(self, cap=200):
        self.s, self.cap, self._l = {}, cap, threading.Lock()

    def put(self, sess):
        with self._l:
            if len(self.s) >= self.cap:
                self.s.pop(next(iter(self.s)))
            self.s[sess["id"]] = sess

    def get(self, sid):
        with self._l:
            return self.s.get(sid)


STORE = Store()


def lock(result, data, proposal=None, source="model", now=None, store=STORE):
    """Attach detective.prediction (LOCKED) and detective.prove. Returns the session id (or None)."""
    det = result.setdefault("detective", {})
    mf = misfire(data)
    det.setdefault("ledger", []).extend(misfire_items(mf))
    if mf["active"]:
        S.apply_floor(result, MISFIRE_FLOOR, "the car reports an active misfire", "misfire_rule")
    rejected = None
    pred = None
    if proposal is not None:
        try:
            pred = validate(proposal)
        except Rejected as e:
            rejected = str(e)
    if pred is None:
        rp = rule_prediction(data, mf)
        pred, source = (validate(rp), "rules") if rp else (None, None)
    prove = {"misfire": mf, "proposal_rejected": rejected}
    det["prove"] = prove
    if not pred:
        det["prediction"] = None
        prove["note"] = "No testable prediction for this scan."
        return None
    led = ProveLedger()
    e = led.append("prediction", {"prediction": pred, "proposed_by": source}, now=now)
    sid = uuid.uuid4().hex[:16]
    store.put({"id": sid, "pred": pred, "locked_at": e["at"], "ledger": led, "source": source,
               "mutex": threading.Lock(), "head_sha": e["sha256"], "n_entries": 1,
               "hypotheses": copy.deepcopy(det.get("hypotheses") or result.get("hypotheses") or []), "outcome": None})
    det["prediction"] = {"text": text_for(pred), "status": "LOCKED", "measured": None}
    prove.update({"session_id": sid, "prediction": pred, "proposed_by": source, "locked_at": e["at"],
                  "lock_sha256": e["sha256"], "ledger": led.entries()})
    return sid


def evaluate(sid, samples, now=None, store=STORE):
    """Run the checker once. The first HELD/FAILED outcome is final; later calls return it unchanged."""
    sess = store.get(sid)
    if not sess:
        return None
    led = sess["ledger"]
    with sess["mutex"]:  # check + append + set outcome are one step: concurrent checks cannot record two outcomes
        if sess["outcome"] is None:
            r = check(sess["pred"], sess["locked_at"], samples)
            if r["status"] != "LOCKED":
                e = led.append("outcome", {"status": r["status"], "measured": r["measured"], "n": r["n"],
                                           "checked_by": "deterministic checker"}, now=now)
                sess["outcome"] = dict(r, sha256=e["sha256"])
                sess["head_sha"], sess["n_entries"] = e["sha256"], sess["n_entries"] + 1
            else:
                return _view(sess, dict(r, measured=r["measured"] or "not proven yet"))
        return _view(sess, sess["outcome"])


def chain_ok(sess):
    """Chain intact AND its tail matches the head this server recorded (catches tail truncation)."""
    return sess["ledger"].verify(head=sess["head_sha"], n=sess["n_entries"])


def _view(sess, r):
    hyps = sess["hypotheses"]
    if r["status"] == "FAILED":
        hyps = downgrade(hyps, sess["pred"])
    return {"prediction": {"text": text_for(sess["pred"]), "status": r["status"], "measured": r.get("measured")},
            "prove": {"session_id": sess["id"], "prediction": sess["pred"], "proposed_by": sess["source"],
                      "locked_at": sess["locked_at"], "ledger": sess["ledger"].entries(),
                      "chain_ok": chain_ok(sess), "head_sha256": sess["head_sha"], "if_fails": sess["pred"]["if_fails"] if r["status"] == "FAILED" else None},
            "hypotheses": hyps}


# ---- REPLAY: a recorded PID session through the same lock -> check pipeline, always badged ----
REPLAY_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "demo_scans")
REPLAY_CASES = ("prove_misfire_synthetic", "prove_lean_fail_synthetic")


def replay_session(session, case_id, now=None, store=STORE):
    """session: {scan, samples:[{dt (s after lock), pid,value | dtc}], synthetic, title}. Same pipeline as live."""
    from . import live
    data = copy.deepcopy(session["scan"])
    result = live.diagnose(data, muse=False)
    t0 = float(now if now is not None else time.time())
    sid = lock(result, data, proposal=session.get("proposal"), source="replay proposal" if session.get("proposal") else "model",
               now=t0, store=store)
    det = result["detective"]
    synthetic = bool(session.get("synthetic", True))
    label = ("SYNTHETIC " if synthetic else "RECORDED ") + str(session.get("title") or case_id)[:80]
    result["replay"] = {"badge": "REPLAY", "label": label, "synthetic": synthetic, "case": case_id,
                        "note": "Recorded readings played back through the live pipeline. Not live data."}
    if sid:
        samples = []
        for s in session.get("samples") or []:
            if isinstance(s, dict) and isinstance(s.get("dt"), (int, float)):
                samples.append(dict({k: v for k, v in s.items() if k != "dt"}, t=t0 + s["dt"]))
        v = evaluate(sid, samples, store=store)
        det["prediction"] = v["prediction"]
        det["prove"].update(v["prove"])
        det["prove"]["hypotheses_after"] = v["hypotheses"]
    det["prediction_replay"] = True
    return result


def load_replay(case_id):
    if case_id not in REPLAY_CASES:
        return None
    with open(os.path.join(REPLAY_DIR, case_id + ".json"), encoding="utf-8") as f:
        return json.load(f)
