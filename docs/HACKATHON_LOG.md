# Hackathon build log (times are Pacific)

Each work session gets one entry: start/end time, who/what, commits, files, and the result (verified, or not yet tested).

## 2026-10-26, 6:15–6:30 AM PDT: repo setup (before the build opened at 9 AM PT)
- Imported the pre-hackathon code into `baseline/` as commit 867eece and tagged it `baseline-pre-hackathon`.
- Excluded: node_modules, __pycache__, keystores (including `mobile/android/app/debug.keystore`), .env*, the old .git, push_to_github.ps1, lylo_files.json (a base64 dump of the repo) and vicore's demo.sqlite (regenerable from fixtures).
- Added NEW_WORK.md, this log, `scripts/new-work-report.sh`, `scripts/check-baseline-integrity.sh` and `hackathon/.env.example`.
- No feature code was written and nothing was pushed.

## Session 2026-10-26 06:24 PDT — License
- Added Apache License 2.0 (LICENSE) at repo root. Chris chose Apache 2.0 on Ember's recommendation. No code changes.

## 2026-10-26, 9:02–9:10 AM PDT: Day 1, Android-to-Dell integration (Ember)
- Built the scan converter and upload client (`hackathon/mobile-bridge`) and the hackathon live server (`hackathon/server/lylo_hack`), commit bbc4a88. All six fixes from the Oct 26 verification spec are in; see NEW_WORK.md.
- Judgment calls: codes are treated as recently cleared under 80 km, 10 warm-ups or 60 engine minutes since clear, or when a permanent code has no stored match. Permanent codes count as active for safety and hypotheses.
- Verified on the box: 14/14 Node tests and 12/12 Python tests pass (Python 3.13, Flask 3.1.3, egress blocked). With the converter, the used-car demo now yields 3 hypotheses (the baseline route gave 0) and DRIVE_SHORT_DISTANCE_ONLY; the check-engine demo gives INSPECT_SOON. HTTP smoke on 127.0.0.1:5099: /healthz ok, a misnamed PID gets 400.
- No baseline files changed. No paid calls, nothing pushed, no Dell deploy, live Splendor and CLASPION untouched.
- Not done yet: wiring `diagnoseScan` into the app's scan screen (a logged baseline change), running the server on the Dell (port 5088, check with `ss` first), and a real-car scan.

## 2026-10-26, 9:28–9:45 AM PDT: Day 1b, scan-screen hook + Dell server (Ember)
- 1cd4918: `hackathon/mobile-bridge/src/scanHook.js` (`afterScan`) wired into `baseline/mobile/src/screens/ScanScreen.js` (3-line logged baseline change) plus a new `baseline/mobile/metro.config.js` (watchFolders). Flag `EXPO_PUBLIC_LYLO_SERVER_URL`; unset = identical scan object, no network. The screens don't display `scan.serverDiagnosis` yet.
- `scripts/check-baseline-integrity.sh` needed no change: it flagged both files as UNLOGGED until the NEW_WORK.md rows were added, then passed (2 logged changes). That's the intended behavior.
- 11bb8a4: PM2 config. Dell: fast-forwarded the clone from a bundle, made `hackathon/server/.venv`, started new PM2 app `lylo-hack` (gunicorn, 127.0.0.1:5088). No other PM2 app touched, no `pm2 save`, no `--update-env`, no tunnel route.
- Verified on the Dell: 12/12 Python, 19/19 Node. Smoke on :5088: /healthz ok (handshake stubbed); usedcar demo 200 DRIVE_SHORT_DISTANCE_ONLY, 3 hypotheses; checkengine demo 200 INSPECT_SOON, 4 hypotheses; `coolant_temp` 400; `ENGINE_COOLANT_TEMP` 260 °F EMERGENCY_STOP_IMMEDIATELY; malformed JSON 400. `{}` gives 200 (an empty scan is treated as valid). Splendor :3000/health 200, CLASPION :8010/docs 200, Legacy :8798/health 200, PIDs unchanged.
- Not verified: an Expo/Metro bundle of the app (no node_modules on the box), so the ScanScreen import path is checked by reading, not by a build.

## 2026-10-26, 9:30–9:40 AM PDT: Day 1c, empty-scan gate, results card, Metro check (Ember)
- b5bb53c: the server returns 400 for a scan with no codes and no numeric readings (`LYLO_HACK_REQUIRE_DATA`, default on). `ServerDiagnosisCard` (hackathon/mobile-bridge) is rendered on UsedCarScreen and CodesScreen (3 logged lines each) and returns null without `scan.serverDiagnosis`. metro.config.js gained `resolver.nodeModulesPaths`.
- Dell redeploy: `pm2 restart lylo-hack` only (no --update-env, no save). Env keys before/after identical; every other PM2 app has the same PID and restart count. Tests 13/13 Python, 25/25 Node.
- Smoke on :5088: usedcar 200 DRIVE_SHORT_DISTANCE_ONLY (3 hypotheses), checkengine 200 INSPECT_SOON (4), `coolant_temp` 400, ENGINE_COOLANT_TEMP 260 °F EMERGENCY_STOP_IMMEDIATELY, bad JSON 400, `{}` now 400 with the empty-scan reason. :3000/health 200, :8010/docs 200, :8798/health 200.
- Metro check (scratch copy in /tmp on the Dell, deleted afterward): `npm ci` (1402 packages, 7 s) and `npx expo export --platform android` both succeeded with the hackathon imports. Bundle 2.05 MB Hermes. With `EXPO_PUBLIC_LYLO_SERVER_URL` set, the URL is inlined only after `--clear`; a cached Metro build kept the old (unset) value. Always build with `--clear` after changing the URL. No account or EAS was used.

## 2026-10-26, ~9:50–10:00 AM PDT: Day 1d, Muse Detective (Ember)
- Model: `muse-spark-1.3` (standard, not contributor mode). Endpoint: `api.meta.ai/v1/chat/completions` with a strict json_schema, reasoning_effort low, store false.
- Key: `META_MODEL_API_KEY` in `hackathon/server/.env` on the Dell (gitignored, chmod 600). It is not in the PM2 env. Other settings: `LYLO_HACK_MUSE=1`, `LYLO_HACK_MUSE_MODEL`.
- Live calls: 5 total, roughly $0.052 estimated. That covers 1 probe, 3 evidence runs, and 1 post-deploy smoke test, with 0 429s. Pricing used: $1.25/M input, $4.25/M output.
- Results: every scenario was `agreed` with 0 unverified claims. Muse flags the recently-cleared codes (permanent P0171 still present) as a buyer red flag.
- Baseline bug: the shared `what_could_be_wrong` list grew on each request. It is patched from the hackathon layer and covered by a test.
- (Moved here from a root-level HACKATHON_LOG.md that commit eeb51a4 created by mistake. Also: 9f7d842 added a Muse-free 260 °F overheat regression guard. The `coolant_temp` 400 was the intended unknown-PID rejection, not a regression.)

## 2026-10-26, 10:09–10:30 AM PDT: Day 1e, Detective card, photo evidence, voice questions (Ember)
- 8839252 + a639e8c (hackathon/ only, no baseline edits):
  - **App**: `DetectiveCard` is rendered inside `ServerDiagnosisCard`. It shows the cleared-codes red flag, ranked hypotheses with confidence, tap-to-expand cited evidence, UNVERIFIED labels and a receipt line. It renders nothing unless `muse_status` is `ok`.
  - **Photo**: `POST /api/v1/vision/dash` (flag `LYLO_HACK_VISION`). The photo is capped at 5 MB, re-encoded so EXIF/GPS is dropped, downscaled to 1280 px and never stored (`LYLO_HACK_VISION_DEBUG_SAVE=1` keeps it only for debugging). Findings become `photo:*` ledger items with `source: photo` and lower trust. Fixed rules raise safety: a red oil, coolant or brake light, or a hot temperature gauge, gives at least DO_NOT_DRIVE. A photo never lowers safety.
  - **Voice**: `POST /api/v1/voice/ask` (flag `LYLO_HACK_VOICE`). WAV is accepted directly; other formats are converted with ffmpeg. Transcription uses `muse-voice-transcribe-1.0` and the audio is never stored. The question is answered against the scan's ledger with the same citation and never-lower rules. Every reply includes a `safety_notice`.
- Models (verified in the models list and on dev.meta.ai docs; all three were called live today):
  - `muse-spark-1.3`: vision (`image_url` data URL in Chat Completions), Detective, and voice answers.
  - `muse-voice-transcribe-1.0`: `POST /v1/asr/transcribe` (multipart), $0.18/hour of audio.
- Live calls this batch: 6, about $0.034 estimated, 0 429s.
  - Full run, 4 calls:
    - vision: 2.9 s, $0.0049. Found an amber check-engine light, a red oil light and a gauge near H, all high confidence.
    - detective with photo items: 6.6 s, DRIVE_SHORT_DISTANCE_ONLY raised to DO_NOT_DRIVE, citing the photo items and noting the sensor coolant reading contradicts the gauge.
    - ASR: 2.3 s.
    - voice answer.
  - Voice rerun, 2 calls, after a fix: $0.0095.
- Bug found by the live run, then fixed (a639e8c): the voice ledger's `rule:safety` still showed the pre-photo level, so the answer said "drive only a short distance" while the final level was higher. The photo floor is now applied before the ledger is built, and voice replies carry `safety_notice`. The rerun answered "Do not drive this car home", agreeing with DO_NOT_DRIVE. Both runs are kept in evidence/.
- Test assets are synthetic: an AI-generated generic dashboard (no people or plates) and an espeak-ng robot voice.
- Dell: Pillow 12.3 installed into `hackathon/server/.venv`. `LYLO_HACK_VISION=1` and `LYLO_HACK_VOICE=1` were added to `.env` (still mode 600, gitignored).
- Restart: `pm2 restart lylo-hack` twice. PM2 env keys and the other apps' PIDs and restart counts were unchanged; the key is not in the PM2 env or logs.
- Checks on :5088: `/healthz` shows muse, vision and voice on. Bad PID 400, `{}` 400, non-image 400, voice with no scan 400, bad audio 400. No stored photos.
- Other services: :3000/health, :8010/docs and :8798/health all 200.
- Tests: Python 48/48 (box and Dell), Node 33/33.
- Expo export (scratch copy on the Dell, deleted): `npm ci` and `expo export --platform android --clear` OK. The bundle is 2.07 MB Hermes and contains "Muse Detective".
- Limits:
  - gunicorn `--timeout 30`. A photo call with `detective=1` makes two model calls in a row, so a slow API could hit that limit, and the client would get a 502 and keep the rule result. The live run took about 9.5 s.
  - The phone screens for taking a photo and recording a question are not built yet; only the server routes are.

## 2026-10-28, ~3:00–3:30 AM PDT: v0.4.4, Snap the dash + Ask out loud on the phone (Grok Bot)
- Phone side of the existing vision/voice routes: `hackathon/mobile-bridge/src/dashVoice.js` (logic, Node-tested) and `DashVoicePanel.js` (UI), rendered by `SimpleResults` under the verdict. Flags `EXPO_PUBLIC_LYLO_DASH_PHOTO` / `EXPO_PUBLIC_LYLO_VOICE_ASK`, unset = old behavior. A dash photo can only raise the shown verdict; voice never changes it and the safety notice is shown above every answer; unverified answers are withheld.
- Gunicorn 30 s note above is stale: the PM2 config has used `--timeout 60` since v0.4.0. The phone uses detective=0 for the dash call and client timeouts of 45/50 s with plain fallback messages.
- Server bug found and fixed (`voice.py`): non-WAV audio converted by ffmpeg through a pipe had a placeholder WAV size, so it read as hours long and was rejected with 400. Android records AAC, so every phone question would have failed. Re-wrapped with a correct header; WAV path unchanged.
- Baseline edits (logged in NEW_WORK.md): expo-av dependency, RECORD_AUDIO unblocked + mic usage strings, v0.4.4 / versionCode 8, labels, new ui-test.
- Tests: Node 81/81, jest UI 30/30, baseline node 16+19, Python 100/100. `expo export --platform android --clear` with both flags on: 2.25 MB Hermes bundle containing the new screens.
- Not yet tested: a real phone (camera, mic permission prompts, actual AAC from the device's MediaRecorder, cellular through the tunnel).
- Deployed Oct 28 ~3:25 AM PDT: `pm2 restart lylo-hack` only (no --update-env, no save); env keys identical (25), every other PM2 app same PID and restart count. :5088/healthz 200 (muse, vision, voice on), :3000/health 200, :8010/ 200 (/health 404 as expected), :8798/health 200.
- Live (in-process test client on the Dell, phone-shaped requests): 3 Muse calls, about $0.014, 0 429s. Dash photo (detective=0): 200, 3 findings, DO_NOT_DRIVE, 29.5 s. Voice with ffmpeg-made ADTS AAC (what Android records): 200, transcript correct, answer verified with 9 cites, safety notice, 33.6 s. Both slower than Oct 26 (3–10 s) but under the 45/50 s client and 60 s gunicorn limits; if Meta stays this slow, consider gunicorn --timeout 90 and client 75 s.

## 2026-10-28, ~3:35–4:15 AM PDT: v0.4.5, No adapter? Start here (Grok Bot)
- Chris: the app should work without the OBD sensor for everyday people, and should have a suggestion box for OBDLink adapters.
- Built: a no-adapter screen and Home entry (flag `EXPO_PUBLIC_LYLO_NO_ADAPTER`). Server `POST /api/v1/noadapter/check` (flag `LYLO_HACK_NO_ADAPTER`). No-scan voice questions when that flag is on. An OBDLink card using facts from obdlink.com. Details are in NEW_WORK.md under v0.4.5.
- Safety: rule floors on the owner's words (regex with simple negation), applied before AI. The phone runs the same rules offline. Never "safe to drive" without sensor data. AI can only raise the level. Citations are checked and unverified claims withheld.
- Bluetooth is not prompted at launch (verified in code plus a UI test). No change was needed.
- Tests: Python 117/117, Node 92/92, jest UI 37/37 (box), baseline node 16 and 19. `expo export --platform android --clear` with no-adapter, dash and voice flags on: a 2.29 MB Hermes bundle that contains the screen and the three OBDLink links.
- Deployed at about 4:10 AM PDT. Added `LYLO_HACK_NO_ADAPTER=1` to the gitignored hackathon/server/.env, then ran `pm2 restart lylo-hack` only (no --update-env, no save). PM2 env keys are identical (25) and the other apps are unchanged. Health: :5088/healthz 200 (no_adapter on), :3000 200, :8010/ 200 (/health 404 as expected), :8798 200.
- Live (in-process test client on the Dell): 2 Muse calls, about $0.012, 0 429s.
  - Text + P0300 (Accord shakes at idle, "no smoke"): INSPECT_SOON. The answer is verified with 9 cites and mentions the lower confidence. The negation worked (no smoke floor). 21.1 s.
  - No-scan voice question ("burning smell, brakes grinding, can I drive to work?"): DO_NOT_DRIVE from the rule floors. The answer is verified, says do not drive, and has no unverified claims. 20.9 s.
- Not tested yet: a real phone (Say it instead, the mic prompt, the Home card in an APK).

## 2026-10-28, ~3:50–4:55 AM PDT: v0.4.6, Watch how, nearest store, first-run setup (Grok Bot)
- Chris: "you're the lead… I'm the idea guy, you're my builder." Built from the demo-script gap check.
- Fixed: NEW_WORK.md had combined rows (two files in one row), so `scripts/check-baseline-integrity.sh` failed on `noAdapterHome.test.js`. Now one file per row; the script passes.
- Watch how: a YouTube search for "<year make model> <repair or part>" from the remembered vehicle. No API or key. Shown on Code detail and on every repair price card.
- Find nearest store: Google Maps searches for AutoZone, O'Reilly and NAPA "near me". No location permission; the store price buttons are kept.
- No adapter screen: the "less accurate without live sensor data" note is now in the top card, before the first check.
- First-run setup: 3 skippable questions, shown once, re-open from Home > Tools. Only the first-run auto-open (and the Tools > Setup button) is behind `EXPO_PUBLIC_LYLO_FIRST_RUN=1`. Uses the existing `lylo.viewMode` and `lylo.vehicle` keys.
- Recalls: wording is "recalls for your model" everywhere; never implies the exact VIN.
- Not flagged (correction after Vera's review): Watch how, nearest store, RepairLinks on Code detail, the no-sensor note, the recall wording and the Setup route show in every build. With no flags set the app is not identical to v0.4.5.
- No server code changed, so no restart.
- Tests: Node 99/99, jest UI 44/44 (box), baseline node 16 and 19. `expo export --platform android --clear` with first-run, no-adapter, dash and voice flags on: a 2.31 MB Hermes bundle that contains the new screens.
- Not tested yet: a real phone (YouTube and Maps opening in their apps, the setup flow on an install).

## 2026-10-28 ~04:00 PT: v0.4.7 docs, Try a demo scan, test APK
- README.md for judges (new). docs/DEMO_SCRIPT.md replaced with script v2. Truck numbers come only from evidence/detective_cold_engine_truck_like.json (muse-spark-1.3, 7429 ms, 15 of 19 ledger items cited, SAFE_TO_DRIVE, agreed). The synthetic test fixture's numbers are not quoted.
- v0.4.7: Try a demo scan (flag EXPO_PUBLIC_LYLO_DEMO on the phone, LYLO_HACK_DEMO=1 on the server; both default off, and the routes return 503 when off). It replays the truck, cleared-codes used car and 260 °F overheat scans through the real pipeline. The AI-vs-rules proof uses a labeled simulated AI answer (no model call) fed into the real merge code; the rules win.
- Vera fixes (prior commit): "parts searches for your model", "videos for your model", https-only store/video links, and the flag docs corrected.

## 2026-10-28 ~05:45 PT: VIN lookup timeout fix (first real-phone test)
- v0.4.7 test APK: https://zion.thegoodneighborguard.com/lylo-047-366e5aeb54.apk (70,149,550 bytes; built on the box with Gradle assembleRelease, script `/workspace/androidsetup/build047.sh`, all v0.4.7 flags on).
- Chris installed it on his phone. "Look up my car" failed: the app gives up at 12 s. Cause: the Dell's outbound calls tried a broken IPv6 route first and stalled 12-40 s before falling back to IPv4 (measurements in "IPv6 stall evidence" below).
- Fix: `lylo_hack/netpref.py`, enabled with `LYLO_HACK_FORCE_IPV4=1` (unset = unchanged). `gunicorn.conf.py` switches to gthread with 8 threads so a slow photo call cannot block a VIN lookup (made env-driven in the Vera fix below).
- Verified on Chris's phone afterwards: the lookup returned the 1998 Ford E-450 and 2 recalls for the model.

## 2026-10-28 ~06:20 PT: v0.4.8 "Not my engine?" (owner-set engine)
- Why: Chris's real truck VIN decodes on NHTSA vPIC as a 1998 Ford E-450 with a 10.3L Caterpillar diesel, but the truck runs the 6.8L V10 Triton gas engine (Chris read it off the engine). Diesel advice on a gas truck is a safety and trust problem.
- Phone (flag `EXPO_PUBLIC_LYLO_ENGINE_OVERRIDE=1`): "Not my engine?" under the car card on Your car. Pick Gas, Diesel, Hybrid/EV or Not sure, and optionally type the engine. Saved on the phone as `lylo.engineOverride` (same VIN as `lylo.vehicle`). The card then says "Engine set by you: ..." and keeps the NHTSA decode in small text. Live/detective, dash photo, voice, no-adapter and Photo Helper requests send `engine_user`, `fuel_user`, `engine_source=user`. Not sent for a scan whose VIN differs from the saved car. The demo scans are bundled sample cars, so they never get the owner's engine.
- Server (flag `LYLO_HACK_ENGINE_OVERRIDE=1`): validates the fields (plain text, 60 chars, fixed fuel list), puts the owner engine in the ledger in place of the decoded engine (labeled "set by owner"; after the Vera fix below the vPIC engine never reaches the model and goes back to the phone only as `vehicle_engine.nhtsa_engine`), and adds a `veh:engine_user` item telling Meta AI not to give diesel advice unless the fuel is diesel. `/vin/decode` adds a cautious `engine_check_hint` when vPIC says diesel for a Ford E/F-series ("may be wrong for this VIN"). We do not claim anything about which engine a VIN code means.
- SetupScreen does not show a car card (it saves and moves on), so the control is only on Your car. The Simple/Mechanic results "Engine (factory)" row still shows the decode; not changed in this step.
- Flags off: requests and screens are the same as v0.4.7 (tests check the payload byte for byte). The build label and version (0.4.8, versionCode 12) change in every build.
- Tests: Python 134/134, Node 110/110, jest UI 54/54 (box), baseline node 16 and 19.
- APK v0.4.8 (all flags on, including the new one): https://zion.thegoodneighborguard.com/lylo-048-6587e26e51.apk (70,153,621 bytes, sha256 e6a5594d…5d4c, same signing cert fac61745…3b9c). Built with `/workspace/androidsetup/build048.sh` (build047.sh + the new flag).

## 2026-10-28 ~06:30 PT: Vera review fixes for 523f0a7 and 329409e
- Engine override: with the owner's engine set, the decoded (vPIC) engine is now removed from every ledger item and from the Photo Helper vehicle, so it is in nothing sent to Meta AI. It is returned to the phone only: `vehicle_engine.nhtsa_engine` on live/detective and deterministic rebuilds, `vehicle.nhtsa_engine` on Photo Helper. The phone's small NHTSA text comes from its own saved decode. New test `test_decoded_engine_never_reaches_model` checks the captured model messages, the ledger, `apply_to_items`, `apply_to_decode` and `vin.prompt_line`. Flag off: unchanged (the existing test still sees the decoded engine in the prompt).
- gunicorn: `gunicorn.conf.py` is now flagged. `LYLO_HACK_GTHREAD=1` gives gthread with `LYLO_HACK_THREADS` threads (default 8); unset/0 gives sync with 1 thread (gunicorn's defaults). PM2's env does not carry the flag, so the conf reads these two names from `hackathon/server/.env` (process env wins). The Dell `.env` has `LYLO_HACK_GTHREAD=1` (backed up first). `docs/PUBLIC_API.md` path line fixed.
- Thread-safety check for gthread: the security `Limiter` opens a new SQLite connection per call and does check-then-increment inside `BEGIN IMMEDIATE`, so it is atomic across threads and workers. `vin._cache` is a plain dict: a single get and a single set (each atomic in CPython); a race can only cause a duplicate NHTSA fetch, never a wrong or torn value, so no lock was added. `netpref` patches `socket.getaddrinfo` once at startup. Baseline module dicts (`personas/router._COMPILED`, quick_check tables) are filled at import and only read after. No other module-level mutable state in `lylo_hack`.
- IPv6 stall evidence (measured by Ember on the Dell, Oct 28): Python urllib to vpic.nhtsa.dot.gov took 40.28 s with default resolution vs 0.31 s IPv4-only. LYLO `vin.decode` took 12.29 s and recalls 12.13 s before the fix vs 0.35 s and 0.12 s after.

## 2026-10-28 ui-polish: logged uiV2.test.js in NEW_WORK.md (fixes the integrity check), replay badge pinned as a sticky header, one badge only.
