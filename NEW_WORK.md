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
| 2026-10-26 09:30 | 1cd4918 | hackathon/mobile-bridge/src/scanHook.js, test/scanHook.test.js | `afterScan` hook for the scan screen. Flag `EXPO_PUBLIC_LYLO_SERVER_URL`: unset/blank returns the same scan object with no network call (old on-phone behavior); set sends it to the server and attaches `scan.serverDiagnosis` (server or offline fallback). Never throws. 5 new tests (19 Node total) |
| 2026-10-26 09:32 | 11bb8a4 | hackathon/server/deploy/lylo-hack.pm2.config.js | PM2 config for the Dell: gunicorn, 2 workers, 127.0.0.1:5088 only, handshake stub on, no secrets |
| 2026-10-26 09:40 | (docs commit) | hackathon/mobile-bridge/package.json | Test script uses `test/*.test.js` (Node 22 on the Dell treated `test/` as a file and ran 0 tests) |
| 2026-10-26 09:35 | b5bb53c | hackathon/server/lylo_hack/validation.py, tests/test_live.py | Empty-scan gate: no codes and no numeric readings gives 400 with a plain reason (flag `LYLO_HACK_REQUIRE_DATA`, default on, `0` disables). New test; the 500-path test now posts a valid scan. 13 Python tests |
| 2026-10-26 09:35 | b5bb53c | hackathon/mobile-bridge/src/diagnosisView.js, ServerDiagnosisCard.js, test/diagnosisView.test.js | Results-screen card: safety level, source (LYLO server vs on-phone engine) and fallback reason. Renders nothing without `scan.serverDiagnosis`. 6 new tests (25 Node total), including every backend safety level mapped |
| 2026-10-26 10:00 | 9f7d842 | hackathon/server/tests/test_live.py | Muse-free 260 °F overheat regression guard (Muse off, and Muse on but failing) |
| 2026-10-26 10:20 | 8839252 | hackathon/mobile-bridge/src/detectiveView.js, DetectiveCard.js, ServerDiagnosisCard.js, test/detectiveView.test.js | Muse Detective card: cleared-codes red flag, ranked hypotheses with confidence, tap to show cited ledger items, UNVERIFIED labels, receipt line (model, latency, prompt hash). Renders nothing unless detective.muse_status is ok. 8 new tests (33 Node total), including the real evidence files |
| 2026-10-26 10:20 | 8839252 | hackathon/server/lylo_hack/vision.py, safety.py, app.py, muse.py, detective.py, live.py, requirements.txt (Pillow) | POST /api/v1/vision/dash (flag LYLO_HACK_VISION, default 0): 5 MB cap, EXIF/GPS stripped by re-encoding, never stored unless LYLO_HACK_VISION_DEBUG_SAVE=1; muse-spark-1.3 image input gives typed `photo:*` ledger items (source=photo, lower trust); a red oil, coolant or brake light or a hot gauge sets at least DO_NOT_DRIVE; never lowers. The live route keeps its own 256 KB cap |
| 2026-10-26 10:20 | 8839252 | hackathon/server/lylo_hack/voice.py, muse.py (transcribe_wav), app.py | POST /api/v1/voice/ask (flag LYLO_HACK_VOICE, default 0): WAV (or ffmpeg-converted) audio, transcribed by muse-voice-transcribe-1.0 and never stored, answered against the scan ledger with citations, unverified answers withheld, never lowers safety |
| 2026-10-26 10:20 | 8839252, a639e8c | hackathon/server/tests/test_vision_voice.py, scripts/live_vision_voice_demo.py, evidence/* | 20 mocked tests (48 Python total). Live demo script and evidence (synthetic dashboard image and robot-voice WAV) |
| 2026-10-26 10:25 | a639e8c | hackathon/server/lylo_hack/app.py, voice.py | The photo floor is applied before the ledger is built, so rule:safety shows the raised level to the Detective and voice; voice replies add safety_notice |
| 2026-10-26 10:30 | (docs commit) | docs/DEMO_SCRIPT.md, docs/HACKATHON_LOG.md | 3-minute demo outline; a root HACKATHON_LOG.md created by mistake in eeb51a4 was merged into docs/HACKATHON_LOG.md |

## Modified baseline files
Every file under `baseline/` changed after the tag must have a row here. The full path must appear in this section, or `scripts/check-baseline-integrity.sh` fails.

| Date/time (PT) | Commit | File | Reason |
|---|---|---|---|
| 2026-10-26 09:30 | 1cd4918 | baseline/mobile/src/screens/ScanScreen.js | 3 lines: import `afterScan` from hackathon/mobile-bridge and pass the finished scan through it before navigating. With `EXPO_PUBLIC_LYLO_SERVER_URL` unset it returns the identical object, so the app behaves exactly as before. Needed so a phone scan can reach the Dell pipeline. |
| 2026-10-26 09:30 | 1cd4918 | baseline/mobile/metro.config.js | New file: stock Expo Metro config plus `watchFolders` for hackathon/mobile-bridge, so Metro can bundle the import above. No other settings. |
| 2026-10-26 09:35 | b5bb53c | baseline/mobile/src/screens/UsedCarScreen.js | 3 lines: import `ServerDiagnosisCard` and render it under the demo banner. It returns null when the scan has no serverDiagnosis, so the screen is unchanged with the flag unset. |
| 2026-10-26 09:35 | b5bb53c | baseline/mobile/src/screens/CodesScreen.js | Same 3-line change as UsedCarScreen. |
| 2026-10-26 09:35 | b5bb53c | baseline/mobile/metro.config.js | Added `resolver.nodeModulesPaths` (the app's own node_modules) so files under hackathon/ can resolve react/react-native. |
| 2026-10-26 10:45 | v0.4.0 | baseline/mobile/src/screens/HomeScreen.js | 2 lines + 1 style: "Powered by Meta AI" under the tagline (Chris asked), build label v0.3.0 -> v0.4.0. |
| 2026-10-26 10:45 | v0.4.0 | baseline/mobile/ui-tests/screens.test.js | Build-label assertion v0.4.0 and a check for "Powered by Meta AI". |
| 2026-10-26 10:45 | v0.4.0 | baseline/mobile/app.json | version 0.4.0, android.versionCode 3 -> 4 (installs over v0.3.0; package and signing unchanged). |
| 2026-10-26 10:45 | v0.4.0 | baseline/mobile/package.json | version 0.4.0. |
| 2026-10-26 10:45 | v0.4.0 | baseline/mobile/package-lock.json | version 0.4.0 (top-level fields only). |
| 2026-10-26 11:50 | v0.4.1 | baseline/mobile/src/screens/UsedCarScreen.js | 2 lines: verdict passed through hackathon `reconcileVerdict`, so a stricter LYLO server level replaces "LOOKS GOOD" (one consistent verdict). Identity when there is no serverDiagnosis. |
| 2026-10-26 11:50 | v0.4.1 | baseline/mobile/src/screens/CodesScreen.js | 3 lines: summary card accent follows the stricter server level and shows `CodesVerdictNote` ("No trouble codes, but the LYLO server flagged readings worth checking"). Renders nothing without serverDiagnosis. |
| 2026-10-26 11:50 | v0.4.1 | baseline/mobile/ui-tests/screens.test.js | Build label v0.4.1; 2 tests for the verdict reconciliation (with/without serverDiagnosis). |
| 2026-10-26 11:50 | v0.4.1 | baseline/mobile/src/screens/HomeScreen.js | Build label v0.4.1. |
| 2026-10-26 11:50 | v0.4.1 | baseline/mobile/app.json | version 0.4.1, versionCode 5. package.json / package-lock.json: version 0.4.1. |
| 2026-10-26 12:30 | v0.4.1 | baseline/mobile/src/screens/UsedCarScreen.js | Early return (about 12 lines, after all hooks): when `hasServerResult(scan)`, render hackathon `SimpleResults` (one verdict, Simple view / Mechanic view) with Share + Home buttons. Without a server result the baseline screen renders unchanged. |
| 2026-10-26 12:30 | v0.4.1 | baseline/mobile/src/screens/CodesScreen.js | Same early return as UsedCarScreen, with Share, Clear codes, Home buttons. Baseline unchanged without a server result. |
| 2026-10-26 12:30 | v0.4.1 | baseline/mobile/package.json | Added dependency `@react-native-async-storage/async-storage` ^1.23.1 (stores only the new key `lylo.viewMode`; the app had no AsyncStorage keys before). package-lock.json updated by npm. |
| 2026-10-26 12:30 | v0.4.1 | baseline/mobile/package-lock.json | npm lockfile for the async-storage dependency. |
| 2026-10-26 12:30 | v0.4.1 | baseline/mobile/ui-tests/results.test.js | New: render tests for each verdict color, the one-verdict rule, Simple/Mechanic views, `lylo.viewMode` persistence. screens.test.js verdict test updated to the new screen. |

## Muse Detective (b53890c, 6137584, eeb51a4)
- `hackathon/server/lylo_hack/{ledger,muse,detective}.py`: Evidence Ledger, Meta Model API client, and detective. Every claim cites ledger ids, and claims citing missing ids are marked unverified. Muse can only raise the safety level, never lower it, and every failure path fails closed. Behind `LYLO_HACK_MUSE` (default 0).
- `live.py`: adds a `detective` block to `/api/v1/live/live`, plus `install_shared_list_fix()` (`LYLO_HACK_FIX_SHARED_LIST`, default 1). This works around a baseline bug where `_build_hypothesis` mutated the shared rule-table list. The fix lives in the hackathon layer and no baseline file was edited.
- `app.py`: loads the gitignored `hackathon/server/.env` (mode 600 on the Dell). `/healthz` reports muse on/off.
- `validation.py`: optional freeze_frame validation.
- `scripts/live_detective_demo.py` and `evidence/` (VINs masked).
- Modified baseline files: none in this step.

## v0.4.0 public API (Oct 26)
- `hackathon/server/lylo_hack/security.py` + guard in `app.py`: app-key header (SHA-256 digests server-side), per-IP/per-key/daily Muse limits shared via SQLite, 6 MB body cap, `CF-Connecting-IP` trusted only from loopback, no CORS. `tests/test_security.py`. Details: `docs/PUBLIC_API.md`.
- PM2 config: gunicorn `--timeout 60`.
- mobile-bridge: `X-LYLO-App-Key` from `EXPO_PUBLIC_LYLO_APP_KEY` (build time only); 401/429 fall back offline (tests).
- `baseline/mobile/android/` is gitignored (Expo native project, untracked); its build.gradle versionCode 4 / versionName 0.4.0 edit is local to the build box and mirrors app.json.
- Deployed (Oct 26 ~10:40 PT): Dell lylo-hack restarted with key check on; tunnel ingress `lylo-api.thegoodneighborguard.com -> http://127.0.0.1:5088` added (backup `~/.cloudflared/config.yml.bak-lylo-api-20261026-173838`), CNAME routed, PM2 `tunnel` restarted. All 17 existing hostnames returned the same status before/after (splendor showed one 000 right after restart, then 200 x3).
- APK v0.4.0 built natively on the box (Gradle assembleRelease, Metro cache cleared), signed with the v0.3.0 debug keystore (cert SHA-256 fac61745…3b9c, identical). Box: `/workspace/lylo-mechanic-export/lylo-mechanic-v0.4.0.apk`, sha256 a881d70d…d6bc.

## v0.4.1 (Oct 26, after Chris's real-truck test)
- Bug: used-car screen showed "LOOKS GOOD" under a server "Get it inspected soon". Fixed with `hackathon/mobile-bridge/src/verdictView.js` (+ `CodesVerdictNote.js`): the baseline card now shows the stricter server level and a plain note; never lowers a stricter baseline verdict; offline/no server = unchanged. Tests: `test/verdictView.test.js`, 2 jest UI tests.
- Cold-engine cap (`detective.cap_for_cold_engine`): coolant < 150 °F and no DTCs -> the AI may raise at most to INSPECT_SOON, adds a "recheck when warm" note (`cold_engine_note`). Never below the rule level. `tests/test_cold_engine.py`.
- Wording: "The detective raised the safety level from safe to drive using cited evidence" (read as if it raised it TO safe) -> 'The AI detective raised the safety level from "safe to drive" to "get it inspected soon", based on the readings it cites.'
- Known, unchanged: the baseline Share report text still uses the on-phone verdict.

### v0.4.1 results redesign (Chris, 11:45 steering)
- When the LYLO server answered, Used-car and Codes screens show `hackathon/mobile-bridge/src/SimpleResults.js`: one traffic-light verdict (Good to drive / Get it checked soon / Drive only short trips / Don't drive it), plain why, 1-3 actions (costs only from baseline repair-cost data), erased-codes warning, collapsed "See why" with friendly labels, receipt + "Powered by Meta AI" at the bottom.
- Toggle "Simple view | Mechanic view" (Simple default), saved under new AsyncStorage key `lylo.viewMode`. Mechanic view: hypotheses with confidence, raw PIDs, evidence, codes, monitors, freeze frame (not read by this app: said so), server/adapter, receipt.
- Modules: `friendlyLabels.js`, `viewMode.js`, `resultsView.js`, tests `test/resultsView.test.js`, fixtures `test/fixtures/` (truck fixture is synthetic truck-like data).
- Offline / no server result: baseline screens unchanged (plus the reconcileVerdict note).
- Safety note wording now "Meta AI raised the safety level from ... to ...".
- Mockups: `/workspace/lylo-mechanic-export/mockups/*.png` (HTML twin rendered from the real `buildResults`).
