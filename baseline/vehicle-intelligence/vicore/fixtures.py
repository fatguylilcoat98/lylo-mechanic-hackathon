"""Synthetic sessions. Raw bytes are encoded with the registry formulas."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from vicore import ANALYSIS_VERSION
from vicore.benchmark import apply_benchmark, benchmark_from_observations
from vicore.formula import decode, encode
from vicore.models import Observation
from vicore.phone import _untested
from vicore.pipeline import (
    analyze_observations,
    ensure_adapter,
    ensure_session,
    ensure_vehicle,
    persist_new_observations,
    save_profile,
)
from vicore.registry import load_registry
from vicore.timeutil import iso_from_epoch

WALL0 = datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp()
REGISTRY = load_registry()
FIXTURE_DIR = Path(__file__).resolve().parent.parent / "fixtures"

PHONE_UNTESTED = _untested("no phone sensor transport connected", device=None)
PHONE_BARO = {
    "device": "fixture-phone",
    "hardware_tested": False,
    "sensors": {
        "accelerometer": {"state": "UNTESTED", "reason": "not supplied by this fixture"},
        "gyroscope": {"state": "UNTESTED", "reason": "not supplied by this fixture"},
        "barometer": {"state": "FULL", "reason": "fixture supplied phone_baro observations"},
        "gnss": {"state": "UNTESTED", "reason": "not supplied by this fixture"},
    },
}


def _header(name, vehicle_id, description, unsupported, phone=None) -> dict:
    return {
        "fixture": name,
        "vehicle_id": vehicle_id,
        "description": description,
        "protocol_name": "ISO 15765-4 (CAN 11/500)",
        "protocol_number": "6",
        "adapter_identity": "FIXTURE",
        "firmware": "fixture-1",
        "unsupported": unsupported,
        "phone": phone or PHONE_UNTESTED,
    }


COMMON_UNSUPPORTED = [
    "stft_b2",
    "ltft_b2",
    "timing_advance",
    "ambient_air_temp",
    "accelerator_pedal_d",
    "engine_oil_temp",
    "phone_baro",
]


def _pack(signal_id: str, value: float) -> str:
    signal = REGISTRY[signal_id]
    raw = encode(signal["formula"], value)
    if signal["formula"]["op"] in ("atrv", "decimal_text"):
        return raw.decode("ascii")
    return raw.hex().upper()


def _sweep(start: float, stop: float, step: float, fn) -> list[dict]:
    rows = []
    t = start
    while t <= stop + 1e-9:
        t_round = round(t, 3)
        for signal_id, value in fn(t_round).items():
            ecu = "ADAPTER" if signal_id in ("adapter_voltage", "adapter_link", "phone_baro") else "7E8"
            rows.append(
                {
                    "signal_id": signal_id,
                    "t": t_round,
                    "raw": _pack(signal_id, value),
                    "quality": "OK",
                    "ecu": ecu,
                }
            )
        t += step
    return rows


def _base(**overrides) -> dict:
    values = {
        "rpm": 0,
        "vehicle_speed": 0,
        "ect": 90,
        "iat": 30,
        "map": 40,
        "baro": 100,
        "maf": 3.0,
        "stft_b1": 0,
        "ltft_b1": 0,
        "throttle_abs": 16,
        "throttle_rel": 2,
        "throttle_cmd": 16,
        "control_module_voltage": 14.1,
        "adapter_voltage": 14.2,
        "engine_load": 20,
        "fuel_system_status": 2,
        "runtime_since_start": 30,
        "adapter_link": 1,
    }
    values.update(overrides)
    return values


def build_normal_start():
    def fn(t):
        if t < 5:
            return _base(
                rpm=0, ect=22, iat=18, map=100 if int(t * 5) % 2 == 0 else 101,
                baro=100, maf=0, throttle_abs=15, throttle_rel=0, throttle_cmd=15,
                control_module_voltage=12.4, adapter_voltage=12.5, engine_load=0,
                fuel_system_status=1, runtime_since_start=0, vehicle_speed=0,
            )
        if t < 7:
            return _base(
                rpm=210, ect=22, iat=18, map=98, baro=100, maf=0,
                throttle_abs=15, throttle_rel=0, throttle_cmd=15,
                control_module_voltage=10.1, adapter_voltage=10.0, engine_load=0,
                fuel_system_status=1, runtime_since_start=0,
            )
        if t < 10:
            return _base(
                rpm=1100, ect=24, iat=18, map=45, maf=5, throttle_abs=18, throttle_rel=3,
                throttle_cmd=18, control_module_voltage=14.0, adapter_voltage=14.1,
                engine_load=25, fuel_system_status=1, runtime_since_start=int(t - 7),
            )
        return _base(
            rpm=950, ect=30, iat=18, map=40, maf=4, throttle_abs=16, throttle_rel=2,
            throttle_cmd=16, control_module_voltage=14.2, adapter_voltage=14.2,
            engine_load=22, fuel_system_status=1, runtime_since_start=int(t - 7),
        )
    header = _header(
        "normal_start",
        "FIXTURE-NORMAL-START",
        "Key-on, crank, cold idle.",
        COMMON_UNSUPPORTED,
    )
    return header, _sweep(0, 30, 0.2, fn)


def build_weak_voltage_start():
    def fn(t):
        if t < 4:
            volt_cm, volt_ad, rpm = 11.8, 11.9, 0
            runtime = 0
        elif t < 6.5:
            volt_cm, volt_ad, rpm = 9.0, 9.1, 160
            runtime = 0
        else:
            volt_cm, volt_ad, rpm = 13.8, 13.9, 900
            runtime = int(t - 6.5)
        return _base(
            rpm=rpm, ect=18, map=100 if rpm == 0 else 42, maf=0 if rpm < 500 else 4,
            control_module_voltage=volt_cm, adapter_voltage=volt_ad,
            fuel_system_status=1, runtime_since_start=runtime, engine_load=0 if rpm < 500 else 20,
            throttle_rel=0 if rpm < 500 else 2,
        )
    header = _header(
        "weak_voltage_start",
        "FIXTURE-WEAK-VOLTAGE",
        "Cranking voltage sags and recovers. The sag is not a disconnect event.",
        COMMON_UNSUPPORTED,
    )
    return header, _sweep(0, 16, 0.2, fn)


def build_hot_idle():
    def fn(t):
        raised = t >= 16
        throttle = 22 if raised else 16 + (int(t * 5) % 3) * 0.5
        return _base(
            rpm=1800 if raised else 680,
            ect=91 + (int(t) % 3),
            iat=36,
            map=34 if raised else 32,
            maf=8 if raised else 3.2,
            stft_b1=0 if int(t * 5) % 2 == 0 else 6.25,
            ltft_b1=6.25,
            throttle_abs=throttle,
            throttle_rel=8 if raised else 2,
            throttle_cmd=throttle,
            engine_load=28 if raised else 18,
            runtime_since_start=400 + int(t),
        )
    header = _header(
        "hot_idle",
        "FIXTURE-HOT-IDLE",
        "Warm idle, then stationary raised rpm. No diagnosis.",
        COMMON_UNSUPPORTED,
    )
    return header, _sweep(0, 24, 0.2, fn)


def build_dfco():
    def fn(t):
        if t < 12:
            speed, rpm, fuel, rel, map_v, load = 80, 2100, 2, 18, 55, 45
        else:
            speed = max(20, round(80 - 5 * (t - 12)))
            rpm, fuel, rel, map_v, load = 1700, 4, 0, 22, 12
        return _base(
            rpm=rpm, vehicle_speed=speed, ect=92, map=map_v, maf=3 if fuel == 4 else 15,
            throttle_abs=15 if rel == 0 else 30, throttle_rel=rel, throttle_cmd=15 if rel == 0 else 30,
            engine_load=load, fuel_system_status=fuel, stft_b1=-6.25 if fuel == 4 else 3.125,
            ltft_b1=4, runtime_since_start=800 + int(t),
        )
    header = _header(
        "dfco",
        "FIXTURE-DFCO",
        "Steady cruise then fuel-status bit 2 with a closed throttle.",
        COMMON_UNSUPPORTED,
    )
    return header, _sweep(0, 22, 0.2, fn)


def build_rpm_stumble():
    def fn(t):
        rpm = 1100 if 130 <= t < 131 else 2000
        return _base(
            rpm=rpm, vehicle_speed=60, ect=92, map=50, maf=14,
            throttle_abs=28, throttle_rel=12, throttle_cmd=28,
            engine_load=40, runtime_since_start=1000 + int(t),
        )
    header = _header(
        "rpm_stumble",
        "FIXTURE-RPM-STUMBLE",
        "Cruise with one large RPM drop that recovers.",
        COMMON_UNSUPPORTED,
    )
    return header, _sweep(0, 180, 0.5, fn)


def _stumble_pair(voltage_at: float, rpm_at: float):
    def fn(t):
        volt = 11.5 if t >= voltage_at else 14.0
        rpm = 1100 if t >= rpm_at else 2000
        return _base(
            rpm=rpm, vehicle_speed=70, ect=93, map=48, maf=12,
            control_module_voltage=volt, adapter_voltage=volt,
            throttle_abs=26, throttle_rel=10, throttle_cmd=26,
            engine_load=38, runtime_since_start=1200 + int(t),
        )
    return fn


def build_voltage_first_stumble():
    header = _header(
        "voltage_first_stumble",
        "FIXTURE-VOLTAGE-FIRST",
        "Voltage drops, then RPM drops. Order is outside timestamp overlap.",
        COMMON_UNSUPPORTED,
    )
    return header, _sweep(0, 70, 0.2, _stumble_pair(20.0, 20.4))


def build_rpm_first_voltage_drop():
    header = _header(
        "rpm_first_voltage_drop",
        "FIXTURE-RPM-FIRST",
        "RPM drops, then voltage drops. Order is outside timestamp overlap.",
        COMMON_UNSUPPORTED,
    )
    return header, _sweep(0, 70, 0.2, _stumble_pair(20.4, 20.0))


def build_sensor_anchor_failure():
    def fn(t):
        values = _base(
            rpm=0, ect=21, iat=21, map=100, baro=100, maf=0,
            throttle_abs=15, throttle_rel=0, throttle_cmd=15,
            control_module_voltage=12.6, adapter_voltage=12.6,
            engine_load=0, fuel_system_status=1, runtime_since_start=0,
        )
        values["phone_baro"] = 88.0
        return values
    unsupported = [sid for sid in COMMON_UNSUPPORTED if sid != "phone_baro"]
    header = _header(
        "sensor_anchor_failure",
        "FIXTURE-ANCHOR-FAIL",
        "Key-on MAP disagrees with an independent phone barometer.",
        unsupported,
        phone=PHONE_BARO,
    )
    return header, _sweep(0, 8, 0.2, fn)


def build_low_acquisition_rate():
    def fn(t):
        return _base(rpm=700, ect=92, vehicle_speed=0, throttle_abs=16, throttle_rel=2)
    header = _header(
        "low_acquisition_rate",
        "FIXTURE-LOW-RATE",
        "Warm-idle shaped values sampled too slowly to run rate-gated features.",
        COMMON_UNSUPPORTED,
    )
    return header, _sweep(0, 24, 3.0, fn)


def build_adapter_disconnect():
    rows = _sweep(0, 7.8, 0.2, lambda t: _base(rpm=700, ect=92, throttle_abs=16, throttle_rel=2))
    t = 8.0
    while t <= 10.0 + 1e-9:
        rows.append(
            {
                "signal_id": "adapter_link",
                "t": round(t, 3),
                "raw": _pack("adapter_link", 0),
                "quality": "OK",
                "ecu": "ADAPTER",
            }
        )
        t += 0.2
    header = _header(
        "adapter_disconnect",
        "FIXTURE-ADAPTER-LOSS",
        "Hot idle, then the adapter link drops.",
        COMMON_UNSUPPORTED,
    )
    return header, rows


BUILDERS = {
    "normal_start": build_normal_start,
    "weak_voltage_start": build_weak_voltage_start,
    "hot_idle": build_hot_idle,
    "dfco": build_dfco,
    "rpm_stumble": build_rpm_stumble,
    "voltage_first_stumble": build_voltage_first_stumble,
    "rpm_first_voltage_drop": build_rpm_first_voltage_drop,
    "sensor_anchor_failure": build_sensor_anchor_failure,
    "low_acquisition_rate": build_low_acquisition_rate,
    "adapter_disconnect": build_adapter_disconnect,
}


def build_fixture(name: str) -> tuple[dict, list[dict]]:
    if name not in BUILDERS:
        raise KeyError(name)
    return BUILDERS[name]()


def write_fixtures(directory: Path | None = None) -> list[Path]:
    target = directory or FIXTURE_DIR
    target.mkdir(parents=True, exist_ok=True)
    written = []
    for name in BUILDERS:
        header, rows = build_fixture(name)
        path = target / f"{name}.jsonl"
        with path.open("w", encoding="utf-8") as handle:
            handle.write(json.dumps(header) + "\n")
            for row in rows:
                handle.write(json.dumps(row) + "\n")
        written.append(path)
    return written


def load_jsonl(path: Path) -> tuple[dict, list[dict]]:
    lines = path.read_text(encoding="utf-8").splitlines()
    header = json.loads(lines[0])
    rows = [json.loads(line) for line in lines[1:] if line.strip()]
    return header, rows


def rows_to_observations(header: dict, rows: list[dict], session_id: str) -> list[Observation]:
    observations = []
    for sequence, row in enumerate(rows, start=1):
        signal = REGISTRY[row["signal_id"]]
        request_mono = row["t"]
        response_mono = row["t"] + 0.02
        request_wall = WALL0 + request_mono
        response_wall = WALL0 + response_mono
        quality = row["quality"]
        if quality == "OK":
            if signal["formula"]["op"] in ("atrv", "decimal_text"):
                data = row["raw"].encode("ascii")
            else:
                data = bytes.fromhex(row["raw"])
            decoded = decode(signal["formula"], data)
        else:
            decoded = None
        observations.append(
            Observation(
                vehicle_id=header["vehicle_id"],
                session_id=session_id,
                signal_id=row["signal_id"],
                request_timestamp=iso_from_epoch(request_wall),
                response_timestamp=iso_from_epoch(response_wall),
                request_mono=request_mono,
                response_mono=response_mono,
                raw_value=row["raw"],
                decoded_value=decoded,
                unit=signal.get("unit"),
                quality=quality,
                protocol=header["protocol_name"],
                ecu=row.get("ecu"),
                sequence_number=sequence,
            )
        )
    return observations


def profile_from_fixture(header: dict, observations: list[Observation], session_id: str) -> dict:
    seen = {obs.signal_id for obs in observations if obs.quality == "OK"}
    unsupported = set(header.get("unsupported") or [])
    phone = header["phone"]
    support = {}
    supported_pids = []
    for signal_id, signal in REGISTRY.items():
        if signal_id in unsupported:
            state, reason = "UNSUPPORTED", "fixture declared the signal unsupported"
        elif signal_id in seen:
            state, reason = "FULL", "fixture recorded the signal"
        elif signal["support_detection"].get("type") == "phone_sensor":
            sensor = signal["support_detection"]["sensor"]
            state = (phone.get("sensors") or {}).get(sensor, {}).get("state", "UNTESTED")
            reason = (phone.get("sensors") or {}).get(sensor, {}).get("reason", "phone sensor untested")
        else:
            state, reason = "UNTESTED", "fixture did not sample or declare this signal"
        support[signal_id] = {"state": state, "reason": reason}
        if state == "FULL" and signal["support_detection"].get("type") == "mode01_bitmap":
            supported_pids.append(signal["identifier"])
    created = observations[0].request_timestamp if observations else iso_from_epoch(WALL0)
    profile = {
        "profile_version": 1,
        "hardware_tested": False,
        "vehicle_id": header["vehicle_id"],
        "session_id": session_id,
        "created_at": created,
        "analysis_version": ANALYSIS_VERSION,
        "adapter": {
            "adapter_id": "",
            "identity_raw": header.get("adapter_identity", "FIXTURE"),
            "firmware": header.get("firmware", "fixture-1"),
            "serial_number": None,
            "reported_name": "FIXTURE",
            "vendor_hint": None,
            "commands": {},
        },
        "protocol": {
            "name": header["protocol_name"],
            "number": header["protocol_number"],
            "transport": "ISO_15765_CAN_11_500",
            "state": "FULL",
            "reason": "fixture declaration",
        },
        "vin": {"value": None, "status": "UNTESTED", "raw": "", "reason": "fixture has no VIN"},
        "fingerprint": "fixture-" + header["fixture"],
        "mode01": {
            "state": "FULL",
            "supported_pids": supported_pids,
            "reason": "derived from fixture signal declarations",
            "ecus": [{"header": "7E8", "role_hint": "ecm_response_address"}],
        },
        "mode06": {
            "state": "UNTESTED",
            "reason": "fixture did not probe mode 06",
            "o2_trend_computed": False,
        },
        "mode09": {
            "state": "UNTESTED",
            "reason": "fixture did not probe mode 09",
            "supported_pids": [],
            "vin": {"value": None, "status": "UNTESTED", "raw": ""},
            "calibration_raw": None,
        },
        "ecus": [{"header": "7E8", "role_hint": "ecm_response_address"}],
        "transport": {"kind": "fixture", "path": None, "hardware_tested": False},
        "diagnostic": {
            "mode03": {"state": "UNTESTED", "reason": "fixture did not request DTCs", "claim": "NONE", "codes": []},
            "mode06": {"state": "UNTESTED", "reason": "fixture did not probe mode 06", "o2_trend_computed": False},
            "mode04_clear": {"state": "UNSUPPORTED", "reason": "vicore will not send mode 04", "claim": "NONE"},
        },
        "phone_sensors": phone,
        "signals": support,
        "acquisition_benchmark": None,
        "sustained_feature_rate_hz": None,
        "features": {},
        "transcript": [],
    }
    benchmark = benchmark_from_observations(observations, profile)
    return apply_benchmark(profile, benchmark)


def load_fixture(db, name: str, *, directory: Path | None = None, from_disk: bool = False):
    if from_disk:
        header, rows = load_jsonl((directory or FIXTURE_DIR) / f"{name}.jsonl")
    else:
        header, rows = build_fixture(name)
    session_id = uuid.uuid4().hex
    observations = rows_to_observations(header, rows, session_id)
    profile = profile_from_fixture(header, observations, session_id)
    ensure_vehicle(
        db,
        profile["vehicle_id"],
        None,
        "UNTESTED",
        profile["fingerprint"],
        profile["created_at"],
    )
    adapter_id = ensure_adapter(db, profile["adapter"], "fixture", profile["created_at"])
    ensure_session(
        db,
        profile,
        source="fixture",
        source_detail=name,
        adapter_id=adapter_id,
    )
    persist_new_observations(db, observations)
    save_profile(db, profile, "fixture_capability")
    summary = analyze_observations(db, profile, observations, manage_epochs=True)
    db.commit()
    summary["fixture"] = name
    summary["profile"] = profile
    return summary
