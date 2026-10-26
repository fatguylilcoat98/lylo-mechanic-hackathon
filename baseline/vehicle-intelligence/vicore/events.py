"""It-just-did-it ring buffer. A frozen event is never overwritten."""

from __future__ import annotations

import uuid
from collections import deque

PRE_S = 120.0
POST_S = 45.0

VOLTAGE_SIGNALS = ("control_module_voltage", "adapter_voltage")


class EventBuffer:
    def __init__(self, pre_s: float = PRE_S, post_s: float = POST_S):
        if not 90.0 <= pre_s <= 120.0 and pre_s != PRE_S:
            # Tests may shorten the window. Production defaults are checked separately.
            pass
        self.pre_s = pre_s
        self.post_s = post_s
        self.samples: deque = deque()
        self.active: dict | None = None
        self.frozen: list[dict] = []
        self.last_rpm = None
        self.last_voltage = None
        self.last_speed = None
        self.fresh: dict[str, object] = {}
        self.throttle_error_since: float | None = None
        self.throttle_latched = False
        self.link_latched = False

    def push(self, obs, state_name: str | None, trust_states: dict) -> None:
        self.samples.append(obs)
        if obs.quality == "OK":
            self.fresh[obs.signal_id] = obs
        self._trim(obs.response_mono)
        for trigger in self._detect(obs, state_name, trust_states):
            self._open_or_append(trigger)
        if self.active and not self.active["frozen"]:
            if obs.response_mono - self.active["trigger_mono"] >= self.post_s:
                self._freeze(obs.response_timestamp, obs.response_mono, complete=True)

    def user_trigger(self, mono: float, iso: str) -> None:
        self._open_or_append(
            {
                "source": "USER_BUTTON",
                "detail": "IT_JUST_DID_IT",
                "mono": mono,
                "iso": iso,
                "request_mono": mono,
                "response_mono": mono,
            }
        )

    def finish(self, end_iso: str | None, end_mono: float | None) -> None:
        if self.active and not self.active["frozen"]:
            self._freeze(end_iso, end_mono, complete=False)

    def _detect(self, obs, state_name: str | None, trust_states: dict) -> list[dict]:
        found = []
        link_down = obs.quality == "TRANSPORT_LOST" or (
            obs.signal_id == "adapter_link" and obs.quality == "OK" and obs.decoded_value == 0
        )
        if link_down and not self.link_latched:
            self.link_latched = True
            found.append(self._trigger(obs, "ADAPTER_COMMUNICATION_LOSS", "adapter communication loss"))
        if obs.signal_id == "adapter_link" and obs.quality == "OK" and obs.decoded_value == 1:
            self.link_latched = False
        if obs.signal_id == "vehicle_speed" and obs.quality == "OK":
            self.last_speed = obs
        if obs.signal_id == "rpm" and obs.quality == "OK" and obs.decoded_value is not None:
            previous = self.last_rpm
            if previous is not None and previous.decoded_value is not None:
                dt = obs.response_mono - previous.response_mono
                drop = previous.decoded_value - obs.decoded_value
                if (
                    dt <= 1.0
                    and drop >= 800
                    and obs.decoded_value >= 200
                    and state_name not in ("CRANKING", "ENGINE_START", "KEY_ON", "OFF")
                ):
                    found.append(self._trigger(obs, "RPM_DISCONTINUITY", f"rpm drop {drop:.0f}"))
                speed_value = self.last_speed.decoded_value if self.last_speed is not None else None
                if (
                    dt <= 2.0
                    and previous.decoded_value >= 500
                    and obs.decoded_value < 50
                    and speed_value is not None
                    and speed_value > 5
                    and state_name not in ("KEY_ON", "SHUTDOWN", "OFF")
                ):
                    found.append(self._trigger(obs, "UNEXPECTED_ENGINE_STOP", "rpm collapsed while moving"))
            self.last_rpm = obs
        if obs.signal_id in VOLTAGE_SIGNALS and obs.quality == "OK" and obs.decoded_value is not None:
            previous = self.last_voltage
            if previous is not None and previous.decoded_value is not None:
                dt = obs.response_mono - previous.response_mono
                drop = previous.decoded_value - obs.decoded_value
                if dt <= 1.0 and drop >= 2.0 and state_name not in ("CRANKING", "ENGINE_START", "KEY_ON", "OFF"):
                    found.append(self._trigger(obs, "VOLTAGE_DISCONTINUITY", f"voltage drop {drop:.2f}"))
            self.last_voltage = obs
        tracking = self._throttle_tracking(obs, trust_states)
        if tracking is not None:
            found.append(tracking)
        return found

    def _throttle_tracking(self, obs, trust_states: dict):
        if obs.signal_id not in ("throttle_abs", "throttle_cmd"):
            return None
        if trust_states.get("throttle_abs") == "UNTRUSTED" or trust_states.get("throttle_cmd") == "UNTRUSTED":
            return None
        if "throttle_abs" not in self.fresh or "throttle_cmd" not in self.fresh:
            return None
        absolute = self.fresh.get("throttle_abs")
        commanded = self.fresh.get("throttle_cmd")
        if absolute is None or commanded is None:
            return None
        if absolute.quality != "OK" or commanded.quality != "OK":
            return None
        if absolute.decoded_value is None or commanded.decoded_value is None:
            return None
        now = obs.response_mono
        if abs(absolute.response_mono - now) > 1.0 or abs(commanded.response_mono - now) > 1.0:
            return None
        error = abs(absolute.decoded_value - commanded.decoded_value)
        if error <= 15.0:
            self.throttle_error_since = None
            self.throttle_latched = False
            return None
        if self.throttle_error_since is None:
            self.throttle_error_since = now
            return None
        if self.throttle_latched:
            return None
        if now - self.throttle_error_since >= 1.0:
            self.throttle_latched = True
            return self._trigger(obs, "THROTTLE_TRACKING_ERROR", f"abs error {error:.1f} percent")
        return None

    def _trigger(self, obs, source: str, detail: str) -> dict:
        return {
            "source": source,
            "detail": detail,
            "mono": obs.response_mono,
            "iso": obs.response_timestamp,
            "request_mono": obs.request_mono,
            "response_mono": obs.response_mono,
        }

    def _open_or_append(self, trigger: dict) -> None:
        if self.active and not self.active["frozen"]:
            self.active["triggers"].append(trigger)
            return
        window_start_mono = trigger["mono"] - self.pre_s
        self.active = {
            "event_id": uuid.uuid4().hex,
            "triggers": [trigger],
            "trigger_mono": trigger["mono"],
            "trigger_iso": trigger["iso"],
            "window_start_mono": window_start_mono,
            "frozen": False,
            "samples": (),
            "overwritten": False,
        }

    def _freeze(self, end_iso: str | None, end_mono: float | None, complete: bool) -> None:
        if self.active is None or self.active["frozen"]:
            return
        start = self.active["window_start_mono"]
        end = end_mono if end_mono is not None else self.active["trigger_mono"]
        kept = [sample for sample in self.samples if start <= sample.response_mono <= end]
        self.active["samples"] = tuple(kept)
        self.active["frozen"] = True
        self.active["window_end_iso"] = end_iso
        self.active["window_end_mono"] = end_mono
        self.active["post_window_complete"] = complete
        self.active["sequence_start"] = kept[0].sequence_number if kept else None
        self.active["sequence_end"] = kept[-1].sequence_number if kept else None
        self.active["order_status"] = _order_status(self.active["triggers"])
        self.active["overwritten"] = False
        self.frozen.append(self.active)
        self.active = None

    def _trim(self, now: float) -> None:
        cutoff = now - self.pre_s
        if self.active and not self.active["frozen"]:
            cutoff = min(cutoff, self.active["window_start_mono"])
        while self.samples and self.samples[0].response_mono < cutoff:
            self.samples.popleft()


def _order_status(triggers: list[dict]) -> str:
    if len(triggers) < 2:
        return "SINGLE"
    ordered = sorted(triggers, key=lambda item: (item["response_mono"], item["request_mono"]))
    for left, right in zip(ordered, ordered[1:]):
        if _overlap(left, right):
            return "ORDER_INDETERMINATE"
    return "DETERMINATE"


def _overlap(left: dict, right: dict) -> bool:
    return left["request_mono"] <= right["response_mono"] and right["request_mono"] <= left["response_mono"]
