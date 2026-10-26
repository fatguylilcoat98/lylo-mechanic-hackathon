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

## Photo + voice (Oct 26, 10:15–10:25 AM PT)
Saved by `scripts/live_vision_voice_demo.py` on the Dell (in-process app, real Meta calls). The inputs are synthetic: `assets/synthetic_dash_cel_oil.jpg` is an AI-generated generic dashboard with no people or plates, and `assets/synthetic_question.wav` is an espeak-ng robot voice.

| File | Calls | Result | Est. cost |
|---|---|---|---|
| vision_usedcar_dash.json | vision + detective (muse-spark-1.3) | 3 high-confidence photo items. Photo floor DO_NOT_DRIVE; the detective also raised DRIVE_SHORT to DO_NOT_DRIVE citing photo:* items, and noted the sensor coolant reading contradicts the gauge. 0 unverified | $0.0157 |
| voice_usedcar_question_run1_stale_rule_level.json | transcribe + answer | Found the stale rule:safety bug: the answer said "short distance" while the final level was EMERGENCY_STOP (Muse raised it citing the photo). Fixed in a639e8c | $0.0085 |
| voice_usedcar_question.json | transcribe + answer (after fix) | "Do not drive this car home…", verified, matches DO_NOT_DRIVE, 0 unverified | $0.0095 |
