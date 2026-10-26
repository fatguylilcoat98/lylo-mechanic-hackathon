"""First three experiments. They measure variance. They do not diagnose."""

from __future__ import annotations

from vicore.registry import require_signal
from vicore.stats import sample_mean, sample_variance

DIAGNOSIS_MARKERS = (
    "vacuum leak",
    "carbon deposit",
    "misfire",
    "replace the sensor",
    "root cause",
)

A_MIN = 20
B_CELL_MIN = 30
B_LOAD_MIN = 20
C_MIN = 20


class ExperimentEngine:
    def __init__(self, registry: dict, gates: dict):
        for signal_id in (
            "map",
            "baro",
            "phone_baro",
            "stft_b1",
            "ltft_b1",
            "rpm",
            "ect",
            "vehicle_speed",
            "engine_load",
            "throttle_abs",
            "throttle_rel",
            "throttle_cmd",
            "iat",
            "maf",
            "control_module_voltage",
            "adapter_voltage",
        ):
            require_signal(registry, signal_id)
        self.gates = gates
        self.a_rows: list[dict] = []
        self.b_cells: dict[str, list[dict]] = {}
        self.c_slots: list[dict] = []
        self.latest: dict[str, tuple[float, float]] = {}

    def observe(self, obs, state_name: str | None, trust) -> None:
        if obs.quality != "OK" or obs.decoded_value is None:
            return
        self.latest[obs.signal_id] = (obs.response_mono, obs.decoded_value)
        if state_name in ("KEY_ON", "WARM_RESTART") and obs.signal_id in ("map", "baro", "phone_baro"):
            self.a_rows.append(_point(obs, state_name))
        if obs.signal_id in ("stft_b1", "ltft_b1"):
            for cell in classify_trim_sample(
                state_name,
                self._fresh("rpm", obs.response_mono, 1.5),
                self._fresh("vehicle_speed", obs.response_mono, 1.5),
                self._fresh("ect", obs.response_mono, 5.0),
                self._fresh("engine_load", obs.response_mono, 1.5),
            ):
                self.b_cells.setdefault(cell, []).append(_point(obs, state_name))
        if state_name == "WARM_IDLE" and obs.signal_id == "throttle_abs":
            slot = {"mono": obs.response_mono, "throttle_abs": obs.decoded_value}
            for signal_id, max_age in (
                ("rpm", 1.5),
                ("ect", 5.0),
                ("iat", 5.0),
                ("map", 1.5),
                ("maf", 1.5),
                ("throttle_rel", 1.5),
                ("throttle_cmd", 1.5),
                ("control_module_voltage", 1.5),
                ("adapter_voltage", 1.5),
            ):
                value = self._fresh(signal_id, obs.response_mono, max_age)
                if value is not None:
                    slot[signal_id] = value
            self.c_slots.append(slot)

    def _fresh(self, signal_id: str, now: float, max_age: float) -> float | None:
        item = self.latest.get(signal_id)
        if item is None:
            return None
        mono, value = item
        if now - mono > max_age:
            return None
        return value

    def finish(self, trust) -> list[dict]:
        return [
            self._finish_a(trust),
            self._finish_b(trust),
            self._finish_c(trust),
        ]

    def _blocked(self, feature_id: str) -> dict | None:
        gate = self.gates.get(feature_id)
        if gate is None:
            return _result(feature_id, "UNTESTED", "feature not in capability profile", {})
        if gate.allows_run():
            return None
        status = "INSUFFICIENT_ACQUISITION_RATE" if gate.reason == "INSUFFICIENT_ACQUISITION_RATE" else gate.state
        if gate.state == "UNSUPPORTED" and gate.reason == "INSUFFICIENT_ACQUISITION_RATE":
            status = "INSUFFICIENT_ACQUISITION_RATE"
        return _result(feature_id, status, gate.reason, {"usable_as_baseline": False})

    def _finish_a(self, trust) -> dict:
        blocked = self._blocked("experiment_a_koeo_map")
        if blocked:
            return blocked
        if trust.state_of("map") == "UNTRUSTED" and not self.a_rows:
            return _result("experiment_a_koeo_map", "INPUT_UNTRUSTED", "INPUT_UNTRUSTED", {"usable_as_baseline": False})
        grouped = _group(self.a_rows)
        map_values = grouped.get("map", [])
        if len(map_values) < A_MIN:
            return _result(
                "experiment_a_koeo_map",
                "INSUFFICIENT_EVIDENCE",
                f"need {A_MIN} key-on MAP samples, have {len(map_values)}",
                {"map": _dist(map_values), "usable_as_baseline": False, "diagnosis": None},
            )
        phone = grouped.get("phone_baro", [])
        ecu_baro = grouped.get("baro", [])
        delta = _aligned_delta(self.a_rows, "map", "phone_baro")
        if len(phone) >= A_MIN and delta["n"] >= A_MIN:
            independence = "PROVEN_PHONE_BAROMETER"
            mean_abs = delta["mean_abs"]
            if mean_abs is not None and mean_abs <= 4.0:
                agreement = "PASS"
            elif mean_abs is not None and mean_abs >= 8.0:
                agreement = "FAIL"
            else:
                agreement = "INSUFFICIENT_EVIDENCE"
        else:
            independence = "UNPROVEN"
            agreement = "NOT_APPLICABLE"
        usable = independence == "PROVEN_PHONE_BAROMETER" and agreement == "PASS"
        # The anchor measurement is complete even when agreement fails.
        # Trust, not this experiment, decides whether MAP may be used later.
        body = {
            "map": _dist(map_values),
            "ecu_baro": {**_dist(ecu_baro), "independent": False},
            "phone_baro": _dist(phone) if phone else None,
            "independence": independence,
            "delta_map_minus_phone_baro": delta if independence == "PROVEN_PHONE_BAROMETER" else None,
            "anchor_agreement": agreement,
            "usable_as_baseline": usable,
            "diagnosis": None,
            "variance_kind": "sample",
        }
        return _result(
            "experiment_a_koeo_map",
            "COMPLETE",
            "key-on MAP repeatability measured",
            body,
        )

    def _finish_b(self, trust) -> dict:
        blocked = self._blocked("experiment_b_fuel_trim")
        if blocked:
            return blocked
        if trust.state_of("stft_b1") == "UNTRUSTED" or trust.state_of("ltft_b1") == "UNTRUSTED":
            return _result(
                "experiment_b_fuel_trim",
                "INPUT_UNTRUSTED",
                "INPUT_UNTRUSTED",
                {"usable_as_baseline": False, "diagnosis": None},
            )
        summary = {name: _trim_summary(rows) for name, rows in self.b_cells.items()}
        hot = summary.get("hot_idle", {}).get("n_stft", 0)
        cruise = summary.get("steady_cruise", {}).get("n_stft", 0)
        load_bins = [
            name for name in ("load_low", "load_mid", "load_high")
            if summary.get(name, {}).get("n_stft", 0) >= B_LOAD_MIN
        ]
        covered = hot >= B_CELL_MIN and cruise >= B_CELL_MIN and len(load_bins) >= 2
        status = "COMPLETE" if covered else "INSUFFICIENT_EVIDENCE"
        reason = "trim surface coverage met" if covered else "trim surface coverage not met"
        return _result(
            "experiment_b_fuel_trim",
            status,
            reason,
            {"cells": summary, "usable_as_baseline": covered, "diagnosis": None, "variance_kind": "sample"},
        )

    def _finish_c(self, trust) -> dict:
        blocked = self._blocked("experiment_c_hot_idle_throttle")
        if blocked:
            return blocked
        if trust.state_of("throttle_abs") == "UNTRUSTED" or trust.state_of("ect") == "UNTRUSTED":
            return _result(
                "experiment_c_hot_idle_throttle",
                "INPUT_UNTRUSTED",
                "INPUT_UNTRUSTED",
                {"usable_as_baseline": False, "diagnosis": None},
            )
        samples = self.c_slots
        ect_values = [slot["ect"] for slot in samples if "ect" in slot and "throttle_abs" in slot]
        if len(ect_values) < C_MIN:
            return _result(
                "experiment_c_hot_idle_throttle",
                "INSUFFICIENT_EVIDENCE",
                f"need {C_MIN} warm-idle throttle samples, have {len(ect_values)}",
                {
                    "accessory_state": _unsupported_accessory(),
                    "usable_as_baseline": False,
                    "diagnosis": None,
                },
            )
        ect_mid = _median(ect_values)
        iat_values = [slot["iat"] for slot in samples if "iat" in slot]
        volt_values = [
            slot.get("control_module_voltage", slot.get("adapter_voltage"))
            for slot in samples
            if "control_module_voltage" in slot or "adapter_voltage" in slot
        ]
        volt_values = [value for value in volt_values if value is not None]
        iat_mid = _median(iat_values) if iat_values else None
        volt_mid = _median(volt_values) if volt_values else None
        matched = []
        for slot in samples:
            if "throttle_abs" not in slot or "ect" not in slot:
                continue
            if abs(slot["ect"] - ect_mid) > 3.0:
                continue
            if iat_mid is not None and "iat" in slot and abs(slot["iat"] - iat_mid) > 5.0:
                continue
            voltage = slot.get("control_module_voltage", slot.get("adapter_voltage"))
            if volt_mid is not None and voltage is not None and abs(voltage - volt_mid) > 0.4:
                continue
            matched.append(slot)
        if len(matched) < C_MIN:
            return _result(
                "experiment_c_hot_idle_throttle",
                "INSUFFICIENT_EVIDENCE",
                f"need {C_MIN} matched hot-idle samples, have {len(matched)}",
                {
                    "n_warm_idle": len(samples),
                    "accessory_state": _unsupported_accessory(),
                    "usable_as_baseline": False,
                    "diagnosis": None,
                },
            )
        body = {
            "n_matched": len(matched),
            "match": {"ect_median": ect_mid, "iat_median": iat_mid, "voltage_median": volt_mid},
            "rpm": _dist([slot["rpm"] for slot in matched if "rpm" in slot]),
            "throttle_abs": _dist([slot["throttle_abs"] for slot in matched]),
            "throttle_rel": _dist([slot["throttle_rel"] for slot in matched if "throttle_rel" in slot]),
            "throttle_cmd": _dist([slot["throttle_cmd"] for slot in matched if "throttle_cmd" in slot]),
            "ect": _dist([slot["ect"] for slot in matched]),
            "iat": _dist([slot["iat"] for slot in matched if "iat" in slot]),
            "map": _dist([slot["map"] for slot in matched if "map" in slot]),
            "maf": _dist([slot["maf"] for slot in matched if "maf" in slot]),
            "voltage": _dist([
                slot.get("control_module_voltage", slot.get("adapter_voltage"))
                for slot in matched
                if "control_module_voltage" in slot or "adapter_voltage" in slot
            ]),
            "accessory_state": _unsupported_accessory(),
            "usable_as_baseline": True,
            "diagnosis": None,
            "variance_kind": "sample",
        }
        return _result(
            "experiment_c_hot_idle_throttle",
            "COMPLETE",
            "hot-idle throttle repeatability measured",
            body,
        )


def _point(obs, state_name: str | None) -> dict:
    return {
        "signal_id": obs.signal_id,
        "value": obs.decoded_value,
        "mono": obs.response_mono,
        "state": state_name,
        "rpm_hint": None,
    }


def _group(rows: list[dict]) -> dict[str, list[float]]:
    out: dict[str, list[float]] = {}
    for row in rows:
        out.setdefault(row["signal_id"], []).append(row["value"])
    return out


def _dist(values: list[float]) -> dict:
    clean = [value for value in values if value is not None]
    return {
        "n": len(clean),
        "mean": sample_mean(clean),
        "sample_variance": sample_variance(clean),
        "min": min(clean) if clean else None,
        "max": max(clean) if clean else None,
    }


def _aligned_delta(rows: list[dict], left: str, right: str) -> dict:
    by_time: dict[float, dict] = {}
    for row in rows:
        by_time.setdefault(row["mono"], {})[row["signal_id"]] = row["value"]
    deltas = []
    for slot in by_time.values():
        if left in slot and right in slot:
            deltas.append(slot[left] - slot[right])
    abs_deltas = [abs(value) for value in deltas]
    return {
        "n": len(deltas),
        "mean": sample_mean(deltas),
        "mean_abs": sample_mean(abs_deltas),
        "sample_variance": sample_variance(deltas),
    }


def _trim_cell(row: dict) -> str | None:
    state = row["state"]
    if state == "WARM_IDLE":
        return "hot_idle"
    if state == "STEADY_CRUISE":
        return "steady_cruise"
    return None


def _load_cell(row: dict) -> str | None:
    # Load bins are filled from engine_load samples. The trim values at that
    # same timestamp are gathered in _trim_summary by time, so the load sample
    # only marks the timestamp. Handled below by rewriting: we tag trims using
    # sibling rows. See _trim_summary.
    return None


def _trim_summary(rows: list[dict]) -> dict:
    stft = [row["value"] for row in rows if row["signal_id"] == "stft_b1"]
    ltft = [row["value"] for row in rows if row["signal_id"] == "ltft_b1"]
    return {
        "n_stft": len(stft),
        "n_ltft": len(ltft),
        "stft": _dist(stft),
        "ltft": _dist(ltft),
    }


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def _unsupported_accessory() -> dict:
    return {
        "status": "UNSUPPORTED",
        "reason": "no universal SAE J1979 accessory-state PID in the registry",
    }


def _result(experiment_id: str, status: str, reason: str, body: dict) -> dict:
    text = str(body).lower() + " " + reason.lower()
    for marker in DIAGNOSIS_MARKERS:
        if marker in text:
            raise RuntimeError(f"experiment emitted a diagnosis marker: {marker}")
    body = dict(body)
    body["diagnosis"] = None
    return {
        "experiment_id": experiment_id,
        "status": status,
        "reason": reason,
        "result": body,
    }


def classify_trim_sample(state_name: str | None, rpm: float | None, speed: float | None, ect: float | None, load: float | None) -> list[str]:
    """Operating cells for one timestamp. Used by the engine when the full snapshot is known."""
    cells = []
    if state_name == "WARM_IDLE":
        cells.append("hot_idle")
    if (
        state_name not in ("CRANKING", "KEY_ON", "OFF", "SHUTDOWN", "WARM_RESTART")
        and rpm is not None
        and rpm >= 1500
        and speed is not None
        and speed < 3
        and ect is not None
        and ect >= 80
    ):
        cells.append("stationary_raised_rpm")
    if state_name == "STEADY_CRUISE":
        cells.append("steady_cruise")
    if load is not None:
        if load < 30:
            cells.append("load_low")
        elif load <= 60:
            cells.append("load_mid")
        else:
            cells.append("load_high")
    return cells
