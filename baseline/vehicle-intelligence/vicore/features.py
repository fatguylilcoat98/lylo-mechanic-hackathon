"""Feature gates. Every consumer asks the capability profile before it runs."""

from __future__ import annotations

from vicore.models import FeatureCapability

# minimum_rate_hz is the rate the feature requires of each signal it polls.
# throttle_hysteresis is declared so a slow bus fails closed instead of
# inventing a hysteresis number. This build does not compute hysteresis.

FEATURE_SPECS = {
    "state_detector": {
        "label": "Vehicle state",
        "minimum_rate_hz": 2.0,
        "required_signals": ["rpm"],
        "optional_signals": [
            "vehicle_speed",
            "ect",
            "throttle_rel",
            "throttle_abs",
            "fuel_system_status",
            "map",
            "control_module_voltage",
            "adapter_voltage",
        ],
        "reduced_if_missing_optional": ["fuel_system_status", "ect", "vehicle_speed"],
    },
    "event_buffer": {
        "label": "It just did it buffer",
        "minimum_rate_hz": 1.0,
        "required_signals": [],
        "optional_signals": [
            "rpm",
            "control_module_voltage",
            "adapter_voltage",
            "throttle_abs",
            "throttle_cmd",
            "vehicle_speed",
            "adapter_link",
        ],
        "reduced_if_missing_optional": [
            "rpm",
            "control_module_voltage",
            "adapter_voltage",
            "throttle_cmd",
            "vehicle_speed",
        ],
    },
    "experiment_a_koeo_map": {
        "label": "KOEO MAP / barometer anchor",
        "minimum_rate_hz": 1.0,
        "required_signals": ["map"],
        "optional_signals": ["baro", "phone_baro"],
        "reduced_if_missing_optional": [],
    },
    "experiment_b_fuel_trim": {
        "label": "Fuel trim operating map",
        "minimum_rate_hz": 2.0,
        "required_signals": ["stft_b1", "ltft_b1", "rpm", "ect"],
        "optional_signals": ["engine_load", "vehicle_speed", "stft_b2", "ltft_b2"],
        "reduced_if_missing_optional": ["engine_load", "vehicle_speed"],
    },
    "experiment_c_hot_idle_throttle": {
        "label": "Hot-idle throttle requirement",
        "minimum_rate_hz": 2.0,
        "required_signals": ["rpm", "ect", "throttle_abs"],
        "optional_signals": [
            "throttle_rel",
            "throttle_cmd",
            "iat",
            "map",
            "maf",
            "control_module_voltage",
            "adapter_voltage",
        ],
        "reduced_if_missing_optional": [],
    },
    "throttle_hysteresis": {
        "label": "Throttle hysteresis",
        "minimum_rate_hz": 20.0,
        "required_signals": ["throttle_abs"],
        "optional_signals": ["throttle_rel", "throttle_cmd"],
        "reduced_if_missing_optional": [],
    },
}


def query_feature(profile: dict, feature_id: str) -> FeatureCapability:
    features = profile.get("features") or {}
    raw = features.get(feature_id)
    if raw is None:
        return FeatureCapability(
            feature_id=feature_id,
            state="UNTESTED",
            reason="feature not in capability profile",
            label=feature_id,
        )
    return FeatureCapability(
        feature_id=raw["feature_id"],
        state=raw["state"],
        reason=raw["reason"],
        required_signals=list(raw.get("required_signals") or []),
        missing_signals=list(raw.get("missing_signals") or []),
        minimum_rate_hz=raw.get("minimum_rate_hz"),
        measured_rate_hz=raw.get("measured_rate_hz"),
        label=raw.get("label") or feature_id,
    )


def signal_support_state(support: dict, signal_id: str) -> str:
    entry = support.get(signal_id)
    if entry is None:
        return "UNTESTED"
    if isinstance(entry, str):
        return entry
    return entry.get("state", "UNTESTED")


def evaluate_features(support: dict, benchmark: dict | None) -> dict[str, dict]:
    """support maps signal_id -> FULL | REDUCED | UNSUPPORTED | UNTESTED."""
    out = {}
    for feature_id, spec in FEATURE_SPECS.items():
        out[feature_id] = _evaluate_one(feature_id, spec, support, benchmark).as_dict()
    return out


def _evaluate_one(feature_id: str, spec: dict, support: dict, benchmark: dict | None) -> FeatureCapability:
    required = list(spec["required_signals"])
    states = {sid: signal_support_state(support, sid) for sid in required}
    missing = [sid for sid, state in states.items() if state == "UNSUPPORTED"]
    untested = [sid for sid, state in states.items() if state == "UNTESTED"]
    base = FeatureCapability(
        feature_id=feature_id,
        state="UNTESTED",
        reason="acquisition benchmark not run",
        required_signals=required,
        missing_signals=missing,
        minimum_rate_hz=spec["minimum_rate_hz"],
        measured_rate_hz=None,
        label=spec["label"],
    )
    if untested:
        base.state = "UNTESTED"
        base.reason = "support untested: " + ", ".join(untested)
        return base
    if missing:
        base.state = "UNSUPPORTED"
        base.reason = "UNSUPPORTED signal: " + ", ".join(missing)
        return base
    if benchmark is None:
        return base
    n = max(1, len(required)) if required else 1
    if feature_id == "event_buffer":
        n = 1
    measured = sustained_for_count(benchmark, n)
    base.measured_rate_hz = measured
    if measured is None:
        base.state = "UNTESTED"
        base.reason = "no benchmark tier covers this feature"
        return base
    minimum = spec["minimum_rate_hz"]
    if minimum > 0 and measured < minimum:
        base.state = "UNSUPPORTED"
        base.reason = "INSUFFICIENT_ACQUISITION_RATE"
        return base
    optional_missing = [
        sid
        for sid in spec.get("reduced_if_missing_optional") or []
        if signal_support_state(support, sid) != "FULL"
    ]
    # Voltage discontinuity can use either voltage source.
    if feature_id == "event_buffer":
        volt_ok = signal_support_state(support, "control_module_voltage") == "FULL" or (
            signal_support_state(support, "adapter_voltage") == "FULL"
        )
        if volt_ok:
            optional_missing = [
                sid
                for sid in optional_missing
                if sid not in ("control_module_voltage", "adapter_voltage")
            ]
    if optional_missing:
        base.state = "REDUCED"
        base.missing_signals = optional_missing
        base.reason = "REDUCED missing optional: " + ", ".join(optional_missing)
        return base
    base.state = "FULL"
    base.reason = "requirements met"
    base.missing_signals = []
    return base


def sustained_for_count(benchmark: dict, n_signals: int) -> float | None:
    """Use the smallest measured tier that polled at least n_signals.

    A 1-signal peak is not reused as an 8-signal rate.
    """
    tiers = benchmark.get("tiers") or []
    candidates = []
    for tier in tiers:
        if tier.get("status") != "COMPLETE":
            continue
        if int(tier.get("n_signals") or 0) >= n_signals and tier.get("sustained_hz") is not None:
            candidates.append(tier)
    if not candidates:
        return None
    candidates.sort(key=lambda tier: int(tier["n_signals"]))
    return float(candidates[0]["sustained_hz"])


def sustained_feature_rate(benchmark: dict) -> float | None:
    """Conservative vehicle rate: p5 of the largest completed tier."""
    best = None
    for tier in benchmark.get("tiers") or []:
        if tier.get("status") != "COMPLETE" or tier.get("sustained_hz") is None:
            continue
        if best is None or int(tier["n_signals"]) > int(best["n_signals"]):
            best = tier
    if best is None:
        return None
    return float(best["sustained_hz"])
