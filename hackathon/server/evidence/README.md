# Muse Detective live evidence (Oct 26, 2026)

Saved by `scripts/live_detective_demo.py` on the Dell: real `muse-spark-1.3` calls through
the Meta Model API (Chat Completions, json_schema output, reasoning_effort=low).
Each file has the request, the full `/api/v1/live/live` response, the Evidence Ledger,
and the detective receipt (model, latency, token usage, prompt hash, cited ledger ids).
VINs are masked; no key, owner info or location is in these files or was sent to Muse.

| Scenario | Rule level | Detective | Unverified claims | Est. cost |
|---|---|---|---|---|
| usedcar (demo, codes recently cleared + permanent P0171) | DRIVE_SHORT_DISTANCE_ONLY | agreed | 0 | $0.0108 |
| checkengine (demo, P0171 + P0302) | INSPECT_SOON | agreed | 0 | $0.0089 |
| cleared_clean (synthetic: no codes, wiped 6 km ago) | DRIVE_SHORT_DISTANCE_ONLY | agreed | 0 | $0.0099 |

Live calls today: 4 (one probe of usedcar, then these 3). Estimated total: about $0.041 at $1.25/M input, $4.25/M output.
