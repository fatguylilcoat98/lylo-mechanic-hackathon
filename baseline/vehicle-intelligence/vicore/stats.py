"""Acquisition statistics. The sustained rate is a low percentile, not a peak."""

from __future__ import annotations

import math


def sample_variance(values: list[float]) -> float | None:
    n = len(values)
    if n < 2:
        return None
    mean = sum(values) / n
    return sum((value - mean) ** 2 for value in values) / (n - 1)


def sample_mean(values: list[float]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)


def percentile(values: list[float], p: float) -> float:
    if not values:
        raise ValueError("percentile of empty sample")
    if p < 0 or p > 100:
        raise ValueError("percentile out of range")
    xs = sorted(values)
    if len(xs) == 1:
        return xs[0]
    k = (len(xs) - 1) * (p / 100.0)
    lo = math.floor(k)
    hi = math.ceil(k)
    if lo == hi:
        return xs[int(k)]
    return xs[lo] * (hi - k) + xs[hi] * (k - lo)


def bucket_rates(times: list[float], bucket_s: float = 1.0) -> list[float]:
    """Per-bucket delivery rates. The trailing partial bucket is dropped."""
    if bucket_s <= 0:
        raise ValueError("bucket must be positive")
    if len(times) < 2:
        return []
    ordered = sorted(times)
    start = ordered[0]
    duration = ordered[-1] - start
    n_buckets = int(duration // bucket_s)
    if n_buckets < 1:
        return []
    counts = [0] * n_buckets
    for t in ordered:
        index = int((t - start) // bucket_s)
        if 0 <= index < n_buckets:
            counts[index] += 1
    return [c / bucket_s for c in counts]


def inter_arrivals(times: list[float]) -> list[float]:
    ordered = sorted(times)
    return [b - a for a, b in zip(ordered, ordered[1:]) if b >= a]


def summarize_acquisition(
    *,
    request_times: list[float],
    success_times: list[float],
    latencies: list[float],
    requests_sent: int,
    successful_responses: int,
    negative_responses: int,
    timeouts: int,
    duration_s: float,
) -> dict:
    """Rate stats for one poll tier.

    sustained_hz is the 5th percentile of 1-second bucket rates.
    If more than 10% of requests were dropped, that fraction scales it down.
    """
    rates = bucket_rates(success_times, 1.0)
    gaps = inter_arrivals(success_times)
    out = {
        "requests_sent": requests_sent,
        "successful_responses": successful_responses,
        "negative_responses": negative_responses,
        "timeouts": timeouts,
        "duration_s": duration_s,
        "median_rate_hz": None,
        "p5_rate_hz": None,
        "p95_rate_hz": None,
        "median_latency_s": None,
        "p95_latency_s": None,
        "jitter_s": None,
        "longest_gap_s": None,
        "drop_percentage": None,
        "sustained_hz": None,
        "status": "INSUFFICIENT_EVIDENCE",
        "reason": "fewer than two successful samples or under one full second",
    }
    if requests_sent > 0:
        dropped = requests_sent - successful_responses
        out["drop_percentage"] = 100.0 * dropped / requests_sent
    if gaps:
        out["longest_gap_s"] = max(gaps)
        out["jitter_s"] = percentile(gaps, 95) - percentile(gaps, 5)
    if latencies:
        out["median_latency_s"] = percentile(latencies, 50)
        out["p95_latency_s"] = percentile(latencies, 95)
    if len(rates) >= 1 and successful_responses >= 2 and duration_s >= 1.0:
        out["median_rate_hz"] = percentile(rates, 50)
        out["p5_rate_hz"] = percentile(rates, 5)
        out["p95_rate_hz"] = percentile(rates, 95)
        sustained = out["p5_rate_hz"]
        drop = out["drop_percentage"] or 0.0
        if drop > 10.0:
            sustained = sustained * (1.0 - drop / 100.0)
        out["sustained_hz"] = sustained
        out["status"] = "COMPLETE"
        out["reason"] = "p5 bucket rate; drop above 10 percent scales it down"
    return out


SUSTAINED_RATE_DEFINITION = (
    "p5 of 1-second successful-delivery buckets on a tier, "
    "multiplied by (1 - drop) when drop percentage exceeds 10. "
    "Not the peak and not the p95."
)
