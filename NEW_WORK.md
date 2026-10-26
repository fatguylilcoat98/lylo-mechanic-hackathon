# NEW_WORK.md: what is new for the Meta Global AI Developer Hackathon

Building period: Oct 26 – Nov 4, 2026 (Chris's build opened Oct 26, 9:00 AM PT).

The tag `baseline-pre-hackathon` (commit 867eece, made Oct 26, 2026 at 6:15 AM PDT) holds all code written before the hackathon. Everything after that tag was built during the hackathon.

## How to verify
```bash
git diff --stat baseline-pre-hackathon..HEAD                      # all changes since baseline
git diff --name-status baseline-pre-hackathon..HEAD -- hackathon/   # new hackathon code
git diff --name-status baseline-pre-hackathon..HEAD -- baseline/    # modified baseline files (should match the table below)
scripts/new-work-report.sh                                         # summary
scripts/check-baseline-integrity.sh                                # fails if a baseline change is unlogged
```

Layout:
- `baseline/` holds the pre-existing code. It is read-only by convention, and every change to it must be logged below.
- `hackathon/` holds all new code: `server/`, `dashboard/` and `mobile-bridge/`.
- `docs/HACKATHON_LOG.md` is the dated build log.

## Pre-existing (before Oct 26, 9 AM PT), not judged
All of these live under `baseline/` at tag `baseline-pre-hackathon`, commit 867eece.
- The mobile offline diagnosis engine (`baseline/mobile/src/engine/`, `src/data/dtcCodes.js`).
- The BLE / classic OBD transport for OBDLink CX/MX+ (`baseline/mobile/src/services/obd/`).
- The Flask 12-layer diagnostic pipeline (`baseline/backend/api/orchestrator.py` and its layers).
- The 6-level safety classifier (`baseline/backend/safety/safety_classifier.py`).
- The used-car check (`baseline/mobile/src/engine/usedCarCheck.js`, `baseline/backend/truth_detector.py`).
- The quote and truth modules (`baseline/backend/quote_auditor.py`, `veracore/`, `truth_detector.py`, `failure_predictor.py`, `event_blackbox.py`).
- The vehicle-intelligence recorder `vicore` (`baseline/vehicle-intelligence/`).
- The web frontend templates (`baseline/frontend/`), demo scenarios, personas, billing, auth and CLASPION/handshake.

## Built during the hackathon
| Date/time (PT) | Commit | Files | What |
|---|---|---|---|
| 2026-10-26 06:15 | a9c55a5 | NEW_WORK.md, docs/HACKATHON_LOG.md, scripts/*, hackathon/*/README.md, hackathon/.env.example, .gitignore | Repo setup and separation tooling (no feature code) |
| 2026-10-26 09:07 | bbc4a88 | hackathon/mobile-bridge/src/scanToLive.js | Android scan converter: exact backend PID names (fix 1), codes-cleared derived from PIDs 30/31/4E and orphan permanent codes, with evidence listed (fix 2), permanent codes sent as their own status (fix 3), VIN plus user-entered model/odometer (fix 4) |
| 2026-10-26 09:07 | bbc4a88 | hackathon/mobile-bridge/src/uploadClient.js | Upload call to /api/v1/live/live with a 20 s client timeout (fix 5, client side) and fallback to the existing on-phone engine on no server, error, timeout, 4xx/5xx or a reply with no safety level |
| 2026-10-26 09:07 | bbc4a88 | hackathon/server/lylo_hack/validation.py | Input validation: 400/415 with plain errors instead of 500s; unknown PID names and wrong units rejected so a misnamed reading can't silently lower safety (fix 6) |
| 2026-10-26 09:07 | bbc4a88 | hackathon/server/lylo_hack/live.py | Live adapter over the baseline pipeline: passes vin/trim/engine_type/transmission/drive_type/model/odometer (fix 4), maps `permanent` to active with a note (fix 3), stubs the onrender Layer-12 handshake call without failing open (fix 5) |
| 2026-10-26 09:07 | bbc4a88 | hackathon/server/lylo_hack/app.py, baseline_path.py, __init__.py | Hackathon Flask app (POST /api/v1/live/live, GET /healthz); 4xx stay 4xx; pipeline errors are 500 without leaking exception text; doesn't load baseline app.py, billing or auth |
| 2026-10-26 09:07 | bbc4a88 | hackathon/server/tests/test_live.py, hackathon/mobile-bridge/test/*.test.js | 12 Python + 14 Node tests, including the wrong-PID-name safety-downgrade guard (JS names checked against the Python PID_RANGES; server rejects `coolant_temp`, while `ENGINE_COOLANT_TEMP` 260 °F gives EMERGENCY_STOP_IMMEDIATELY), end-to-end JS converter to server on both demo scans, malformed-input matrix, no external call, determinism |
| 2026-10-26 09:07 | bbc4a88 | hackathon/server/README.md, requirements.txt, hackathon/mobile-bridge/README.md, package.json | Docs and run instructions |

## Modified baseline files
Every file under `baseline/` changed after the tag must have a row here. The full path must appear in this section, or `scripts/check-baseline-integrity.sh` fails.

| Date/time (PT) | Commit | File | Reason |
|---|---|---|---|
