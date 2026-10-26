"""Sensor trust. AI cannot override a state. Untrusted inputs suppress dependents."""

from __future__ import annotations

import bisect
from dataclasses import dataclass, field

from vicore.stats import sample_mean, sample_variance

MIN_SAMPLES = 20
RESET_HOLD_S = 60.0

VIRTUAL_SENSORS = {
    "map_baro_residual": ["map", "phone_baro"],
    "throttle_tracking_error": ["throttle_abs", "throttle_cmd"],
    "fuel_trim_residual": ["stft_b1", "ltft_b1"],
}
VIRTUAL_SENSORS_SIGNALS = tuple(dict.fromkeys(sid for required in VIRTUAL_SENSORS.values() for sid in required))


def virtual_status(states: dict[str, str]) -> dict:
    out = {}
    for name, required in VIRTUAL_SENSORS.items():
        untrusted = [sid for sid in required if states.get(sid) == "UNTRUSTED"]
        if untrusted:
            out[name] = {"status": "SUPPRESSED", "reason": "INPUT_UNTRUSTED", "because": untrusted}
            continue
        if any(states.get(sid, "INSUFFICIENT_EVIDENCE") == "INSUFFICIENT_EVIDENCE" for sid in required):
            out[name] = {
                "status": "INSUFFICIENT_EVIDENCE",
                "reason": "a required signal has insufficient evidence",
            }
            continue
        out[name] = {"status": "ARMED", "reason": "required signals are not untrusted"}
    return out


@dataclass
class TrustSample:
    mono: float
    value: float | None
    quality: str
    state_name: str | None


@dataclass
class TrustRecord:
    signal_id: str
    state: str
    anchor_result: str
    reason: str
    stability: dict = field(default_factory=dict)
    resolution: dict = field(default_factory=dict)
    acquisition_quality: dict = field(default_factory=dict)
    independent_witnesses: list = field(default_factory=list)
    recent_reset: bool = False
    conflicts: list = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "signal_id": self.signal_id,
            "state": self.state,
            "anchor_result": self.anchor_result,
            "reason": self.reason,
            "stability": self.stability,
            "resolution": self.resolution,
            "acquisition_quality": self.acquisition_quality,
            "independent_witnesses": list(self.independent_witnesses),
            "recent_reset": self.recent_reset,
            "conflicts": list(self.conflicts),
        }


class TrustLedger:
    def __init__(self, registry: dict):
        self.registry = registry
        self.samples: dict[str, list[TrustSample]] = {}
        self.records: dict[str, TrustRecord] = {}
        self.epoch_id: str | None = None
        self.epoch_reason = "initial_connection"
        self.epoch_started_mono: float | None = None

    def override(self, *args, **kwargs):
        raise PermissionError("trust state cannot be overridden")

    def on_epoch(self, epoch: dict, now_mono: float) -> None:
        self.epoch_id = epoch["epoch_id"]
        self.epoch_reason = epoch.get("reason_started") or "initial_connection"
        self.epoch_started_mono = now_mono
        self.samples.clear()
        # Prior evidence does not carry into the new epoch.
        for signal_id, record in list(self.records.items()):
            self.records[signal_id] = TrustRecord(
                signal_id=signal_id,
                state="INSUFFICIENT_EVIDENCE",
                anchor_result="INSUFFICIENT_EVIDENCE",
                reason="new baseline epoch; previous samples were discarded",
                recent_reset=self.epoch_reason != "initial_connection",
            )

    def seed(self, signal_ids: list[str]) -> None:
        for signal_id in signal_ids:
            self.samples.setdefault(signal_id, [])
            self.records.setdefault(
                signal_id,
                TrustRecord(
                    signal_id=signal_id,
                    state="INSUFFICIENT_EVIDENCE",
                    anchor_result="INSUFFICIENT_EVIDENCE",
                    reason="no samples yet",
                    recent_reset=self.epoch_reason != "initial_connection",
                ),
            )

    def state_of(self, signal_id: str) -> str:
        record = self.records.get(signal_id)
        if record is None:
            return "INSUFFICIENT_EVIDENCE"
        return record.state

    def update(self, obs, state_name: str | None) -> TrustRecord | None:
        bucket = self.samples.setdefault(obs.signal_id, [])
        bucket.append(
            TrustSample(obs.response_mono, obs.decoded_value, obs.quality, state_name)
        )
        if obs.signal_id not in self.registry:
            return None
        record = self._assess(obs.signal_id, obs.response_mono)
        previous = self.records.get(obs.signal_id)
        self.records[obs.signal_id] = record
        if previous is None or _material_change(previous, record):
            return record
        return None

    def virtual_sensors(self) -> dict:
        return virtual_status({signal_id: self.state_of(signal_id) for signal_id in VIRTUAL_SENSORS_SIGNALS})

    def _assess(self, signal_id: str, now_mono: float) -> TrustRecord:
        signal = self.registry[signal_id]
        rows = self.samples.get(signal_id, [])
        ok = [row for row in rows if row.quality == "OK" and row.value is not None]
        drop = None
        if rows:
            drop = 100.0 * (len(rows) - len(ok)) / len(rows)
        values = [row.value for row in ok]
        variance = sample_variance(values) if len(values) >= 2 else None
        resolution = _resolution(values)
        stability = {
            "n": len(ok),
            "sample_variance": variance,
            "min": min(values) if values else None,
            "max": max(values) if values else None,
        }
        acquisition = {
            "ok": len(ok),
            "other": len(rows) - len(ok),
            "drop_percentage": drop,
        }
        recent = self._recent_reset(now_mono)
        record = TrustRecord(
            signal_id=signal_id,
            state="INSUFFICIENT_EVIDENCE",
            anchor_result="INSUFFICIENT_EVIDENCE",
            reason=f"{len(ok)} ok samples",
            stability=stability,
            resolution=resolution,
            acquisition_quality=acquisition,
            recent_reset=recent,
        )
        if len(ok) < MIN_SAMPLES:
            self._apply_known_anchors(record, signal_id)
            return self._cap_reset(record, recent)
        encoding = signal.get("range") or {}
        if encoding and any(value < encoding["min"] or value > encoding["max"] for value in values):
            record.state = "UNTRUSTED"
            record.anchor_result = "FAIL"
            record.reason = "INPUT_UNTRUSTED decoded value outside encoding range"
            return self._cap_reset(record, recent)
        if signal_id == "ect" and all(value <= -39 for value in values[-MIN_SAMPLES:]):
            running = [row for row in ok if row.state_name in {
                "COLD_IDLE", "WARM_IDLE", "ACCELERATION", "STEADY_CRUISE", "DECELERATION", "DFCO", "ENGINE_START"
            }]
            if len(running) >= MIN_SAMPLES:
                record.state = "QUESTIONABLE"
                record.anchor_result = "FAIL"
                record.reason = "ECT at open-circuit sentinel while RPM indicates the engine is running"
                record.conflicts.append({"with": "rpm", "kind": "sentinel"})
                return self._cap_reset(record, recent)
        record.state = "QUESTIONABLE"
        record.anchor_result = "INSUFFICIENT_EVIDENCE"
        record.reason = "in range with samples but no independent witness"
        self._apply_known_anchors(record, signal_id)
        return self._cap_reset(record, recent)

    def _apply_known_anchors(self, record: TrustRecord, signal_id: str) -> None:
        if signal_id in ("control_module_voltage", "adapter_voltage"):
            self._voltage_anchor(record)
        if signal_id == "map":
            self._map_anchor(record)
        if signal_id == "maf":
            self._maf_conflict(record)

    def _voltage_anchor(self, record: TrustRecord) -> None:
        pairs = _paired_deltas(self.samples.get("control_module_voltage", []), self.samples.get("adapter_voltage", []))
        if len(pairs) < MIN_SAMPLES:
            return
        abs_delta = [abs(value) for value in pairs]
        median = sorted(abs_delta)[len(abs_delta) // 2]
        record.independent_witnesses.append("adapter_voltage" if record.signal_id == "control_module_voltage" else "control_module_voltage")
        if median <= 0.7:
            if record.state != "UNTRUSTED":
                record.state = "VALIDATED"
                record.anchor_result = "PASS"
                record.reason = "control-module voltage and adapter voltage agree within 0.7 V"
            return
        if median > 1.5:
            record.state = "QUESTIONABLE"
            record.anchor_result = "FAIL"
            record.reason = "voltage sources conflict by more than 1.5 V; neither is chosen"
            record.conflicts.append({"with": "voltage_pair", "median_abs_delta": median})

    def _map_anchor(self, record: TrustRecord) -> None:
        # ECU baro is not an independent witness. Only phone_baro can anchor MAP.
        map_rows = [
            row for row in self.samples.get("map", [])
            if row.quality == "OK" and row.state_name in ("KEY_ON", "WARM_RESTART")
        ]
        phone_rows = self.samples.get("phone_baro", [])
        pairs = _paired_deltas(map_rows, phone_rows)
        if len(pairs) < MIN_SAMPLES:
            return
        abs_delta = [abs(value) for value in pairs]
        mean_abs = sample_mean(abs_delta)
        record.independent_witnesses.append("phone_baro")
        if mean_abs is None:
            return
        if mean_abs <= 4.0:
            record.state = "VALIDATED"
            record.anchor_result = "PASS"
            record.reason = "MAP agrees with the phone barometer at key-on"
            return
        if mean_abs >= 8.0:
            record.state = "UNTRUSTED"
            record.anchor_result = "FAIL"
            record.reason = "INPUT_UNTRUSTED MAP failed the independent barometer anchor"
            record.conflicts.append({"with": "phone_baro", "mean_abs_delta_kpa": mean_abs})
            return
        record.state = "QUESTIONABLE"
        record.anchor_result = "INSUFFICIENT_EVIDENCE"
        record.reason = "MAP versus phone barometer delta is between the pass and fail thresholds"

    def _maf_conflict(self, record: TrustRecord) -> None:
        maf_rows = [row for row in self.samples.get("maf", []) if row.quality == "OK" and row.value is not None]
        rpm_rows = [row for row in self.samples.get("rpm", []) if row.quality == "OK" and row.value is not None]
        if len(maf_rows) < MIN_SAMPLES:
            return
        conflicts = 0
        checked = 0
        for row in maf_rows:
            if row.state_name in ("DFCO", "DECELERATION", "KEY_ON", "CRANKING", "OFF", "SHUTDOWN"):
                continue
            rpm = _nearest(rpm_rows, row.mono, 1.0)
            if rpm is None:
                continue
            checked += 1
            if row.value < 0.5 and rpm.value > 1500:
                conflicts += 1
        if checked >= MIN_SAMPLES and conflicts >= MIN_SAMPLES:
            record.state = "QUESTIONABLE"
            record.anchor_result = "FAIL"
            record.conflicts.append({"with": "rpm", "kind": "maf_near_zero_while_running"})
            record.reason = "MAF stays near zero while RPM shows the engine running"

    def _recent_reset(self, now_mono: float) -> bool:
        if self.epoch_reason == "initial_connection":
            return False
        if self.epoch_started_mono is None:
            return True
        return (now_mono - self.epoch_started_mono) < RESET_HOLD_S

    def _cap_reset(self, record: TrustRecord, recent: bool) -> TrustRecord:
        record.recent_reset = recent
        if recent and record.state != "UNTRUSTED":
            # A failed anchor still stands. Ordinary promotion waits.
            if record.anchor_result != "FAIL":
                record.state = "INSUFFICIENT_EVIDENCE"
                record.reason = "recent reset or relearn; samples do not yet leave the new epoch"
        return record


def _resolution(values: list[float]) -> dict:
    unique = sorted(set(round(value, 6) for value in values))
    step = None
    if len(unique) >= 2:
        step = min(b - a for a, b in zip(unique, unique[1:]) if b > a)
    return {"unique_values": len(unique), "step": step}


def _material_change(previous: TrustRecord, record: TrustRecord) -> bool:
    return (
        previous.state != record.state
        or previous.anchor_result != record.anchor_result
        or previous.reason != record.reason
        or previous.conflicts != record.conflicts
        or previous.independent_witnesses != record.independent_witnesses
        or previous.recent_reset != record.recent_reset
    )


def _ok_rows(rows: list[TrustSample]) -> list[TrustSample]:
    return [row for row in rows if row.quality == "OK" and row.value is not None]


def _nearest(rows: list[TrustSample], mono: float, window: float) -> TrustSample | None:
    usable = _ok_rows(rows)
    if not usable:
        return None
    monos = [row.mono for row in usable]
    index = bisect.bisect_left(monos, mono)
    best = None
    best_dt = window
    for candidate in (index - 1, index):
        if 0 <= candidate < len(usable):
            other = usable[candidate]
            dt = abs(other.mono - mono)
            if dt <= best_dt:
                best = other
                best_dt = dt
    return best


def _paired_deltas(left: list[TrustSample], right: list[TrustSample]) -> list[float]:
    usable = _ok_rows(right)
    if not usable:
        return []
    monos = [row.mono for row in usable]
    deltas = []
    for row in left:
        if row.quality != "OK" or row.value is None:
            continue
        index = bisect.bisect_left(monos, row.mono)
        best = None
        best_dt = 1.0
        for candidate in (index - 1, index):
            if 0 <= candidate < len(usable):
                other = usable[candidate]
                dt = abs(other.mono - row.mono)
                if dt <= best_dt:
                    best = other
                    best_dt = dt
        if best is not None and best.value is not None:
            deltas.append(row.value - best.value)
    return deltas
