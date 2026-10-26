"""VIN-first (v0.4.3). Decode a VIN with NHTSA vPIC (public, free, no key), with an in-memory
cache, a short timeout, and fail-open to "unknown". Optional NHTSA recalls by year/make/model.

Rules: a VIN is only used if it passes the ISO 3779 check digit (North American VINs); we
never guess characters. The raw VIN is never sent to Meta AI: the model only sees decoded
fields and the 3-character masked VIN already in the ledger.
Flag: LYLO_HACK_VIN=1 (default off)."""
import json
import os
import re
import time
import urllib.parse
import urllib.request

VPIC = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{vin}?format=json"
RECALLS = "https://api.nhtsa.gov/recalls/recallsByVehicle?make={make}&model={model}&modelYear={year}"
CAVEAT = "assumes the factory engine (not swapped)"
RECALL_SOURCE = "NHTSA recalls by year/make/model (not checked against this exact VIN)"
DECODE_SOURCE = "NHTSA vPIC VIN decoder"
TRANSLIT = dict(zip("ABCDEFGHJKLMNPRSTUVWXYZ", [1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 7, 9, 2, 3, 4, 5, 6, 7, 8, 9]))
WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]
VIN_RX = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")
_cache = {}
CACHE_S = 7 * 24 * 3600


def enabled():
    return os.environ.get("LYLO_HACK_VIN", "0") == "1"


def normalize(vin):
    return re.sub(r"[\s-]", "", str(vin or "")).upper()


def check_digit(vin):
    total = 0
    for ch, w in zip(vin, WEIGHTS):
        total += (int(ch) if ch.isdigit() else TRANSLIT[ch]) * w
    r = total % 11
    return "X" if r == 10 else str(r)


def validate(vin):
    """Returns (ok, reason). Never 'fixes' a VIN."""
    v = normalize(vin)
    if len(v) != 17:
        return False, "A VIN has 17 characters."
    if not VIN_RX.match(v):
        return False, "A VIN never uses the letters I, O or Q."
    if check_digit(v) != v[8]:
        return False, "That VIN doesn't pass the check digit. One character is probably misread."
    return True, ""


def _get(url, timeout):
    req = urllib.request.Request(url, headers={"User-Agent": "LYLO-Mechanic-hackathon/0.4.3"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf8", "replace"))


def _num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def decode(vin, fetch=None, timeout=None):
    """Returns a dict. status: ok | invalid | unknown (network/timeout/no data: fail open)."""
    ok, why = validate(vin)
    if not ok:
        return {"status": "invalid", "reason": why}
    v = normalize(vin)
    hit = _cache.get(v)
    if hit and time.time() - hit[0] < CACHE_S:
        return dict(hit[1], cached=True)
    timeout = timeout or float(os.environ.get("LYLO_HACK_VIN_TIMEOUT_S", "6"))
    try:
        d = (fetch or _get)(VPIC.format(vin=v), timeout)
        r = (d.get("Results") or [{}])[0]
    except Exception:
        return {"status": "unknown", "reason": "Couldn't reach the NHTSA VIN decoder.", "source": DECODE_SOURCE}
    year = r.get("ModelYear") or ""
    make = (r.get("Make") or "").title()
    model = r.get("Model") or ""
    if not (year and make and model):
        return {"status": "unknown", "reason": "NHTSA had no decode for this VIN.", "source": DECODE_SOURCE}
    disp = _num(r.get("DisplacementL"))
    cyl = r.get("EngineCylinders") or ""
    fuel = r.get("FuelTypePrimary") or ""
    engine = " ".join(x for x in [f"{disp:.1f}L" if disp else "", f"{cyl}-cyl" if cyl else "", fuel] if x)
    out = {"status": "ok", "year": int(year) if str(year).isdigit() else year, "make": make, "model": model,
           "trim": r.get("Trim") or "", "engine": engine, "electrification": r.get("ElectrificationLevel") or "",
           "name": f"{year} {make} {model}", "caveat": CAVEAT, "source": DECODE_SOURCE, "vin_masked": v[:3] + "*" * 14}
    _cache[v] = (time.time(), out)
    return out


def recalls(dec, fetch=None, timeout=None):
    """Recall summary by year/make/model, labeled with its source. Fails open."""
    if dec.get("status") != "ok":
        return None
    url = RECALLS.format(make=urllib.parse.quote(dec["make"]), model=urllib.parse.quote(dec["model"]), year=dec["year"])
    try:
        d = (fetch or _get)(url, timeout or 6)
        res = d.get("results") or []
    except Exception:
        return {"status": "unknown", "source": RECALL_SOURCE}
    comps = sorted({str(x.get("Component", "")).split(":")[0].title() for x in res if x.get("Component")})
    return {"status": "ok", "count": len(res), "components": comps[:6], "source": RECALL_SOURCE,
            "check_url": "https://www.nhtsa.gov/recalls"}


def ledger_items(data, fetch=None):
    """Ledger items from the scan's VIN. Only when the flag is on and the VIN is valid. Never the raw VIN."""
    vinv = ((data or {}).get("vehicle_profile") or {}).get("vin")
    if not enabled() or not vinv:
        return []
    dec = decode(vinv, fetch=fetch)
    if dec.get("status") != "ok":
        return []
    return [{"id": "vin:decoded", "type": "vehicle_decoded", "source": "vin_decode", "year": dec["year"],
             "make": dec["make"], "model": dec["model"], "engine": dec["engine"], "caveat": CAVEAT}]


def prompt_line(dec):
    if not dec or dec.get("status") != "ok":
        return ""
    eng = f", {dec['engine']}" if dec.get("engine") else ""
    return f"Vehicle (decoded from VIN; {CAVEAT}): {dec['name']}{eng}."


# --- Photo of VIN: Muse vision reads it; we accept it only if the check digit passes. ---
PHOTO_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["vin_visible", "vin", "unclear_characters"],
    "properties": {"vin_visible": {"type": "boolean"}, "vin": {"type": "string"},
                   "unclear_characters": {"type": "boolean"}},
}
PHOTO_INSTRUCTIONS = """Read the 17-character vehicle VIN in this photo (dashboard plate through the windshield, door-jamb sticker, or registration).
Copy exactly what is printed. VINs never contain I, O or Q. If any character is blurry, hidden or uncertain set unclear_characters=true.
Never guess or fill in characters. If no VIN is visible set vin_visible=false and vin="". Output only the JSON object."""
CANT_READ = "I couldn't read the VIN clearly. Type it in instead, or try a sharper photo."


def read_photo(raw, call=None):
    import base64
    from . import muse
    from .vision import sanitize
    jpeg, info = sanitize(raw)
    url = "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()
    msgs = [{"role": "system", "content": PHOTO_INSTRUCTIONS},
            {"role": "user", "content": [{"type": "image_url", "image_url": {"url": url}}]}]
    out, meta = (call or muse.chat_json)(msgs, PHOTO_SCHEMA, name="vin_photo", max_tokens=600,
                                         timeout=float(os.environ.get("LYLO_HACK_VISION_TIMEOUT_S", "25")))
    receipt = {"model": meta.get("model"), "latency_ms": meta.get("latency_ms"), "usage": meta.get("usage"), "stored": False,
               "metadata_stripped": info.get("metadata_stripped")}
    v = normalize(out.get("vin"))
    ok, why = validate(v)
    if not out.get("vin_visible") or out.get("unclear_characters") or not ok:
        return {"vin_status": "not_read", "message": CANT_READ, "reason": why if out.get("vin_visible") else "No VIN visible.",
                "receipt": receipt}
    return {"vin_status": "read", "vin": v, "receipt": receipt,
            "message": "Check this matches your car before using it."}
