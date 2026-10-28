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
| 2026-10-28 03:15 | v0.4.4 | hackathon/mobile-bridge/src/dashVoice.js, test/dashVoice.test.js | Pure logic for "Snap the dash" and "Ask out loud": flags `EXPO_PUBLIC_LYLO_DASH_PHOTO=1` / `EXPO_PUBLIC_LYLO_VOICE_ASK=1` (plus server URL; unset = nothing shown or sent), multipart calls to /api/v1/vision/dash (photo + scan, detective=0 so one model call) and /api/v1/voice/ask (audio + scan + photo evidence), client timeouts 45/50 s (under gunicorn 60 s), plain messages for offline/timeout/503/429/424/4xx, photo can only raise the level (`applyDash`), unverified voice answers withheld, safety_notice always first, recording options (Android AAC/ADTS 16 kHz mono, iOS 16-bit WAV, 30 s cap). 8 Node tests using the real evidence files |
| 2026-10-28 03:15 | v0.4.4 | hackathon/mobile-bridge/src/DashVoicePanel.js, SimpleResults.js | Results-screen panel: camera/gallery -> findings + "raised the safety level" banner and the verdict updates (never lower); record -> Stop and send -> transcript, safety notice, cited answer, follow-ups, receipt. Camera/mic permission denied, no picker/recorder, offline and slow (after 12 s "Still working") handled. Renders nothing with the flags unset |
| 2026-10-28 03:15 | v0.4.4 | hackathon/server/lylo_hack/voice.py, tests/test_voice_convert.py | Bug fix found while testing phone audio: ffmpeg writing WAV to a pipe leaves a placeholder data size, so every converted (non-WAV) upload read as hours long and was rejected (400 "longer than 60 s"). The PCM is now re-wrapped with a correct header. Native WAV path unchanged. 4 new Python tests (ADTS AAC, WAV passthrough, garbage, bad input) |

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
| 2026-10-26 12:20 | v0.4.2 | baseline/mobile/src/App.js | 2 lines: import hackathon `PhotoHelperScreen` and register route `PhotoHelper`. |
| 2026-10-26 12:20 | v0.4.2 | baseline/mobile/src/screens/HomeScreen.js | 1 line: Tools card button "Photo Helper: find a part on your car"; build label v0.4.2. |
| 2026-10-26 12:20 | v0.4.2 | baseline/mobile/package.json | Dependency `expo-image-picker` ~15.0.7 (camera/gallery for Photo Helper); version 0.4.2. package-lock.json updated by npm. |
| 2026-10-26 12:20 | v0.4.2 | baseline/mobile/app.json | version 0.4.2, versionCode 6; `android.permission.CAMERA` (the expo-image-picker library manifest also merges CAMERA + media read); iOS NSCameraUsageDescription. RECORD_AUDIO stays blocked. |
| 2026-10-26 12:20 | v0.4.2 | baseline/mobile/ui-tests/photoHelper.test.js | New: Photo Helper render tests (job list, pro refusal, found, not found, engine cover, Mechanic view). screens.test.js label v0.4.2. |
| 2026-10-26 13:00 | v0.4.3 | baseline/mobile/src/App.js | 2 lines: import hackathon `VinScreen`, register route `Vin` ("Your car"). |
| 2026-10-26 13:00 | v0.4.3 | baseline/mobile/src/screens/HomeScreen.js | 1 line: Tools button "Your car: add your VIN"; build label v0.4.3. |
| 2026-10-26 13:00 | v0.4.3 | baseline/mobile/package.json, app.json | version 0.4.3, versionCode 7. No new dependencies or permissions. |
| 2026-10-26 13:00 | v0.4.3 | baseline/mobile/ui-tests/vinPrice.test.js | New: VIN screen + price button render tests. screens.test.js label v0.4.3. |
| 2026-10-28 03:15 | v0.4.4 | baseline/mobile/package.json | Dependency `expo-av` ~14.0.7 (Expo 51 recording for "Ask out loud"); version 0.4.4. |
| 2026-10-28 03:15 | v0.4.4 | baseline/mobile/package-lock.json | npm lockfile for expo-av; version 0.4.4. |
| 2026-10-28 03:15 | v0.4.4 | baseline/mobile/app.json | version 0.4.4, versionCode 8; `android.permission.RECORD_AUDIO` moved from blockedPermissions to permissions; expo-av plugin with microphonePermission text; iOS NSMicrophoneUsageDescription. The mic is only opened after the user taps "Ask out loud" (flag on). |
| 2026-10-28 03:15 | v0.4.4 | baseline/mobile/src/screens/HomeScreen.js | Build label v0.4.4. |
| 2026-10-28 03:15 | v0.4.4 | baseline/mobile/ui-tests/screens.test.js | Build label v0.4.4. |
| 2026-10-28 03:15 | v0.4.4 | baseline/mobile/ui-tests/dashVoice.test.js | New: 6 render tests (flags unset = no buttons; dash photo raises the verdict; never lowers; camera denied, offline, 503; voice transcript + notice + cited answer; mic denied; unverified answer withheld). |
| 2026-10-28 04:00 | v0.4.5 | baseline/mobile/src/App.js | Registers the `NoAdapter` route (hackathon NoAdapterScreen). |
| 2026-10-28 04:00 | v0.4.5 | baseline/mobile/src/screens/HomeScreen.js | "No adapter? Start here" card when EXPO_PUBLIC_LYLO_NO_ADAPTER=1 (hidden otherwise); build label v0.4.5. |
| 2026-10-28 04:00 | v0.4.5 | baseline/mobile/app.json | Version 0.4.5, versionCode 9. No new permissions. |
| 2026-10-28 04:00 | v0.4.5 | baseline/mobile/package.json | Version 0.4.5. No new dependencies. |
| 2026-10-28 04:00 | v0.4.5 | baseline/mobile/package-lock.json | Version 0.4.5 (root entry only). |
| 2026-10-28 04:00 | v0.4.5 | baseline/mobile/ui-tests/testUtils.js | Adds getByTestId/queryByTestId helpers (test-only). |
| 2026-10-28 04:00 | v0.4.5 | baseline/mobile/ui-tests/screens.test.js | Build label v0.4.5. |
| 2026-10-28 04:00 | v0.4.5 | baseline/mobile/ui-tests/noAdapter.test.js | New: render tests for the No adapter screen (flag off = nothing; offline rule floor; typed code meaning + price links; server cannot lower; OBDLink links). |
| 2026-10-28 04:00 | v0.4.5 | baseline/mobile/ui-tests/noAdapterHome.test.js | New: no Bluetooth prompt or BleManager at launch; Home entry opens the No adapter screen. |
| 2026-10-28 04:50 | v0.4.6 | baseline/mobile/src/App.js | Registers the `Setup` route (hackathon SetupScreen, first-run setup). |
| 2026-10-28 04:50 | v0.4.6 | baseline/mobile/src/screens/HomeScreen.js | Opens Setup once on first launch and adds a Tools > Setup button, both only when EXPO_PUBLIC_LYLO_FIRST_RUN=1; build label v0.4.6. |
| 2026-10-28 04:50 | v0.4.6 | baseline/mobile/src/screens/CodeDetailScreen.js | Renders hackathon RepairLinks under "How to fix it": Watch how (YouTube search for the remembered vehicle + repair), Find nearest store (Google Maps), store price buttons when the fix names a part. |
| 2026-10-28 04:50 | v0.4.6 | baseline/mobile/app.json | Version 0.4.6, versionCode 10. No new permissions (no location). |
| 2026-10-28 04:50 | v0.4.6 | baseline/mobile/package.json | Version 0.4.6. No new dependencies. |
| 2026-10-28 04:50 | v0.4.6 | baseline/mobile/package-lock.json | Version 0.4.6 (root entry only). |
| 2026-10-28 04:50 | v0.4.6 | baseline/mobile/ui-tests/screens.test.js | Build label v0.4.6. |
| 2026-10-28 04:50 | v0.4.6 | baseline/mobile/ui-tests/vinPrice.test.js | Recall text now reads "recall for your model". |
| 2026-10-28 04:50 | v0.4.6 | baseline/mobile/ui-tests/v046.test.js | New: 7 render tests (no-sensor note before the first check; Watch how + nearest store on code detail, with and without a vehicle; setup no-adapter/mechanic/year-make-model; setup VIN path; skip all; Home first-run open + Tools button). |
| 2026-10-28 03:59 | v0.4.7 | baseline/mobile/src/App.js | Registers the `Demo` route (hackathon DemoScreen). |
| 2026-10-28 03:59 | v0.4.7 | baseline/mobile/src/screens/HomeScreen.js | "No car? No adapter?" card with "Try a demo scan", only when EXPO_PUBLIC_LYLO_DEMO=1; build label v0.4.7. |
| 2026-10-28 03:59 | v0.4.7 | baseline/mobile/app.json | Version 0.4.7, versionCode 11. No new permissions. |
| 2026-10-28 03:59 | v0.4.7 | baseline/mobile/package.json | Version 0.4.7. No new dependencies. |
| 2026-10-28 03:59 | v0.4.7 | baseline/mobile/package-lock.json | Version 0.4.7 (root entry only). |
| 2026-10-28 03:59 | v0.4.7 | baseline/mobile/ui-tests/screens.test.js | Build label v0.4.7. |
| 2026-10-28 03:59 | v0.4.7 | baseline/mobile/ui-tests/demo.test.js | New: 5 render tests (three cases listed; truck replay shows server verdict, causes, receipt; AI-vs-rules proof shows the simulated label, both verdicts and "Rules won"; no-server message; Home entry). |
| 2026-10-28 04:02 | v0.4.7 docs | README.md | New top-level README for judges: story, what it does, rules-decide-safety design, Meta models, privacy, verify, tests, try with no car, limits. |
| 2026-10-28 04:02 | v0.4.7 docs | docs/DEMO_SCRIPT.md | Replaced the stale v0.3 script with demo script v2; truck numbers only from the real recorded run. |
| 2026-10-28 04:02 | v0.4.7 docs | docs/HACKATHON_LOG.md | Session log for the v0.4.7 docs, demo flag and APK. |
| 2026-10-28 05:45 | net fix | hackathon/server/lylo_hack/netpref.py | New: IPv4 preference for outbound calls, only when LYLO_HACK_FORCE_IPV4=1 (unset = nothing patched). Fixes 12-40 s IPv6 stalls on NHTSA/Meta calls (measured; see docs/HACKATHON_LOG.md "IPv6 stall evidence"). |
| 2026-10-28 05:45 | net fix | hackathon/server/lylo_hack/app.py | Calls netpref.apply() in create_app (2 lines; no-op unless LYLO_HACK_FORCE_IPV4=1). |
| 2026-10-28 05:45 | net fix | hackathon/server/tests/test_netpref.py | New: tests that flag off patches nothing and flag on keeps only IPv4 results. |
| 2026-10-28 05:45 | net fix | hackathon/server/gunicorn.conf.py | New: gthread worker, 8 threads, so one slow Muse call cannot block quick lookups. Delete the file to revert. |
| 2026-10-28 05:45 | net fix | docs/HACKATHON_LOG.md | Session log for the VIN-lookup timeout fix and the v0.4.7 APK URL. |
| 2026-10-28 06:20 | v0.4.8 | hackathon/server/lylo_hack/engine_user.py | New: owner-set engine. Validates engine_user (plain text, 60 chars) and fuel_user (gas/diesel/hybrid_ev/not_sure); prefers it over the vPIC engine in the ledger (labeled "set by owner", vPIC kept as nhtsa_engine); cautious engine_check_hint for a diesel decode on a Ford E/F-series. All behind LYLO_HACK_ENGINE_OVERRIDE=1. |
| 2026-10-28 06:20 | v0.4.8 | hackathon/server/lylo_hack/app.py | /vin/decode adds engine_check_hint; /noadapter/check adds the owner engine item + vehicle_engine; /photo/helper prompt uses the owner engine. All no-ops unless LYLO_HACK_ENGINE_OVERRIDE=1. |
| 2026-10-28 06:20 | v0.4.8 | hackathon/server/lylo_hack/detective.py | Detective ledger: owner engine replaces the decoded engine (flag only). |
| 2026-10-28 06:20 | v0.4.8 | hackathon/server/lylo_hack/live.py | Deterministic ledger rebuild (dash photo, voice) gets the same owner-engine step (flag only). |
| 2026-10-28 06:20 | v0.4.8 | hackathon/server/lylo_hack/validation.py | Live payload: checks the new vehicle_profile engine fields only when the flag is on; off = no new errors. |
| 2026-10-28 06:20 | v0.4.8 | hackathon/server/tests/test_engine_user.py | New: 8 tests (flag off ignores everything, cleaning/caps, labels, validation, hint only for Ford E/F diesel, decode route, live ledger + prompt, no-adapter route). |
| 2026-10-28 06:20 | v0.4.8 | hackathon/mobile-bridge/src/engineOverride.js | New: "Not my engine?" store (lylo.engineOverride, same VIN as lylo.vehicle) and the fields sent to the server (engine_user, fuel_user, engine_source=user). Flag EXPO_PUBLIC_LYLO_ENGINE_OVERRIDE=1. |
| 2026-10-28 06:20 | v0.4.8 | hackathon/mobile-bridge/src/VinScreen.js | "Not my engine?" editor (Gas/Diesel/Hybrid/EV/Not sure + optional engine name); card shows "Engine set by you" with the NHTSA decode in small text; shows the server hint. Flag only. |
| 2026-10-28 06:20 | v0.4.8 | hackathon/mobile-bridge/src/scanToLive.js | vehicle_profile gets the owner engine fields (live/detective, dash photo, voice). {} when the flag is off. |
| 2026-10-28 06:20 | v0.4.8 | hackathon/mobile-bridge/src/uploadClient.js | Loads the saved owner engine before building the live payload (flag only). |
| 2026-10-28 06:20 | v0.4.8 | hackathon/mobile-bridge/src/dashVoice.js | Loads the saved owner engine before the dash and voice requests (flag only). |
| 2026-10-28 06:20 | v0.4.8 | hackathon/mobile-bridge/src/noAdapter.js | No-adapter check form carries the owner engine fields (flag only). |
| 2026-10-28 06:20 | v0.4.8 | hackathon/mobile-bridge/src/photoHelper.js | Photo Helper form carries the owner engine fields when a VIN is sent (flag only). |
| 2026-10-28 06:20 | v0.4.8 | hackathon/mobile-bridge/src/vin.js | decodeVin keeps the server engine_check_hint as engineHint, only when the server sends one. |
| 2026-10-28 06:20 | v0.4.8 | hackathon/mobile-bridge/test/engineOverride.test.js | New: 7 node tests (flag, cleaning, storage round trip, flag-off payload byte-identical, flag-on payload, all four request paths on/off, hint pass-through). |
| 2026-10-28 06:20 | v0.4.8 | baseline/mobile/ui-tests/engineOverride.test.js | New: 3 render tests (flag off = old card; flag on: hint, pick Gas + engine, "Engine set by you", NHTSA kept; saved override loads and clears). |
| 2026-10-28 06:20 | v0.4.8 | baseline/mobile/src/screens/HomeScreen.js | Build label v0.4.8. |
| 2026-10-28 06:20 | v0.4.8 | baseline/mobile/app.json | Version 0.4.8, versionCode 12. No new permissions. |
| 2026-10-28 06:20 | v0.4.8 | baseline/mobile/package.json | Version 0.4.8. No new dependencies. |
| 2026-10-28 06:20 | v0.4.8 | baseline/mobile/package-lock.json | Version 0.4.8 (root entry only). |
| 2026-10-28 06:20 | v0.4.8 | baseline/mobile/ui-tests/screens.test.js | Build label v0.4.8. |
| 2026-10-28 06:20 | v0.4.8 | hackathon/.env.example | Documents LYLO_HACK_ENGINE_OVERRIDE and LYLO_HACK_FORCE_IPV4 (default off). |
| 2026-10-28 06:20 | v0.4.8 | docs/HACKATHON_LOG.md | Session log for v0.4.8. |
| 2026-10-28 06:20 | v0.4.8 | hackathon/mobile-bridge/README.md | Documents the EXPO_PUBLIC_LYLO_ENGINE_OVERRIDE flag. |
| 2026-10-28 06:30 | Vera fix | hackathon/server/lylo_hack/engine_user.py | With the owner engine set, the decoded engine is removed from every model-bound item (no nhtsa_engine in the ledger or Photo Helper vehicle); kept only in result.vehicle_engine.nhtsa_engine for the phone. Flag only. |
| 2026-10-28 06:30 | Vera fix | hackathon/server/lylo_hack/detective.py | Passes the result to apply_to_items so vehicle_engine (with nhtsa_engine) goes to the phone, not the prompt. Flag only. |
| 2026-10-28 06:30 | Vera fix | hackathon/server/lylo_hack/live.py | Same for the deterministic rebuild. Flag only. |
| 2026-10-28 06:30 | Vera fix | hackathon/server/lylo_hack/app.py | Photo Helper: decoded engine added to the response only (vehicle.nhtsa_engine, engine_source), after the prompt is built. Flag only. |
| 2026-10-28 06:30 | Vera fix | hackathon/server/tests/test_engine_user.py | New test: decoded engine string absent from captured model messages, ledger, apply_to_items, apply_to_decode and prompt_line; live test checks vehicle_engine.nhtsa_engine. 9 tests. |
| 2026-10-28 06:30 | Vera fix | hackathon/server/gunicorn.conf.py | Flagged: LYLO_HACK_GTHREAD=1 gives gthread with LYLO_HACK_THREADS (default 8); else sync, 1 thread (gunicorn defaults). Reads the two names from the process env, then hackathon/server/.env. |
| 2026-10-28 06:30 | Vera fix | hackathon/.env.example | Documents LYLO_HACK_GTHREAD and LYLO_HACK_THREADS. |
| 2026-10-28 06:30 | Vera fix | docs/PUBLIC_API.md | Path line: gunicorn -w 2 plus the optional gthread conf. |
| 2026-10-28 06:30 | Vera fix | docs/HACKATHON_LOG.md | Vera fixes, thread-safety check, IPv6 stall evidence. |
| 2026-10-28 06:30 | Vera fix | NEW_WORK.md | IPv6 claim now points to the measured evidence; these rows. |

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

## v0.4.2 Photo Helper (Oct 26)
- Server `POST /api/v1/photo/helper` (flag `LYLO_HACK_PHOTO_HELPER`, default off; app key + Muse rate limits like the other Muse routes; EXIF stripped; photo never stored) and `GET /api/v1/photo/jobs`. `lylo_hack/helper.py`: 6 fixed jobs, strict JSON schema with per-job label enum, coordinates validated + clamped to 0..1, marks below confidence 0.6 dropped, max 6, numbered. Steps and safety text are FIXED curated text, never model-written. Not found -> "I can't see it in this photo. Try a closer picture or check your owner's manual." Risky jobs (brakes, fuel, airbags, hybrid/EV high voltage) -> "Get a pro for this one." without a model call; orange HV cables or smoke seen in a photo -> same. Battery always shows the negative-first / no metal tool warning. Always: "This is not a guarantee. It gives you an idea of where to look."
- Plastic engine cover (mechanic friend): model flags `engine_cover_hides_area`; server then keeps only cover marks (Engine cover / Pull up here / Cover clip or bolt), never parts underneath, and says "There's a plastic cover over the engine. It usually pops off by pulling up, or has a few clips/bolts."
- Wiring before parts (mechanic friend): `lylo_hack/wiring.py` adds ledger item `rule:wiring_first` for sensor/circuit codes; Detective prompt rule 7; Simple view action "Before buying a new sensor, check its plug and wiring ... Often it's the wire or plug, not the sensor."
- Simple view never shows trouble codes or technical code titles (plain phrase, e.g. "a catalytic converter problem"); Mechanic view keeps raw codes.
- App: `hackathon/mobile-bridge/src/photoHelper.js` + `PhotoHelperScreen.js` (Simple view | Mechanic view via `lylo.viewMode`).
- Evidence: `hackathon/server/evidence/photo_helper/` (AI-generated synthetic photos, no plates/people; live outputs).
- NOT done yet (next): VIN-first (NHTSA vPIC decode, Type VIN / Photo of VIN with check digit, recalls).

## v0.4.3 VIN-first, Check the price, Photo Helper fixes (Oct 26)
- 502 fix: the covered-engine live call failed because the Photo Helper strict json_schema listed `engine_cover_hides_area` in properties but not in `required`; the Meta API rejects that before reading the photo (HTTP 400 -> our 502 -> Cloudflare showed its own "error code: 502" page, hiding the JSON). Fixed the schema; `tests/test_schemas.py` now checks every strict schema; upstream failures on Muse routes return 424 with `upstream_error` and are logged (code + short detail, never the key or photo).
- VIN-first (`lylo_hack/vin.py`, flag `LYLO_HACK_VIN`, default off): ISO 3779 check digit (never guesses), NHTSA vPIC decode with 7-day in-memory cache, 6 s timeout, fail-open to "unknown"; NHTSA recalls by year/make/model, labeled as not VIN-specific. Routes `POST /api/v1/vin/decode` and `POST /api/v1/vin/photo` (Muse vision reads the VIN; accepted only if the check digit passes). Ledger item `vin:decoded` (source vin_decode, caveat "assumes the factory engine (not swapped)") + Detective rule 8; the Photo Helper prompt gets year/make/model/engine. The raw VIN is never sent to Meta AI (ledger keeps the 3-char masked VIN).
- App: `VinScreen` (Type VIN / Photo of VIN, stored under the new key `lylo.vehicle`), the vehicle name in Simple view and Photo Helper.
- "Check the price" (`mobile-bridge/src/priceLinks.js`, `PriceButtons.js`): AutoZone, O'Reilly, Advance Auto Parts, NAPA (local) and RockAuto (online catalog). These are public search URLs only (no scraping, APIs or affiliate tags) and open in the browser. The estimate comes from LYLO price data (baseline repair_costs.json / dtcCodes) and is labeled "Estimate". URL checks: `hackathon/server/evidence/price_links.md`.
- Photo Helper marks: radius capped at 0.15 of the width; overlapping circles shrink apart; number badges are placed so they don't collide (same algorithm in app and mockup renderer).

## v0.4.4 Snap the dash + Ask out loud (Oct 28)
- Results screen (SimpleResults, server answered) gets "Add more to this check": **Snap the dash** (camera or gallery -> /api/v1/vision/dash with the scan) and **Ask out loud** (record -> /api/v1/voice/ask with the scan and any dash-photo evidence).
- Build flags: `EXPO_PUBLIC_LYLO_DASH_PHOTO=1`, `EXPO_PUBLIC_LYLO_VOICE_ASK=1` (and `EXPO_PUBLIC_LYLO_SERVER_URL`). Unset = panel not rendered, no request, results screen exactly as v0.4.3. Build with `--clear` after changing them.
- Timeouts: the phone asks for detective=0 on the dash call (one model call, ~3 s live) and gives up at 45 s (dash) / 50 s (voice), under gunicorn `--timeout 60`, showing "Meta AI took too long... your scan result above still stands". No server-side timeout change was needed.

## v0.4.5 No adapter? Start here (Oct 28)
- Everyday drivers can use LYLO with no OBD adapter. A new Home card, **No adapter? Start here**, opens `hackathon/mobile-bridge/src/NoAdapterScreen.js` with:
  - **What's happening?** Type it, or **Say it instead** (recorded, sent to the server, transcribed, never stored). Fixed safety rules run on the phone first (`noAdapter.js`), work offline, and match the server's rules (shared sentences in `mobile-bridge/test/fixtures/symptom_cases.json`).
  - **Trouble code** typed by hand: offline meaning from the baseline dtcCodes library, a LYLO estimate, Check the price buttons and Full details.
  - **Snap the dash** with no scan (the same panel, photo floor applied).
  - Your car: VIN and recalls, code lookup, Photo Helper.
  - **OBDLink suggestion card**: CX (BLE), MX+ (Bluetooth) and EX (wired USB). It shows only facts read on obdlink.com on 2026-10-28 and links to the official product pages (all HTTP 200). No prices and no affiliate links. It says clearly that the app works without an adapter, and that the app connects to CX/MX+ over Bluetooth (wired EX is not supported by the app).
- Server: `POST /api/v1/noadapter/check` (`hackathon/server/lylo_hack/symptoms.py`, flag `LYLO_HACK_NO_ADAPTER`, default 0). It takes text and/or audio, typed codes, year/make/model and optional dash-photo evidence, and builds a symptom-only ledger:
  - The owner's words are labeled "described by the owner, not measured", and there is a `ctx:no_adapter` item.
  - Typed codes go through the baseline rule engine as a codes-only scan.
  - Rule floors apply before any AI. Fire gives EMERGENCY_STOP. These give DO_NOT_DRIVE: smoke, steam, burning or fuel smell, grinding or soft brakes, brake/oil/coolant light, overheating or a hot gauge, a flashing check-engine light, steering problems, a loose wheel.
  - With no data the base level is INSPECT_SOON, never "safe".
  - The Meta AI answer uses the same `voice.answer` (citations checked, unverified claims withheld and counted) and can only raise.
  - Every reply carries a lower-confidence note.
- `POST /api/v1/voice/ask` accepts a question with no scan when `LYLO_HACK_NO_ADAPTER=1`, using the same symptom-only ledger. It still returns 400 without a scan when the flag is off.
- Bluetooth: checked that it is never prompted at launch. Runtime permissions are requested only on ConnectScreen, and BleManager is created lazily. A UI test asserts there is no prompt and no BleManager at launch. No baseline Bluetooth change.
- Build flag: `EXPO_PUBLIC_LYLO_NO_ADAPTER=1` (ON in the test build; build with `--clear`).

## v0.4.6 Watch how, nearest store, first-run setup (Oct 28)
- `hackathon/mobile-bridge/src/priceLinks.js`: `youtubeUrl()` (plain `youtube.com/results?search_query=` URL, no API or key), `NEARBY` (Google Maps `?api=1&query=AutoZone near me`, O'Reilly, NAPA; no location permission, LYLO never sees the location), `forCodeDetail()`. Every price card now carries `watch` and `nearby`; the existing store buttons are unchanged.
- `PriceButtons.js`: "Watch how: videos for your <year make model>" and "Find nearest store" buttons (repair screens: SimpleResults, Photo Helper, No adapter codes). Recall line says "These are recalls for your model."
- `RepairLinks.js`: the same buttons on the baseline Code detail screen, using the remembered vehicle (`lylo.vehicle`).
- `NoAdapterScreen.js`: "less accurate without live sensor data" note in the top card, before the first check.
- `setup.js` + `SetupScreen.js`: first-run setup (adapter yes/no, Simple/Mechanic, VIN via the existing lookup or year/make/model). Shown once (`lylo.setupDone`), every question skippable, re-open from Home > Tools. Saves to `lylo.viewMode` and `lylo.vehicle`; new key `lylo.hasAdapter`. "No adapter" goes to the No adapter screen. Flag `EXPO_PUBLIC_LYLO_FIRST_RUN=1` gates only the first-run auto-open and the Tools > Setup button.
- **Not behind any flag (visible in every build):** Watch how and Find nearest store on Code detail (RepairLinks) and on every price card, the no-sensor note on the No adapter screen (that screen itself needs `EXPO_PUBLIC_LYLO_NO_ADAPTER=1`), the "recalls for your model" wording, and the registered `Setup` route. A build with no flags set is therefore NOT identical to v0.4.5.
- `vin.js`: recall text "N recalls for your model (year make model)", never implying the exact VIN.
- Tests: `test/v046.test.js` (Node), `baseline/mobile/ui-tests/v046.test.js` (jest UI). No server code changed.

## v0.4.7 Try a demo scan, AI vs rules (Oct 28)
- Server (flag `LYLO_HACK_DEMO=1`, off by default; routes return 503 when off): `lylo_hack/demo.py`, `demo_scans/{truck,usedcar,overheat}.json`.
  - `GET /api/v1/demo/cases`; `POST /api/v1/demo/replay {case}` runs the bundled scan through `live.diagnose` (the same pipeline as `/api/v1/live/live`: rules, Muse Detective when `LYLO_HACK_MUSE=1`, never-lower merge, receipts). Counts against the Muse rate limits when Muse is on.
  - `POST /api/v1/demo/proof`: "AI vs rules". There is no recorded run where Muse proposed a lower level than the rules (all evidence runs are `agreed` or `raised_by_detective`), so this injects a **simulated** SAFE_TO_DRIVE answer, labeled "Simulated AI answer for this test (no AI model was called)", into the real `detective.run` / `merge_safety` on the 260 °F scan. Rules: EMERGENCY_STOP_IMMEDIATELY; final: EMERGENCY_STOP_IMMEDIATELY; action `detective_lower_ignored`. No model call.
  - `detective.run(..., force_call=False)`: new keyword so the proof can inject its simulated answer while Muse is off. Default behavior unchanged.
  - Demo scans: truck = readings from Chris's own truck scan (STFT 27.3 %, LTFT 6.3 %, coolant 79 °F, 984 rpm, no codes), vehicle details removed; usedcar = LYLO's built-in used-car demo (not a real car); overheat = made-up 260 °F test scan.
- Phone (flag `EXPO_PUBLIC_LYLO_DEMO=1`): `hackathon/mobile-bridge/src/demo.js` (client + view models, Node-tested) and `DemoScreen.js`. Shows only numbers the server returned; the receipt line appears only when Muse actually ran.
- Tests: `hackathon/server/tests/test_demo.py` (5), `hackathon/mobile-bridge/test/demo.test.js` (4), `baseline/mobile/ui-tests/demo.test.js` (5).
- 2026-10-28 15:50 PT: README "Try it in 2 minutes" section (docs only; no baseline files changed).
- 2026-10-28 16:30 PT: v0.5.0 Point and prove (LYLO_HACK_PROVE / EXPO_PUBLIC_LYLO_PROVE) and SAM outline (LYLO_HACK_SAM): hackathon/ only; no baseline files changed.
