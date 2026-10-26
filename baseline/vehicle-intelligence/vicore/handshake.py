"""Capability handshake. Unsupported means the vehicle said no. Untested means we did not learn it."""

from __future__ import annotations

import hashlib
import uuid

from vicore import ANALYSIS_VERSION
from vicore.features import evaluate_features
from vicore.obdparse import (
    can_line,
    decode_bitmap,
    decode_dtcs,
    decode_vin,
    parse_response,
)
from vicore.phone import phone_signal_state
from vicore.registry import load_registry, pid_hex
from vicore.timeutil import iso_from_epoch
from vicore.transport import AdapterTimeout, TransportError

IDENTITY_COMMANDS = ("ATI", "AT@1", "AT@2", "STI", "STDI", "STSN", "ATRV", "ATIGN")


def run_handshake(elm, *, vehicle_id: str | None, session_id: str, phone: dict, transport_meta: dict) -> dict:
    registry = load_registry()
    elm.initialize()
    identity = _identity(elm)
    protocol = _protocol(elm)
    mode01 = _mode01(elm)
    mode09 = _mode09(elm, protocol.get("number"))
    mode06 = _mode_support(elm, "0600", positive_service=0x46)
    diagnostic = {
        "mode03": _dtc_probe(elm, "03", protocol.get("number")),
        "mode07": _dtc_probe(elm, "07", protocol.get("number")),
        "mode0A": _dtc_probe(elm, "0A", protocol.get("number")),
        "mode04_clear": {
            "state": "UNSUPPORTED",
            "reason": "vicore will not send mode 04",
            "claim": "NONE",
        },
        "mode06": mode06,
    }
    vin_block = mode09.get("vin") or {"value": None, "status": "UNTESTED", "raw": ""}
    fingerprint = _fingerprint(protocol, mode01, identity)
    resolved_vehicle = vehicle_id or _vehicle_id(vin_block, fingerprint)
    support = _signal_support(registry, mode01, identity, phone)
    features = evaluate_features(support, benchmark=None)
    profile = {
        "profile_version": 1,
        "hardware_tested": bool(transport_meta.get("hardware_tested")),
        "vehicle_id": resolved_vehicle,
        "session_id": session_id,
        "created_at": iso_from_epoch(elm.clock.wall()),
        "analysis_version": ANALYSIS_VERSION,
        "adapter": identity,
        "protocol": protocol,
        "vin": vin_block,
        "fingerprint": fingerprint,
        "mode01": mode01,
        "mode06": mode06,
        "mode09": mode09,
        "ecus": mode01.get("ecus") or [],
        "transport": transport_meta,
        "diagnostic": diagnostic,
        "phone_sensors": phone,
        "signals": support,
        "acquisition_benchmark": None,
        "sustained_feature_rate_hz": None,
        "sustained_feature_rate_definition": None,
        "features": features,
        "transcript": list(elm.transcript),
    }
    return profile


def _identity(elm) -> dict:
    raw = {}
    for command in IDENTITY_COMMANDS:
        raw[command] = _try(elm, command, timeout=2.0)
    name = _clean_name(raw.get("AT@1"))
    firmware = _first_useful(raw.get("STI"), raw.get("ATI"), raw.get("ATZ"))
    identity_raw = name or firmware or "UNKNOWN_ADAPTER"
    vendor = None
    blob = " ".join(v for v in (name, firmware, raw.get("STDI")) if v)
    if "MX+" in blob.upper() or "OBDLINK MX" in blob.upper():
        vendor = "OBDLink MX+"
    elif "OBDLINK" in blob.upper():
        vendor = "OBDLink"
    elif "STN" in blob.upper():
        vendor = "STN"
    elif "ELM327" in blob.upper():
        vendor = "ELM327-compatible"
    return {
        "adapter_id": "",
        "identity_raw": identity_raw,
        "firmware": firmware,
        "serial_number": None if _is_failure(raw.get("STSN")) else raw.get("STSN"),
        "reported_name": name,
        "vendor_hint": vendor,
        "ignition": raw.get("ATIGN"),
        "commands": raw,
    }


def _protocol(elm) -> dict:
    name = _try(elm, "ATDP", timeout=2.0)
    number = _try(elm, "ATDPN", timeout=2.0)
    # A leading A means automatic selection. The real number is the last character.
    number_clean = (number or "").strip().upper()
    if number_clean.startswith("A") and len(number_clean) >= 2:
        auto = True
        number_clean = number_clean[-1]
    else:
        auto = False
    if _is_failure(name) and _is_failure(number):
        return {
            "name": None,
            "number": None,
            "auto": auto,
            "transport": None,
            "state": "UNTESTED",
            "reason": "protocol describe commands failed",
        }
    return {
        "name": None if _is_failure(name) else name,
        "number": None if _is_failure(number) else number_clean,
        "auto": auto,
        "transport": _protocol_transport(number_clean),
        "state": "FULL" if number_clean else "REDUCED",
        "reason": "adapter reported the current protocol",
    }


def _protocol_transport(number: str | None) -> str | None:
    table = {
        "1": "SAE_J1850_PWM",
        "2": "SAE_J1850_VPW",
        "3": "ISO_9141_2",
        "4": "ISO_14230_5BAUD",
        "5": "ISO_14230_FAST",
        "6": "ISO_15765_CAN_11_500",
        "7": "ISO_15765_CAN_29_500",
        "8": "ISO_15765_CAN_11_250",
        "9": "ISO_15765_CAN_29_250",
        "A": "SAE_J1939",
    }
    if not number:
        return None
    return table.get(number)


def _mode01(elm) -> dict:
    bitmaps = {}
    ecus: list[dict] = []
    supported: set[int] = set()
    group = 0x00
    while group <= 0xC0:
        command = f"01{group:02X}"
        body = _try(elm, command, timeout=8.0 if group == 0x00 else 2.0)
        quality, frames = parse_response(body or "")
        if quality != "OK":
            if group == 0x00:
                return {
                    "bitmap_raw": {},
                    "supported_pids": [],
                    "ecus": ecus,
                    "state": "UNTESTED",
                    "reason": f"0100 {quality}",
                    "raw_0100": body,
                }
            break
        parsed = []
        for frame in frames:
            if frame.header and frame.header not in {item["header"] for item in ecus}:
                ecus.append(_ecu_record(frame.header))
            payload = frame.payload
            if len(payload) < 6 or payload[0] != 0x41 or payload[1] != group:
                continue
            parsed.append((frame.header, payload[2:6]))
        if not parsed:
            break
        preferred = [raw for header, raw in parsed if header in (None, "7E8", "18DAF110")]
        headers = {header for header, _raw in parsed}
        if preferred:
            chosen_raw = preferred[0]
        elif len(headers) == 1:
            chosen_raw = parsed[0][1]
        else:
            # Several modules answered and none is the standard ECM address.
            # Do not union their bitmaps into a fake support list.
            bitmaps[f"{group:02X}"] = "AMBIGUOUS"
            break
        bitmaps[f"{group:02X}"] = chosen_raw.hex().upper()
        supported |= decode_bitmap(group, chosen_raw)
        next_pid = group + 0x20
        if next_pid not in supported:
            break
        group = next_pid
    return {
        "bitmap_raw": bitmaps,
        "supported_pids": [f"{pid:02X}" for pid in sorted(supported)],
        "ecus": ecus,
        "state": "FULL" if bitmaps else "UNTESTED",
        "reason": "mode 01 support bitmaps" if bitmaps else "no bitmap parsed",
    }


def _ecu_record(header: str) -> dict:
    if header == "7E8":
        hint = "ecm_response_address"
    elif header == "18DAF110":
        hint = "ecm_response_address_29bit"
    else:
        hint = "other_responding_header"
    return {"header": header, "role_hint": hint}


def _mode09(elm, protocol_number: str | None) -> dict:
    body = _try(elm, "0900", timeout=3.0)
    quality, frames = parse_response(body or "")
    supported: set[int] = set()
    if quality == "OK":
        for frame in frames:
            payload = frame.payload
            if len(payload) >= 6 and payload[0] == 0x49 and payload[1] == 0x00:
                supported |= decode_bitmap(0x00, payload[2:6])
    elif quality == "NEGATIVE_RESPONSE":
        return {
            "state": "UNSUPPORTED",
            "reason": "mode 09 negative response",
            "supported_pids": [],
            "vin": {"value": None, "status": "UNSUPPORTED", "raw": body},
            "calibration_raw": None,
            "ecu_name_raw": None,
        }
    else:
        return {
            "state": "UNTESTED",
            "reason": f"0900 {quality}",
            "supported_pids": [],
            "vin": {"value": None, "status": "UNTESTED", "raw": body or ""},
            "calibration_raw": None,
            "ecu_name_raw": None,
        }
    vin = {"value": None, "status": "UNSUPPORTED", "raw": ""}
    if 0x02 in supported:
        vin = _read_vin(elm)
    else:
        vin = {"value": None, "status": "UNSUPPORTED", "raw": "", "reason": "PID 02 bit clear"}
    calibration = None
    ecu_name = None
    if 0x04 in supported:
        calibration = _try(elm, "0904", timeout=3.0)
    if 0x0A in supported:
        ecu_name = _try(elm, "090A", timeout=3.0)
    return {
        "state": "FULL",
        "reason": "mode 09 support bitmap",
        "supported_pids": [f"{pid:02X}" for pid in sorted(supported)],
        "vin": vin,
        "calibration_raw": calibration,
        "ecu_name_raw": ecu_name,
        "protocol_number": protocol_number,
    }


def _read_vin(elm) -> dict:
    body = _try(elm, "0902", timeout=4.0)
    quality, frames = parse_response(body or "")
    if quality != "OK" or not frames:
        return {"value": None, "status": "UNTESTED", "raw": body or "", "reason": quality}
    # Concatenate payloads from the preferred ECU only.
    chosen = [frame for frame in frames if frame.header in (None, "7E8", "18DAF110")]
    if not chosen and len(frames) == 1:
        chosen = frames
    if not chosen:
        return {
            "value": None,
            "status": "UNTESTED",
            "raw": body or "",
            "reason": "VIN frames had no single ECM header",
        }
    payload = b"".join(frame.payload for frame in chosen)
    # If each frame repeats 49 02, decode the first complete one instead of concatenating headers.
    vin, status = decode_vin(chosen[0].payload)
    if vin is None and len(chosen) > 1:
        # ELM sometimes splits ASCII across lines that each start with 49 02 <index>.
        chars = bytearray()
        for frame in chosen:
            data = frame.payload
            if len(data) >= 3 and data[0] == 0x49 and data[1] == 0x02:
                chars.extend(data[3:])
            else:
                chars.extend(data)
        vin, status = decode_vin(bytes(chars))
    if vin is None:
        return {"value": None, "status": "UNTESTED", "raw": body or "", "reason": status}
    return {"value": vin, "status": "READ", "raw": body or "", "reason": status}


def _mode_support(elm, command: str, positive_service: int) -> dict:
    body = _try(elm, command, timeout=3.0)
    quality, frames = parse_response(body or "")
    if quality == "NEGATIVE_RESPONSE":
        code = frames[0].negative_code() if frames else None
        return {
            "state": "UNSUPPORTED",
            "reason": f"negative response {code}" if code is not None else "negative response",
            "raw": body,
        }
    if quality != "OK":
        return {"state": "UNTESTED", "reason": quality, "raw": body}
    for frame in frames:
        if frame.payload and frame.payload[0] == positive_service:
            return {
                "state": "SUPPORTED",
                "reason": f"positive {positive_service:#x} response",
                "raw": body,
                "o2_trend_computed": False,
            }
    return {"state": "UNTESTED", "reason": "response did not contain the service byte", "raw": body}


def _dtc_probe(elm, command: str, protocol_number: str | None) -> dict:
    body = _try(elm, command, timeout=3.0)
    quality, frames = parse_response(body or "")
    if quality == "NEGATIVE_RESPONSE":
        return {
            "state": "UNSUPPORTED",
            "reason": "negative response",
            "raw": body,
            "codes": [],
            "claim": "NONE",
        }
    if quality != "OK" or not frames:
        return {
            "state": "UNTESTED",
            "reason": quality,
            "raw": body,
            "codes": [],
            "claim": "NONE",
        }
    parsed = decode_dtcs(frames[0].payload, protocol_number)
    return {
        "state": "SUPPORTED",
        "reason": "service responded",
        "raw": body,
        "codes": parsed["codes"],
        "dtc_count": parsed["dtc_count"],
        "parse_status": parsed["parse_status"],
        "claim": "NONE",
    }


def _signal_support(registry: dict, mode01: dict, identity: dict, phone: dict) -> dict:
    supported_pids = set(mode01.get("supported_pids") or [])
    mode01_known = mode01.get("state") == "FULL"
    out = {}
    for signal_id, signal in registry.items():
        detection = signal["support_detection"]
        kind = detection.get("type")
        if kind == "mode01_bitmap":
            pid = f"{pid_hex(signal):02X}"
            if not mode01_known:
                state, reason = "UNTESTED", "mode 01 bitmap was not read"
            elif pid in supported_pids:
                state, reason = "FULL", f"mode 01 PID {pid} bit set"
            else:
                state, reason = "UNSUPPORTED", f"mode 01 PID {pid} bit clear"
        elif kind == "stn_command":
            raw = (identity.get("commands") or {}).get(detection["command"])
            if raw and not _is_failure(raw):
                state, reason = "FULL", f"{detection['command']} responded"
            elif raw:
                state, reason = "UNSUPPORTED", f"{detection['command']} rejected"
            else:
                state, reason = "UNTESTED", f"{detection['command']} not run"
        elif kind == "phone_sensor":
            state = phone_signal_state(phone, detection["sensor"])
            reason = ((phone.get("sensors") or {}).get(detection["sensor"]) or {}).get(
                "reason", "phone sensor untested"
            )
        elif kind == "transport":
            state, reason = "FULL", "local session transport is up during handshake"
        else:
            state, reason = "UNTESTED", "no support detector"
        out[signal_id] = {"state": state, "reason": reason}
    return out


def _try(elm, command: str, timeout: float) -> str:
    try:
        return elm.request(command, timeout=timeout)
    except (AdapterTimeout, TransportError) as exc:
        return f"TIMEOUT {exc.__class__.__name__}"


def _is_failure(text: str | None) -> bool:
    if text is None:
        return True
    upper = text.strip().upper()
    if not upper:
        return True
    if upper in {"?", "NO DATA", "UNABLE TO CONNECT", "STOPPED", "CAN ERROR"}:
        return True
    if upper.startswith("TIMEOUT"):
        return True
    return False


def _clean_name(text: str | None) -> str | None:
    if _is_failure(text):
        return None
    first = text.strip().splitlines()[0].strip()
    return first or None


def _first_useful(*values: str | None) -> str | None:
    for value in values:
        cleaned = _clean_name(value)
        if cleaned and cleaned.upper() != "OK":
            return cleaned
    return None


def _fingerprint(protocol: dict, mode01: dict, identity: dict) -> str:
    material = "|".join(
        [
            protocol.get("number") or "",
            protocol.get("name") or "",
            ",".join(mode01.get("supported_pids") or []),
            ",".join(item["header"] for item in mode01.get("ecus") or []),
            identity.get("vendor_hint") or "",
        ]
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:16]


def _vehicle_id(vin_block: dict, fingerprint: str) -> str:
    if vin_block.get("status") == "READ" and vin_block.get("value"):
        return "VIN-" + vin_block["value"]
    return "UNIDENTIFIED-" + fingerprint


def new_ids() -> tuple[str, str]:
    return uuid.uuid4().hex, uuid.uuid4().hex
