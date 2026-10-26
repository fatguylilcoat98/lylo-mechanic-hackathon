"""Time formatting. UTC timestamps with microseconds."""

from __future__ import annotations

from datetime import datetime, timezone


def iso_from_epoch(seconds: float) -> str:
    dt = datetime.fromtimestamp(seconds, timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def sample_window(request_iso: str, response_iso: str) -> dict:
    """The ECU sample instant is inside this window. It is not a midpoint."""
    return {
        "start": request_iso,
        "end": response_iso,
        "method": "request_response_bounds",
    }
