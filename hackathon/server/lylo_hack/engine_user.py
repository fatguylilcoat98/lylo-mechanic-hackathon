"""v0.4.8: owner-set engine ("Not my engine?").

LYLO_HACK_ENGINE_OVERRIDE=1 turns this on. Unset or 0 = nothing here is used and every
route behaves exactly as before (the user fields are ignored).

The owner can say the government VIN decode got the engine wrong (old Ford cutaways can
decode as diesel when the truck runs gas, and engines get swapped). The owner's engine is
preferred over the NHTSA decode in what Meta AI sees, and every place it is used is
labeled "set by owner". The NHTSA decode of the engine never reaches the model then; it is
returned to the phone only (vehicle_engine.nhtsa_engine).
"""
import os
import re

FUELS = {"gas": "Gas", "diesel": "Diesel", "hybrid_ev": "Hybrid/EV", "not_sure": "Not sure"}
MAX_ENGINE = 60
SOURCE_USER = "set by owner"
SOURCE_VPIC = "NHTSA vPIC VIN decode"
_SAFE = re.compile(r"[^A-Za-z0-9 .,/()+\-']")
HINT = ("The government VIN decode lists a diesel for this truck, but it may be wrong for this VIN: decodes for "
        "some older Ford E-series and F-series trucks are not always right. Check the engine label or the fuel door, "
        "and tap \"Not my engine?\" if yours is different.")


def enabled():
    return os.environ.get("LYLO_HACK_ENGINE_OVERRIDE") == "1"


def clean_engine(v):
    """Plain text, length-capped. Returns '' for anything unusable."""
    if not isinstance(v, str):
        return ""
    s = _SAFE.sub("", v)
    s = " ".join(s.split())[:MAX_ENGINE].strip()
    return s


def clean_fuel(v):
    v = str(v or "").strip().lower()
    return v if v in FUELS else ""


def from_fields(src):
    """{engine, fuel, label} from a dict-like (vehicle_profile or form). None when off or empty."""
    if not enabled() or not src:
        return None
    try:
        eng = clean_engine(src.get("engine_user"))
        fuel = clean_fuel(src.get("fuel_user"))
    except Exception:
        return None
    if not eng and not fuel:
        return None
    label = " ".join(x for x in [eng, "" if (not fuel or fuel == "not_sure" or FUELS[fuel].lower() in eng.lower()) else FUELS[fuel]] if x)
    if not label:
        label = "Owner is not sure of the engine"
    return {"engine": eng, "fuel": fuel, "label": label, "engine_source": SOURCE_USER}


def validation_errors(vp):
    """Extra checks for the live payload. Only when the flag is on (off = no new errors)."""
    if not enabled() or not isinstance(vp, dict):
        return []
    errs = []
    for f in ("engine_user", "fuel_user", "engine_source"):
        if vp.get(f) is not None and not isinstance(vp[f], str):
            errs.append(f"vehicle_profile.{f} must be a string.")
    if isinstance(vp.get("engine_user"), str) and len(vp["engine_user"]) > 200:
        errs.append("vehicle_profile.engine_user is too long.")
    if isinstance(vp.get("fuel_user"), str) and vp["fuel_user"].strip() and not clean_fuel(vp["fuel_user"]):
        errs.append(f"vehicle_profile.fuel_user must be one of {sorted(FUELS)}.")
    return errs


def apply_to_items(items, data, result=None):
    """Prefer the owner's engine in the ledger. Mutates and returns items. No-op when off.

    The ledger is sent to Meta AI, so when the owner set the engine the decoded engine is
    REMOVED from every item (Vera review). It is kept only for the phone, in
    result["vehicle_engine"]["nhtsa_engine"], when a result dict is given."""
    ov = from_fields((data or {}).get("vehicle_profile") or {})
    if not ov:
        return items
    nhtsa = ""
    for it in items:
        if it.get("id") == "vin:decoded":
            nhtsa = it.get("engine", "") or nhtsa
            it.pop("nhtsa_engine", None)
            it["engine"] = ov["label"]
            it["engine_source"] = SOURCE_USER
            it["caveat"] = "engine set by the owner; year, make and model are from the VIN decode"
        elif it.get("id") == "veh:engine":
            nhtsa = nhtsa or str(it.get("value") or "")
            it["value"] = ov["label"]
            it["engine_source"] = SOURCE_USER
    if not any(i.get("id") == "veh:engine_user" for i in items):
        items.extend(vehicle_items(ov))
    if isinstance(result, dict):
        result["vehicle_engine"] = {"engine": ov["label"], "engine_source": SOURCE_USER, "nhtsa_engine": nhtsa}
    return items


def vehicle_items(ov):
    """Ledger item for routes without a scan (no-adapter)."""
    if not ov:
        return []
    return [{"id": "veh:engine_user", "type": "vehicle_engine_user", "source": "owner", "engine": ov["label"],
             "fuel": ov["fuel"] or "unknown",
             "note": "The owner set this engine. Prefer it over the VIN decode's engine; do not give diesel advice unless fuel is diesel."}]


def apply_to_decode(dec, ov):
    """Copy of a vin.decode() result with the owner's engine in place of the decoded one
    (photo helper prompt). The decoded engine is NOT in the copy; the caller reads it from
    the original dec for the phone's response only."""
    if not ov or not dec or dec.get("status") != "ok":
        return dec
    out = dict(dec)
    out["engine"] = ov["label"] + " (set by owner)"
    out["engine_source"] = SOURCE_USER
    return out


_LIGHT_FORD = re.compile(r"^\s*(E|F)[\s-]?(150|250|350|450|550)\b", re.I)


def decode_hint(dec):
    """Cautious 'double-check your engine' hint. Only when on, vPIC says diesel, and it's a Ford E/F-series."""
    if not enabled() or not dec or dec.get("status") != "ok":
        return None
    if str(dec.get("make", "")).lower() != "ford" or not _LIGHT_FORD.match(str(dec.get("model", ""))):
        return None
    if "diesel" not in str(dec.get("engine", "")).lower():
        return None
    return HINT
