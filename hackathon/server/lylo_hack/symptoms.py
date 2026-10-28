"""No-adapter check (hackathon v0.5.0): symptoms in words or voice, manually typed trouble codes,
optional dash-photo items. Builds an evidence ledger WITHOUT live sensor data.

Flag LYLO_HACK_NO_ADAPTER (default 0 = route off).
Safety floors here are fixed rules (regex on the owner's words), applied BEFORE any AI answer;
the AI can only agree or raise (same never-lower rules and citation check as voice questions).
"""
import os
import re

from . import ledger as L
from .safety import higher

NO_SENSOR_NOTE = ("No adapter: there is no live sensor data, so this is based only on what you told us "
                  "(and any photo or code you added). Confidence is lower than a scan with an OBD adapter.")
BASE_LEVEL = "INSPECT_SOON"  # with no readings we never say "safe to drive"
CODE_RE = re.compile(r"\b([PCBU][0-3][0-9A-F]{3})\b", re.I)
MAX_TEXT = 1000
MAX_CODES = 10

# (id, pattern, floor, plain reason). Order: most severe first. All rules, no AI.
RULES = [
    ("fire", r"\b(fire|flames?|on fire)\b", "EMERGENCY_STOP_IMMEDIATELY", "fire or flames: stop, turn the engine off, get everyone out and away"),
    ("smoke", r"\bsmok(e|es|ing|y)\b", "DO_NOT_DRIVE", "smoke reported"),
    ("steam", r"\b(steam|steaming)\b", "DO_NOT_DRIVE", "steam from the engine: possible overheating"),
    ("burning_smell", r"\bburn(ing|t)?\b.{0,20}\bsmell|\bsmell.{0,20}\bburn(ing|t)?\b", "DO_NOT_DRIVE", "burning smell"),
    ("fuel_smell", r"\b(gas|fuel|gasoline)\b.{0,15}\b(smell|leak)|\bsmell.{0,15}\b(gas|fuel)\b", "DO_NOT_DRIVE", "fuel smell or leak: fire risk"),
    ("brake_grind", r"\bgrind\w*.{0,25}\bbrak\w*|\bbrak\w*.{0,25}\bgrind\w*", "DO_NOT_DRIVE", "grinding brakes"),
    ("brake_soft", r"\bbrak\w*.{0,30}\b(soft|spongy|to the floor|sinks?|fail\w*|not work\w*|won.?t stop)\b|\bpedal.{0,20}\b(floor|spongy|soft)\b",
     "DO_NOT_DRIVE", "brakes soft, sinking or failing"),
    ("brake_light", r"\b(red\s+)?brake\s+(warning\s+)?light\b", "DO_NOT_DRIVE", "brake warning light"),
    ("oil_light", r"\boil\s+(pressure\s+)?(warning\s+)?light\b|\boil\s+can\s+light\b", "DO_NOT_DRIVE", "oil pressure light: possible loss of oil pressure"),
    ("overheat", r"\boverheat\w*|\b(temp|temperature)\b.{0,25}\b(high|hot|red|light)\b|\bgauge.{0,20}\b(hot|red|h\b)|\bcoolant\s+(warning\s+)?light\b",
     "DO_NOT_DRIVE", "overheating or hot temperature gauge/light"),
    ("steering", r"\bsteering\b.{0,25}\b(lock\w*|stuck|hard|heavy|loose|failed|gone)\b", "DO_NOT_DRIVE", "steering problem"),
    ("flashing_cel", r"\b(flash\w*|blink\w*)\b.{0,25}\b(check\s+engine|engine\s+light|cel)\b|\b(check\s+engine|engine\s+light|cel)\b.{0,25}\b(flash\w*|blink\w*)\b",
     "DO_NOT_DRIVE", "flashing check-engine light: severe misfire can damage the engine"),
    ("wheel_wobble", r"\b(wheel|tire)\b.{0,25}\b(wobbl\w*|loose|falling off)\b", "DO_NOT_DRIVE", "wheel or tire loose or wobbling"),
    ("check_engine", r"\bcheck\s+engine\b|\bengine\s+light\b|\bcel\b", "INSPECT_SOON", "check-engine light on"),
]
_COMPILED = [(i, re.compile(p, re.I), f, r) for i, p, f, r in RULES]
NEG = re.compile(r"\b(no|not|never|without|isn.?t|aren.?t|don.?t|doesn.?t)\s+(any\s+|a\s+)?$", re.I)


def enabled():
    return os.environ.get("LYLO_HACK_NO_ADAPTER", "0") == "1"


def match_rules(text):
    """Rule hits on the owner's words. A hit directly negated ("no smoke") is skipped."""
    t = (text or "")[:MAX_TEXT]
    hits = []
    for rid, rx, floor, reason in _COMPILED:
        for m in rx.finditer(t):
            if NEG.search(t[max(0, m.start() - 20):m.start()]):
                continue
            hits.append({"id": f"sym:{rid}", "type": "symptom_reported", "source": "owner's words",
                         "trust": "described by the owner, not measured", "rule": rid, "floor": floor,
                         "reason": reason, "matched": m.group(0)[:60]})
            break
    # a flashing CEL already covers a plain CEL
    if any(h["rule"] == "flashing_cel" for h in hits):
        hits = [h for h in hits if h["rule"] != "check_engine"]
    return hits


def parse_codes(raw):
    """Codes from a list or free text; invalid entries returned separately."""
    vals = raw if isinstance(raw, list) else re.split(r"[\s,;]+", str(raw or ""))
    good, bad = [], []
    for v in vals:
        v = str(v).strip().upper()
        if not v:
            continue
        (good if CODE_RE.fullmatch(v) else bad).append(v)
    return list(dict.fromkeys(good))[:MAX_CODES], bad[:MAX_CODES]


def build(text, codes, vehicle=None, photo_items=None, diagnose=None, photo_floor=None, photo_reasons=()):
    """Deterministic part. Returns (items, rule_level, notes). `diagnose(data)` runs the baseline
    pipeline for typed codes (rule safety + hypotheses); with no codes the base level is INSPECT_SOON."""
    vehicle = {k: v for k, v in (vehicle or {}).items() if k in ("year", "make", "model") and v not in (None, "")}
    items, level, notes = [], BASE_LEVEL, []
    result = None
    if codes and diagnose:
        data = {"adapter_id": "none (no adapter: codes typed by the owner)", "protocol": "none", "connection_quality": "stable",
                "read_complete": False, "raw_dtcs": [{"code": c, "status": "active"} for c in codes],
                "raw_pids": [], "readiness_monitors": [], "vehicle_profile": vehicle}
        try:
            result = diagnose(data)
            level = higher(BASE_LEVEL, (result.get("safety") or {}).get("level"))
            items = [i for i in L.build_ledger(data, result) if i["id"] != "rule:safety"]
            for i in items:
                if i["type"] == "dtc":
                    i["source"] = "typed by the owner"
        except Exception:
            notes.append("The code check failed on the server; codes are listed but not analyzed.")
            result = None
    if codes and result is None:
        items += [{"id": f"dtc:{c}:typed", "type": "dtc", "code": c, "source": "typed by the owner"} for c in codes]
    if not result:
        for k, v in vehicle.items():
            items.append({"id": f"veh:{k}", "type": "vehicle", "name": k, "value": v})
    hits = match_rules(text)
    triggers = []
    for h in hits:
        new = higher(level, h["floor"])
        if new != level or h["floor"] == level:
            triggers.append(f"{h['reason']} [{h['id']}]")
        level = new
    items += hits
    items += list(photo_items or [])
    if photo_floor in L.SAFETY_ORDER and higher(level, photo_floor) != level:
        level = photo_floor
        triggers.append("photo: " + "; ".join(photo_reasons)[:180])
    if text:
        items.append({"id": "owner:description", "type": "owner_description", "source": "owner's words", "text": text[:MAX_TEXT]})
    items.append({"id": "ctx:no_adapter", "type": "context", "text": NO_SENSOR_NOTE})
    rs = {"id": "rule:safety", "type": "rule_safety", "level": level, "triggers": triggers[:6]}
    if result:
        rs["triggers"] = ([str(t)[:200] for t in (result.get("safety") or {}).get("triggering_conditions", [])] + triggers)[:6]
    items.append(rs)
    return items, level, notes, hits, result
