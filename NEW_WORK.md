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

## Modified baseline files
Every file under `baseline/` changed after the tag must have a row here. The full path must appear in this section, or `scripts/check-baseline-integrity.sh` fails.

| Date/time (PT) | Commit | File | Reason |
|---|---|---|---|
