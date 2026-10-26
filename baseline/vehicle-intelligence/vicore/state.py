"""Vehicle state and transitions. Missing evidence does not become a guessed state."""

from __future__ import annotations

from dataclasses import dataclass, field

RUNNING = {
    "ENGINE_START",
    "COLD_IDLE",
    "WARM_IDLE",
    "ACCELERATION",
    "STEADY_CRUISE",
    "DECELERATION",
    "DFCO",
}

# These are absence of a classification, not a new state. A sample with one
# of these reasons must not cancel a pending state: speed often arrives after
# rpm in the same frame, and the accel span then dips under the minimum.
HOLD_REASONS = {
    "ect missing; refusing cold-idle versus warm-idle",
    "no state rule matched",
    "rpm missing or stale",
}

DEFAULT_DWELL = {
    "OFF": 1.0,
    "KEY_ON": 0.5,
    "CRANKING": 0.2,
    "ENGINE_START": 0.2,
    "COLD_IDLE": 1.0,
    "WARM_IDLE": 1.0,
    "ACCELERATION": 1.0,
    "STEADY_CRUISE": 1.0,
    "DECELERATION": 1.0,
    "DFCO": 0.5,
    "SHUTDOWN": 0.5,
    "WARM_RESTART": 0.5,
    "INSUFFICIENT_EVIDENCE": 0.5,
}


@dataclass
class StateConfig:
    rpm_off: float = 50.0
    rpm_crank_max: float = 450.0
    rpm_run_min: float = 500.0
    speed_stop: float = 3.0
    cruise_min_kph: float = 35.0
    accel_min_mps2: float = 0.8
    cruise_max_abs_mps2: float = 0.4
    ect_cold_max: float = 60.0
    ect_warm_min: float = 80.0
    cold_idle_rpm_max: float = 1600.0
    warm_idle_rpm_max: float = 1200.0
    throttle_rel_closed: float = 3.0
    engine_start_s: float = 3.0
    fresh_s: float = 1.5
    ect_fresh_s: float = 5.0
    rate_window_s: float = 1.2
    rate_min_span_s: float = 0.8
    dwell: dict = field(default_factory=lambda: dict(DEFAULT_DWELL))


@dataclass
class Candidate:
    name: str
    confidence: float
    signals: list[str]
    reason: str


class StateDetector:
    def __init__(self, config: StateConfig | None = None):
        self.config = config or StateConfig()
        self.values: dict[str, tuple[float, float]] = {}
        self.speed_hist: list[tuple[float, float]] = []
        self.committed: str | None = None
        self.pending: str | None = None
        self.pending_since: float | None = None
        self.pending_since_iso: str | None = None
        self.pending_candidate: Candidate | None = None
        self.running_since: float | None = None
        self.periods: list[dict] = []
        self.transitions: list[dict] = []
        self.current: dict | None = None
        self.last_mono: float | None = None
        self.last_iso: str | None = None
        self.hold_reason: str | None = None

    def update(self, obs) -> list[dict]:
        self.last_mono = obs.response_mono
        self.last_iso = obs.response_timestamp
        if obs.quality == "OK" and obs.decoded_value is not None:
            self.values[obs.signal_id] = (obs.response_mono, obs.decoded_value)
            if obs.signal_id == "vehicle_speed":
                self.speed_hist.append((obs.response_mono, obs.decoded_value))
                self.speed_hist = [
                    item for item in self.speed_hist if obs.response_mono - item[0] <= 5.0
                ]
        self._note_running(obs.response_mono)
        candidate = self._infer(obs.response_mono)
        if self.committed is None:
            self._commit(candidate, obs.response_mono, obs.response_timestamp, obs.response_mono, obs.response_timestamp)
            return []
        if (
            candidate.name == "INSUFFICIENT_EVIDENCE"
            and candidate.reason in HOLD_REASONS
            and not self._rpm_missing(obs.response_mono)
        ):
            self.hold_reason = candidate.reason
            return []
        if candidate.name == self.committed:
            self.pending = None
            self.pending_since = None
            self.hold_reason = None
            return []
        if self.pending != candidate.name:
            self.pending = candidate.name
            self.pending_since = obs.response_mono
            self.pending_since_iso = obs.response_timestamp
            self.pending_candidate = candidate
            return []
        dwell = self.config.dwell.get(candidate.name, 1.0)
        if obs.response_mono - (self.pending_since or obs.response_mono) >= dwell:
            transition = self._commit(
                candidate,
                self.pending_since or obs.response_mono,
                self.pending_since_iso or obs.response_timestamp,
                obs.response_mono,
                obs.response_timestamp,
            )
            return [transition] if transition else []
        return []

    def close(self) -> None:
        if self.current and self.last_mono is not None:
            self.current["end_mono"] = self.last_mono
            self.current["end_iso"] = self.last_iso

    def _note_running(self, now: float) -> None:
        rpm = self._fresh("rpm", now, self.config.fresh_s)
        if rpm is None:
            return
        if rpm >= self.config.rpm_run_min and self.committed in {
            "KEY_ON", "CRANKING", "WARM_RESTART", "OFF", "ENGINE_START"
        }:
            if self.running_since is None:
                self.running_since = now
        if rpm < self.config.rpm_off:
            self.running_since = None

    def _rpm_missing(self, now: float) -> bool:
        age = self._age("rpm", now)
        return age is None or age > 3.0

    def _infer(self, now: float) -> Candidate:
        link = self._fresh("adapter_link", now, 2.0)
        if link is not None and link < 0.5:
            return Candidate("OFF", 0.8, ["adapter_link"], "adapter link down")
        rpm = self._fresh("rpm", now, self.config.fresh_s)
        if rpm is None:
            return Candidate("INSUFFICIENT_EVIDENCE", 0.0, [], "rpm missing or stale")
        speed = self._fresh("vehicle_speed", now, self.config.fresh_s)
        ect = self._fresh("ect", now, self.config.ect_fresh_s)
        fuel = self._fresh("fuel_system_status", now, self.config.fresh_s)
        used = ["rpm"]
        if speed is not None:
            used.append("vehicle_speed")
        if ect is not None:
            used.append("ect")

        if rpm < self.config.rpm_off:
            return self._engine_off(ect, speed, now, used)

        if self.config.rpm_off <= rpm < self.config.rpm_crank_max and (speed is None or speed < self.config.speed_stop):
            return Candidate("CRANKING", 0.75, used, "rpm in crank band and vehicle stopped")

        if rpm >= self.config.rpm_run_min:
            start = self._maybe_engine_start(speed, now, used)
            if start is not None:
                return start

        closed = self._throttle_closed(now)
        accel = self._accel(now)
        bit2 = fuel is not None and (int(fuel) & 4) == 4
        if bit2:
            used.append("fuel_system_status")
        if closed is True:
            used.append("throttle_rel")

        if (
            bit2
            and closed is True
            and speed is not None
            and speed > 15
            and accel is not None
            and accel < -0.5
            and rpm >= self.config.rpm_run_min
        ):
            return Candidate("DFCO", 0.8, used, "fuel-status bit 2, throttle closed, decelerating")

        if accel is not None and speed is not None and accel > self.config.accel_min_mps2 and rpm >= self.config.rpm_run_min:
            return Candidate("ACCELERATION", 0.75, used, "speed rising")
        if accel is not None and speed is not None and accel < -self.config.accel_min_mps2 and rpm >= self.config.rpm_run_min:
            return Candidate("DECELERATION", 0.75, used, "speed falling")
        if (
            speed is not None
            and speed >= self.config.cruise_min_kph
            and accel is not None
            and abs(accel) <= self.config.cruise_max_abs_mps2
            and rpm >= self.config.rpm_run_min
        ):
            return Candidate("STEADY_CRUISE", 0.7, used, "speed steady above cruise threshold")
        if (speed is None or speed < self.config.speed_stop) and rpm >= self.config.rpm_run_min:
            if ect is None:
                return Candidate(
                    "INSUFFICIENT_EVIDENCE",
                    0.0,
                    used,
                    "ect missing; refusing cold-idle versus warm-idle",
                )
            if ect < self.config.ect_cold_max and rpm <= self.config.cold_idle_rpm_max:
                return Candidate("COLD_IDLE", 0.8, used, "stopped, running, coolant below cold threshold")
            if ect >= self.config.ect_warm_min and rpm <= self.config.warm_idle_rpm_max:
                return Candidate("WARM_IDLE", 0.85, used, "stopped, running, coolant at warm threshold")
            if ect >= self.config.ect_warm_min and rpm > self.config.warm_idle_rpm_max:
                return Candidate(
                    "INSUFFICIENT_EVIDENCE",
                    0.3,
                    used,
                    "stationary rpm above warm-idle band",
                )
            if self.config.ect_cold_max <= ect < self.config.ect_warm_min:
                return Candidate(
                    "INSUFFICIENT_EVIDENCE",
                    0.2,
                    used,
                    "ect between cold and warm thresholds",
                )
            return Candidate("INSUFFICIENT_EVIDENCE", 0.2, used, "stopped running condition did not match an idle band")
        return Candidate("INSUFFICIENT_EVIDENCE", 0.0, used, "no state rule matched")

    def _engine_off(self, ect, speed, now, used) -> Candidate:
        volt = self._fresh("control_module_voltage", now, self.config.fresh_s)
        if volt is None:
            volt = self._fresh("adapter_voltage", now, self.config.fresh_s)
            if volt is not None:
                used.append("adapter_voltage")
        elif volt is not None:
            used.append("control_module_voltage")
        if self.committed in RUNNING:
            return Candidate("SHUTDOWN", 0.7, used, "rpm fell below the off threshold after running")
        if ect is not None and ect >= self.config.ect_warm_min and self.committed in {
            None, "OFF", "SHUTDOWN", "KEY_ON", "WARM_RESTART"
        }:
            return Candidate("WARM_RESTART", 0.75, used, "key on with warm coolant after a stop")
        if volt is not None and volt < 6:
            return Candidate("OFF", 0.7, used, "rpm stopped and voltage collapsed")
        return Candidate("KEY_ON", 0.8, used, "ECU responding and engine not rotating")

    def _maybe_engine_start(self, speed, now, used) -> Candidate | None:
        if self.committed not in {"KEY_ON", "CRANKING", "WARM_RESTART", "OFF", "ENGINE_START"}:
            return None
        if self.running_since is None:
            return None
        if speed is not None and speed >= self.config.speed_stop:
            return None
        if now - self.running_since < self.config.engine_start_s:
            return Candidate("ENGINE_START", 0.7, used, "rpm rose out of crank and idle is not yet classified")
        return None

    def _throttle_closed(self, now) -> bool | None:
        rel = self._fresh("throttle_rel", now, self.config.fresh_s)
        if rel is None:
            return None
        return rel <= self.config.throttle_rel_closed

    def _accel(self, now) -> float | None:
        pts = [item for item in self.speed_hist if now - item[0] <= self.config.rate_window_s]
        if len(pts) < 2:
            return None
        span = pts[-1][0] - pts[0][0]
        if span < self.config.rate_min_span_s:
            return None
        dv_kph = pts[-1][1] - pts[0][1]
        return (dv_kph / 3.6) / span

    def _fresh(self, signal_id: str, now: float, max_age: float) -> float | None:
        item = self.values.get(signal_id)
        if item is None:
            return None
        mono, value = item
        if now - mono > max_age:
            return None
        return value

    def _age(self, signal_id: str, now: float) -> float | None:
        item = self.values.get(signal_id)
        if item is None:
            return None
        return now - item[0]

    def _commit(self, candidate: Candidate, start_mono: float, start_iso: str, end_mono: float, end_iso: str):
        previous = self.committed
        if self.current is not None:
            self.current["end_mono"] = end_mono
            self.current["end_iso"] = end_iso
            self.periods.append(self.current)
        self.current = {
            "state": candidate.name,
            "start_mono": end_mono,
            "start_iso": end_iso,
            "end_mono": None,
            "end_iso": None,
            "confidence": candidate.confidence,
            "signals": list(candidate.signals),
            "reason": candidate.reason,
        }
        self.committed = candidate.name
        self.pending = None
        self.pending_since = None
        self.hold_reason = None
        if candidate.name not in RUNNING and candidate.name != "ENGINE_START":
            self.running_since = None
        if previous is None:
            return None
        transition = {
            "state_from": previous,
            "state_to": candidate.name,
            "start_mono": start_mono,
            "start_iso": start_iso,
            "end_mono": end_mono,
            "end_iso": end_iso,
            "confidence": candidate.confidence,
            "signals": list(candidate.signals),
            "reason": candidate.reason,
        }
        self.transitions.append(transition)
        return transition
