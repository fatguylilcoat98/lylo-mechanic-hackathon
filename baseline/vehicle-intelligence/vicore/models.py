"""Shared records. Raw bytes stay on the observation."""

from __future__ import annotations

from dataclasses import dataclass, field


FEATURE_STATES = ("FULL", "REDUCED", "UNSUPPORTED", "UNTESTED")
TRUST_STATES = ("VALIDATED", "QUESTIONABLE", "UNTRUSTED", "INSUFFICIENT_EVIDENCE")
VEHICLE_STATES = (
    "OFF",
    "KEY_ON",
    "CRANKING",
    "ENGINE_START",
    "COLD_IDLE",
    "WARM_IDLE",
    "ACCELERATION",
    "STEADY_CRUISE",
    "DECELERATION",
    "DFCO",
    "SHUTDOWN",
    "WARM_RESTART",
    "INSUFFICIENT_EVIDENCE",
)
QUALITIES = (
    "OK",
    "NEGATIVE_RESPONSE",
    "TIMEOUT",
    "NO_DATA",
    "DECODE_ERROR",
    "TRANSPORT_LOST",
    "AMBIGUOUS_ECU",
)
FAIL_CLOSED = (
    "INSUFFICIENT_EVIDENCE",
    "UNSUPPORTED",
    "INSUFFICIENT_ACQUISITION_RATE",
    "INPUT_UNTRUSTED",
    "ORDER_INDETERMINATE",
)
EPOCH_REASONS = (
    "initial_connection",
    "code_clear",
    "battery_disconnect",
    "ecu_reset",
    "software_update",
    "throttle_relearn",
    "sensor_replacement",
    "major_repair",
    "major_modification",
    "unknown_discontinuity",
)


@dataclass
class Observation:
    vehicle_id: str
    session_id: str
    signal_id: str
    request_timestamp: str
    response_timestamp: str
    request_mono: float
    response_mono: float
    raw_value: str
    decoded_value: float | None
    unit: str | None
    quality: str
    protocol: str
    ecu: str | None
    sequence_number: int
    decoded_text: str | None = None

    def window(self) -> dict:
        return {
            "start": self.request_timestamp,
            "end": self.response_timestamp,
            "method": "request_response_bounds",
        }


@dataclass
class FeatureCapability:
    feature_id: str
    state: str
    reason: str
    required_signals: list[str] = field(default_factory=list)
    missing_signals: list[str] = field(default_factory=list)
    minimum_rate_hz: float | None = None
    measured_rate_hz: float | None = None
    label: str = ""

    def allows_run(self) -> bool:
        return self.state in ("FULL", "REDUCED")

    def as_dict(self) -> dict:
        return {
            "feature_id": self.feature_id,
            "state": self.state,
            "reason": self.reason,
            "required_signals": list(self.required_signals),
            "missing_signals": list(self.missing_signals),
            "minimum_rate_hz": self.minimum_rate_hz,
            "measured_rate_hz": self.measured_rate_hz,
            "label": self.label,
        }


class IncompatibleEpochError(RuntimeError):
    pass


class FeatureBlocked(RuntimeError):
    def __init__(self, feature_id: str, reason: str):
        super().__init__(f"{feature_id} blocked: {reason}")
        self.feature_id = feature_id
        self.reason = reason
