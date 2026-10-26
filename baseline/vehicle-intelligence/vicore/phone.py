"""Phone sensor probe. Absence of a transport is UNTESTED, not a vehicle fact."""

from __future__ import annotations

import json
import os
from pathlib import Path

SENSORS = ("accelerometer", "gyroscope", "barometer", "gnss")


def probe_phone_sensors(path: str | None = None) -> dict:
    """Read an optional bridge file. This host has no phone attached by default.

    VICORE_PHONE_SENSORS may point at a JSON object:
    {"device": "pixel", "accelerometer": true, "barometer": false, ...}
    """
    source = path or os.environ.get("VICORE_PHONE_SENSORS")
    if not source:
        return _untested("no phone sensor transport connected", device=None)
    file_path = Path(source)
    if not file_path.is_file():
        return _untested(f"phone sensor file missing: {source}", device=None)
    try:
        payload = json.loads(file_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return _untested("phone sensor file is not JSON", device=None)
    device = payload.get("device")
    sensors = {}
    for name in SENSORS:
        if name not in payload:
            sensors[name] = {"state": "UNTESTED", "reason": "bridge did not report this sensor"}
            continue
        present = bool(payload[name])
        if present:
            sensors[name] = {"state": "FULL", "reason": "phone bridge reported the sensor present"}
        else:
            sensors[name] = {
                "state": "UNSUPPORTED",
                "reason": "phone bridge reported the sensor absent",
            }
    return {"device": device, "sensors": sensors, "hardware_tested": False}


def _untested(reason: str, device) -> dict:
    return {
        "device": device,
        "hardware_tested": False,
        "sensors": {name: {"state": "UNTESTED", "reason": reason} for name in SENSORS},
    }


def phone_signal_state(phone: dict, sensor: str) -> str:
    return ((phone.get("sensors") or {}).get(sensor) or {}).get("state", "UNTESTED")
