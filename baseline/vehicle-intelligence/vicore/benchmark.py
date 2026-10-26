"""Measure the connected vehicle. Do not reuse a 1-signal peak as an N-signal rate."""

from __future__ import annotations

from collections import defaultdict

from vicore.features import evaluate_features, sustained_feature_rate
from vicore.registry import load_registry
from vicore.stats import SUSTAINED_RATE_DEFINITION, summarize_acquisition
from vicore.transport import AdapterTimeout, TransportError

PRIORITY = (
    "rpm",
    "vehicle_speed",
    "ect",
    "map",
    "maf",
    "stft_b1",
    "throttle_abs",
    "control_module_voltage",
    "iat",
    "ltft_b1",
    "engine_load",
    "throttle_rel",
    "throttle_cmd",
    "adapter_voltage",
    "fuel_system_status",
)

TIERS = (1, 2, 4, 8)


def supported_poll_signals(profile: dict) -> list[str]:
    signals = profile.get("signals") or {}
    registry = load_registry()
    chosen = []
    for signal_id in PRIORITY:
        state = (signals.get(signal_id) or {}).get("state")
        if state != "FULL":
            continue
        signal = registry.get(signal_id)
        if signal is None:
            continue
        if signal["protocol"] not in ("SAE_J1979", "STN"):
            continue
        chosen.append(signal_id)
    return chosen


def run_benchmark(elm, profile: dict, *, recorder, duration_s: float = 4.0) -> dict:
    """Sequential single-PID poll. One outstanding request. Raw observations are recorded."""
    pollable = supported_poll_signals(profile)
    registry = load_registry()
    tiers = []
    for n in TIERS:
        if len(pollable) < n:
            tiers.append(_skipped(n, pollable, "fewer supported signals than this tier"))
            continue
        chosen = pollable[:n]
        tiers.append(
            _run_tier(
                elm,
                [registry[sid] for sid in chosen],
                recorder=recorder,
                duration_s=duration_s,
                profile=profile,
            )
        )
    benchmark = {
        "method": "sequential_single_pid",
        "duration_s_per_tier": duration_s,
        "tiers": tiers,
        "definition": SUSTAINED_RATE_DEFINITION,
    }
    return benchmark


def apply_benchmark(profile: dict, benchmark: dict) -> dict:
    updated = dict(profile)
    updated["acquisition_benchmark"] = benchmark
    updated["sustained_feature_rate_hz"] = sustained_feature_rate(benchmark)
    updated["sustained_feature_rate_definition"] = SUSTAINED_RATE_DEFINITION
    updated["features"] = evaluate_features(profile.get("signals") or {}, benchmark)
    return updated


def benchmark_from_observations(observations: list, profile: dict) -> dict:
    """Same statistics as the live benchmark, taken from recorded timestamps."""
    by_signal = defaultdict(list)
    for obs in observations:
        by_signal[obs.signal_id].append(obs)
    pollable = [sid for sid in supported_poll_signals(profile) if sid in by_signal]
    protocol = (profile.get("protocol") or {}).get("name") or ""
    adapter = (profile.get("adapter") or {}).get("identity_raw") or ""
    phone = (profile.get("phone_sensors") or {}).get("device")
    tiers = []
    for n in TIERS:
        if len(pollable) < n:
            tiers.append(_skipped(n, pollable, "fewer supported signals than this tier"))
            continue
        chosen = pollable[:n]
        rows = [obs for sid in chosen for obs in by_signal[sid]]
        tiers.append(_summarize_rows(n, chosen, rows, protocol, adapter, phone))
    return {
        "method": "from_observations",
        "duration_s_per_tier": None,
        "tiers": tiers,
        "definition": SUSTAINED_RATE_DEFINITION,
    }


def _run_tier(elm, signals: list[dict], *, recorder, duration_s: float, profile: dict) -> dict:
    started = elm.clock.mono()
    end = started + duration_s
    request_times = []
    success_times = []
    latencies = []
    requests_sent = 0
    successful = 0
    negative = 0
    timeouts = 0
    ecu_seen = set()
    while elm.clock.mono() < end:
        for signal in signals:
            if elm.clock.mono() >= end:
                break
            request_mono = elm.clock.mono()
            request_times.append(request_mono)
            requests_sent += 1
            try:
                observations = elm.read_signal(
                    signal,
                    vehicle_id=profile["vehicle_id"],
                    session_id=profile["session_id"],
                    sequence_start=recorder.next_sequence(),
                    protocol=(profile.get("protocol") or {}).get("name") or "",
                )
            except (AdapterTimeout, TransportError):
                timeouts += 1
                continue
            # read_signal already consumed one sequence number per observation via next_sequence
            # only if the caller passes the start. Recorder.next_sequence reserves one.
            # The session may return multiple frames. Fix up sequences here.
            if not observations:
                timeouts += 1
                continue
            base = observations[0].sequence_number
            # next_sequence already incremented once. Reserve the rest.
            if len(observations) > 1:
                for extra in range(len(observations) - 1):
                    reserved = recorder.next_sequence()
                    observations[extra + 1].sequence_number = reserved
            else:
                observations[0].sequence_number = base
            for obs in observations:
                recorder.persist(obs)
                if obs.ecu:
                    ecu_seen.add(obs.ecu)
            primary = _primary(observations)
            if primary is None:
                timeouts += 1
                continue
            if primary.quality == "OK":
                successful += 1
                success_times.append(primary.response_mono)
                latencies.append(primary.response_mono - primary.request_mono)
            elif primary.quality == "NEGATIVE_RESPONSE":
                negative += 1
            elif primary.quality == "TIMEOUT":
                timeouts += 1
            else:
                # NO_DATA and decode errors count as unsuccessful requests.
                pass
    duration = elm.clock.mono() - started
    stats = summarize_acquisition(
        request_times=request_times,
        success_times=success_times,
        latencies=latencies,
        requests_sent=requests_sent,
        successful_responses=successful,
        negative_responses=negative,
        timeouts=timeouts,
        duration_s=duration,
    )
    return {
        "n_signals": len(signals),
        "signal_ids": [signal["signal_id"] for signal in signals],
        "status": stats["status"],
        "reason": stats["reason"],
        **{key: stats[key] for key in stats if key not in ("status", "reason")},
        "protocol": (profile.get("protocol") or {}).get("name"),
        "ecu": ",".join(sorted(ecu_seen)) if ecu_seen else None,
        "adapter": (profile.get("adapter") or {}).get("identity_raw"),
        "phone_device": (profile.get("phone_sensors") or {}).get("device"),
    }


def _summarize_rows(n: int, signal_ids: list[str], rows: list, protocol, adapter, phone) -> dict:
    if not rows:
        return _skipped(n, signal_ids, "no observations")
    # A request is one timestamp per signal. Group by (signal, request_mono).
    requests = {}
    for obs in rows:
        key = (obs.signal_id, obs.request_mono)
        current = requests.get(key)
        if current is None or (obs.quality == "OK" and current.quality != "OK"):
            requests[key] = obs
    ordered = sorted(requests.values(), key=lambda obs: obs.request_mono)
    # Per-signal success times. Tier rate is the slowest signal's sustained rate.
    per_signal_stats = []
    for sid in signal_ids:
        subset = [obs for obs in ordered if obs.signal_id == sid]
        success = [obs.response_mono for obs in subset if obs.quality == "OK"]
        latencies = [
            obs.response_mono - obs.request_mono for obs in subset if obs.quality == "OK"
        ]
        duration = 0.0
        if subset:
            duration = subset[-1].response_mono - subset[0].request_mono
        stats = summarize_acquisition(
            request_times=[obs.request_mono for obs in subset],
            success_times=success,
            latencies=latencies,
            requests_sent=len(subset),
            successful_responses=sum(1 for obs in subset if obs.quality == "OK"),
            negative_responses=sum(1 for obs in subset if obs.quality == "NEGATIVE_RESPONSE"),
            timeouts=sum(1 for obs in subset if obs.quality == "TIMEOUT"),
            duration_s=duration,
        )
        per_signal_stats.append(stats)
    complete = [item for item in per_signal_stats if item["status"] == "COMPLETE"]
    if len(complete) != len(signal_ids):
        return {
            "n_signals": n,
            "signal_ids": signal_ids,
            "status": "INSUFFICIENT_EVIDENCE",
            "reason": "one or more signals in this tier lack a full second of samples",
            "requests_sent": sum(item["requests_sent"] for item in per_signal_stats),
            "successful_responses": sum(item["successful_responses"] for item in per_signal_stats),
            "negative_responses": sum(item["negative_responses"] for item in per_signal_stats),
            "timeouts": sum(item["timeouts"] for item in per_signal_stats),
            "duration_s": max((item["duration_s"] for item in per_signal_stats), default=0.0),
            "median_rate_hz": None,
            "p5_rate_hz": None,
            "p95_rate_hz": None,
            "median_latency_s": None,
            "p95_latency_s": None,
            "jitter_s": None,
            "longest_gap_s": None,
            "drop_percentage": None,
            "sustained_hz": None,
            "protocol": protocol,
            "ecu": None,
            "adapter": adapter,
            "phone_device": phone,
        }
    slowest = min(complete, key=lambda item: item["sustained_hz"])
    ecus = sorted({obs.ecu for obs in ordered if obs.ecu})
    return {
        "n_signals": n,
        "signal_ids": list(signal_ids),
        "status": "COMPLETE",
        "reason": slowest["reason"],
        "requests_sent": sum(item["requests_sent"] for item in complete),
        "successful_responses": sum(item["successful_responses"] for item in complete),
        "negative_responses": sum(item["negative_responses"] for item in complete),
        "timeouts": sum(item["timeouts"] for item in complete),
        "duration_s": max(item["duration_s"] for item in complete),
        "median_rate_hz": slowest["median_rate_hz"],
        "p5_rate_hz": slowest["p5_rate_hz"],
        "p95_rate_hz": slowest["p95_rate_hz"],
        "median_latency_s": slowest["median_latency_s"],
        "p95_latency_s": slowest["p95_latency_s"],
        "jitter_s": slowest["jitter_s"],
        "longest_gap_s": slowest["longest_gap_s"],
        "drop_percentage": slowest["drop_percentage"],
        "sustained_hz": slowest["sustained_hz"],
        "protocol": protocol,
        "ecu": ",".join(ecus) if ecus else None,
        "adapter": adapter,
        "phone_device": phone,
    }


def _primary(observations: list):
    ok = [obs for obs in observations if obs.quality == "OK" and obs.ecu in (None, "7E8", "18DAF110", "ADAPTER")]
    if ok:
        return ok[0]
    if observations:
        return observations[0]
    return None


def _skipped(n: int, signals: list, reason: str) -> dict:
    return {
        "n_signals": n,
        "signal_ids": list(signals)[:n] if not isinstance(signals, list) else list(signals)[:n],
        "status": "SKIPPED",
        "reason": reason,
        "requests_sent": 0,
        "successful_responses": 0,
        "negative_responses": 0,
        "timeouts": 0,
        "duration_s": 0.0,
        "median_rate_hz": None,
        "p5_rate_hz": None,
        "p95_rate_hz": None,
        "median_latency_s": None,
        "p95_latency_s": None,
        "jitter_s": None,
        "longest_gap_s": None,
        "drop_percentage": None,
        "sustained_hz": None,
        "protocol": None,
        "ecu": None,
        "adapter": None,
        "phone_device": None,
    }
