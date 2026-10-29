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

## 2026-10-28 ~15:50 PT: README "Try it in 2 minutes"
- README: new "Try it in 2 minutes" section for judges (APK, then setup, then Try a demo scan, then Mechanic view, then AI vs rules; plus a no-phone path). Docs only, no code change.
- Gap re-check at 5773f7e (verified in code): the demo script's Detective numbers already match `detective_cold_engine_truck_like.json` (7429 ms, 15 of 19 cited, 3 causes, SAFE_TO_DRIVE). First-run setup (flag `EXPO_PUBLIC_LYLO_FIRST_RUN=1`) was built in v0.4.6. The No Adapter accuracy note sits at the top of the screen, before the first check. "Recalls for your model" is in the app and script. "Circles it on your own photo" is in the script. The baseline integrity check passes.

## 2026-10-28 ~16:30 PT: v0.5.0 Point and prove (flags LYLO_HACK_PROVE=1 / EXPO_PUBLIC_LYLO_PROVE=1; off = unchanged)
- `lylo_hack/prove.py`:
  - **Prediction first.** The Detective (Muse, when `LYLO_HACK_MUSE=1`) proposes one prediction `{hypothesis, pids, condition, threshold, window_s, if_fails}`. If it gives none, or a vague or invalid one, LYLO's rules propose instead. `validate()` rejects hedging words, unknown PIDs, missing or non-numeric thresholds, a window outside 5-600 s and an empty if_fails.
  - **Model can't self-certify.** Any status/measured/proven/verified field the proposer sends is stripped.
  - **Lock.** `ProveLedger` is append-only and hash-chained (seq, time, body, prev sha256 to sha256). There's no update or delete, and `verify()` detects tampering. The lock happens before any reading is accepted.
  - **Checker.** `check()` is deterministic, not the model. Only readings with lock < t <= lock + window count. Result: HELD, FAILED, or LOCKED ("not proven yet") when there's no data for those PIDs. The first HELD/FAILED is final.
  - **On FAILED** the tested hypothesis drops a confidence step and is marked `prediction_failed`. It's never dropped, and it's added back if it wasn't in the list.
  - **Misfire.** P0300-P0308 from the car, plus Mode 06 per-cylinder counts when the scan has `mode06.supported`. Otherwise `"not reported by this vehicle"`. Ledger items `misfire:P030N` and `m06:misfire:cylN`. An active misfire raises the safety floor to DRIVE_SHORT_DISTANCE_ONLY (it never lowers).
  - **Safety.** The never-lower merge and the rule override stay on top. A HELD or FAILED outcome never changes the safety level.
  - **Output.** `detective.prediction = {text, status: LOCKED|HELD|FAILED, measured}`, plus `detective.prove` (session id, lock sha256, ledger, chain_ok).
- Routes (503 when off):
  - `POST /api/v1/prove/check {session_id, samples:[{dt, pid, value}|{dt, dtc}]}`. dt is seconds after the server lock, and readings dated in the future are dropped.
  - `POST /api/v1/prove/replay {case}`.
  - `/api/v1/live/live` locks a prediction when on.
- **REPLAY.** Recorded sessions go through the same diagnose, lock and check code, and the server always adds `replay.badge = "REPLAY"` and a SYNTHETIC/RECORDED label. Bundled sessions (both SYNTHETIC, made-up data):
  - `prove_misfire_synthetic`: cylinder 3, gives HELD
  - `prove_lean_fail_synthetic`: lean prediction, gives FAILED and a downgrade
- **SAM 3.1** (`lylo_hack/sam.py`, flag `LYLO_HACK_SAM=1`, off): on the Photo Helper, it adds `sam.boxes` (box tokens parsed from the documented stream; masks dropped). The Muse circles are unchanged, and any error just leaves the circles. `scripts/sam_probe.py` is a no-spend GET /v1/models check. Reachability with our key is UNKNOWN: the key is only on the Dell, which was out of scope.
- Phone: `hackathon/mobile-bridge/src/prove.js` (client and view helpers). The phone never sets a status, and `asScan()` always sets the REPLAY demoLabel for a replay. No new screens; UI v2's ResultsV2 renders it.
- Tests: server `test_prove.py` (22) and `test_sam.py` (2), adversarial cases included. mobile-bridge `prove.test.js` (5).

## v0.4.8 Point and prove: fixes for Vera's NOT PASS (2026-10-28)
- prove.evaluate holds a lock per session across the outcome check, the ledger append and setting the outcome, so concurrent checks can only record one outcome. Test: 20 rounds of 8 threads.
- The server keeps the ledger head (sha256 and entry count) for each session. chain_ok needs the chain to verify and its tail to match that head, which catches a cut-off tail. The head_sha256 is returned.
- Thresholds must be finite numbers: NaN and inf are rejected.
- A hypothesis or if_fails text that claims proof ("confirmed", "proven", "verified", "definitely", "sensor shows", ...) is rejected.
- Malformed raw_dtcs/raw_pids entries are skipped. /prove/check returns 400 with a reason instead of 500 when samples are malformed.
- test_live, test_sam and test_prove force LYLO_HACK_PROVE/SAM off, and test_sam uses mock.patch.dict.
- Mobile: the replay demoLabel no longer starts with "REPLAY ·", because ReplayBadge adds that prefix. This fixes "REPLAY · REPLAY".
- README: known limit added. Client readings are trusted as measured, and the session id acts as a bearer token.

## v0.4.8 Point and prove: Vera round 2 should-fixes (2026-10-28)
- app.py: JSON nested too deeply (a RecursionError inside get_json) returns 400 instead of 500. Bad JSON on /prove/check returns 400 (it used to be 404). /prove/check returns 400 when a reading's `value` is not a finite number (string, bool, null, list, NaN).
- prove.py: the proof-claim check now matches phrases ("confirmed by", "proven", "verified by/with", "definitely is/has", "proof:", ...). Bare "certain"/"verified" are no longer matched, so "Coolant stays below 90C under certain loads" passes. Text is folded before the check: NFKC, zero-width chars stripped, Cyrillic/Greek look-alikes mapped, accents dropped.
- `ProveLedger.verify(head=, n=)` checks the server-held head sha and entry count, and `chain_ok` uses it. Tests: test_prove.py VeraRound2 (5).
## 2026-10-28 ui-polish: logged uiV2.test.js in NEW_WORK.md (fixes the integrity check), replay badge pinned as a sticky header, one badge only.

## v0.5.0: merged ui-polish into v048 (2026-10-28)
- UI v2 (flag `EXPO_PUBLIC_LYLO_UI_V2=1`) and Point and prove (`LYLO_HACK_PROVE=1` / `EXPO_PUBLIC_LYLO_PROVE=1`) are both kept behind their flags. With the flags off, the old screens render.
- Wiring checked with a new jest test in `uiV2.test.js` ("v0.5.0 wiring"): `prove.asScan(replay)` → `demoLabel` → ReplayBadge is pinned as a sticky header with exactly one "REPLAY ·". PredictionBanner shows the server's `detective.prediction` text and measured value: HELD → prediction-held, LOCKED → prediction-pending.
- Bug fix found by that test: `prove.asScan` did not set `serverDiagnosis.source = 'server'`, so `resultsView.serverResult` returned null and a prove replay would have rendered a blank results screen. Fixed in `hackathon/mobile-bridge/src/prove.js`.
- Version bump to 0.5.0 (versionCode 13): `baseline/mobile/app.json`, `baseline/mobile/package.json`, `baseline/mobile/package-lock.json`, `baseline/mobile/src/screens/HomeScreen.js` ("TEST BUILD v0.5.0"), `baseline/mobile/ui-tests/screens.test.js`, `baseline/mobile/ui-tests/uiV2.test.js`, `hackathon/mobile-bridge/src/ui2/HomeV2.js`.

## v0.5.0 test isolation (2026-10-28)
- `hackathon/server/tests/conftest.py` clears LYLO_HACK_* feature flags before the test modules load, and `test_engine_user.py` defaults ENGINE_OVERRIDE to off. Before this, running the suite in a shell with the flags exported gave 4 failures (engine_user), then 5 more (noadapter/vin/voice) once those were fixed. These were flag-off tests inheriting the shell env, not code bugs. Each test turns on what it needs with mock.patch.dict.

## v0.5.1: V10 Triton fixes after Chris's real-truck run (2026-10-28)
Context: Chris ran v0.5.0 on his 1998 Ford E-450 (6.8L V10 Triton, gas) with an OBDLink MX+. Each change below is marked FLAG (behind a flag; flag off = old behaviour) or BUG FIX / CHANGES OLD BEHAVIOUR.
- VIN engine (CHANGES OLD BEHAVIOUR, label only): the decoded engine is labeled "VIN decoder says (unverified)" on the VIN card, Mechanic view, and in the Muse prompt line (`vin.prompt_line`, prompt wording changed). `vin.decode` adds `engine_label`, `engine_maker`, `engine_code` (VIN position 8). The parse is not mangling fields: vPIC itself maps Ford engine code S on a 1998 E-450 to a Caterpillar 3176 10.3L I6 diesel (DisplacementL 10.3, EngineCylinders 6, verified with partial-VIN decodes). FLAG LYLO_HACK_ENGINE_OVERRIDE: a Ford-specific hint for code S, 1997-2004 (`engine_user.HINT_FORD_S`) names the 6.8L V10 and points to "Not my engine?". The owner engine shows as "(set by owner)" in Mechanic details.
- V10 misfire (BUG FIX): `prove.py` read the cylinder as the last digit, so P0310 became cylinder 0 and rule predictions for cylinder 10 built "P03010". Now covers P0300-P0312 and Mode 06 cylinders 1-12. `baseline/backend/safety/safety_classifier.py` used `startswith("P030")`, which missed P0310-P0312; it now matches P0300-P0312, so P0310 raises safety the same as P0301. `baseline/mobile/src/data/dtcCodes.js` adds P0309-P0312 (2-digit padding). New `hackathon/mobile-bridge/src/mode06.js` (Mode 06 misfire decode, MID A2+cyl-1; not yet called by the live scan, and a 1998 E-450 is J1850 PWM, so it has no Mode 06).
- Dash photo (FLAG, opt-in LYLO_HACK_BENIGN_LIGHTS=1; unset = v0.5.0 behaviour exactly. Wording corrected after Vera round 1; it was first shipped default-on and called a kill switch): seatbelt, door ajar, headlight/high beam, washer fluid, turn signal, and cruise are noted (`benign_notes`, ledger `safety_note`) but never raise the level. Before, an amber seatbelt light raised the level to INSPECT_SOON. Parking brake, check engine, oil, temperature, battery, brake, ABS, and airbag still escalate. A photo still only ever raises, never lowers. New LIGHTS enums: washer_fluid, turn_signal, cruise_control, parking_brake.
- Results screen (BUG FIX, presentation): the literal "THE PROOF \u00B7 MUSE DETECTIVE" JSX escape is fixed. The duplicate cause list under Mechanic details (UI v2) is removed. The proof list uses plain labels (`friendly`), not raw PID names. "Hypotheses (Meta AI, ok)" is now "Possible causes (Meta AI)". Live data shows "190 °F" once, and the raw value only when it differs. Row labels no longer wrap to "Serve r" / "Adapte r". Readiness monitors use plain names. Mechanic view live-data rows keep raw PID names on purpose (mechanics, existing tests).
- Run the proof: new `hackathon/mobile-bridge/src/ProvePanel.js`. The Demo screen (already behind EXPO_PUBLIC_LYLO_DEMO) gets "Run the proof", which calls /api/v1/prove/replay and shows the REPLAY badge, the server's HELD/FAILED PredictionBanner, and the full results body. FLAG EXPO_PUBLIC_LYLO_PROVE=1: the results screen gets "Run the proof", which calls /api/v1/prove/check for the scan's locked session. This closes the v0.5.0 gap where prove.js was in no screen and so not in the APK.
- Tests: `hackathon/server/tests/test_v051.py` (12; 8 fail on v0.5.0 code), `hackathon/mobile-bridge/test/v051.test.js` (2), `baseline/mobile/ui-tests/v051.test.js` (5). Fixture `hackathon/server/evidence/prove/replay_misfire_synthetic.json` (SYNTHETIC case, Muse off, local test server).
- Version 0.5.1, versionCode 14 (app.json, package.json, package-lock.json, HomeScreen.js, HomeV2.js, screens/uiV2 tests, android/app/build.gradle by hand, since android/ is gitignored).

## v0.5.1: Vera round 1 fixes (2026-10-28)
- MUST (CHANGES v0.5.1 behaviour back to v0.5.0 by default): `vision.benign_on()` is on only when `LYLO_HACK_BENIGN_LIGHTS == '1'`. With it unset, the LIGHTS list, the model schema, `to_items`, `floor_for`, and the `analyze` output are byte-for-byte v0.5.0. The new names (washer_fluid, turn_signal, cruise_control, parking_brake), `benign_notes`, and the ledger `safety_note` exist only with the flag on (`vision.lights()`, `vision.schema()`; app.py uses `vision.lights()`). The test loads vision.py from 58995b9 out of git and compares more than 1,000 finding combinations plus a full `analyze` call.
- conftest now clears LYLO_HACK_BENIGN_LIGHTS, so the suite passes with =0 or =1 exported.
- FLAG (BENIGN=1): a red `parking_brake` label hits the same RED_STOP floor as `brake_system` (DO_NOT_DRIVE at medium/high confidence, INSPECT_SOON at low), because the red Ford BRAKE lamp means either.
- Proof integrity (BUG FIX): when a prove record has `chain_ok !== true` or no `head_sha256`, the banner shows "RECORD INTEGRITY CHECK FAILED" (testID prediction-integrity) and never "The car proved it right". This applies to Demo replays (ui2/model.js) and results checks (ProvePanel). Predictions with no prove record at all are unchanged.
- BUG FIX: `baseline/backend/safety/safety_classifier.py` line 24 uppercases and strips codes, so p0310 is classified like P0310 (the test fails on the previous code).

## v0.5.1: Vera round 2 fixes (2026-10-28)
- MUST (BUG FIX, server): `prove.lock()` now writes `chain_ok` (ledger verified against the head) and `head_sha256` into `detective.prove` right after the lock entry is appended. Before, a healthy just-locked prediction had neither field, and the aa6ab82 UI showed "RECORD INTEGRITY CHECK FAILED" on every one. Test: `LockChainFields` in tests/test_v051.py.
- MUST + should-fix 1 (UI): one shared rule `prove.bannerStatus` / `prove.bannerOf` (mobile-bridge/src/prove.js), used by both `ui2/model.js` and `ProvePanel`:
  - LOCKED or not checked yet, with or without chain fields: pending.
  - `chain_ok === false`: integrity failed.
  - HELD/FAILED with a prove record but no valid hex head: integrity failed.
  - HELD/FAILED with no prove record (missing or null), or chain not confirmed `=== true`: new "RESULT NOT VERIFIED" state, never "The car proved it right".
  - "Measured" is shown only for a verified HELD/FAILED.
  - Jest cases use the exact `lock()` output saved in `hackathon/server/evidence/prove/lock_shape_synthetic.json` (SYNTHETIC P0310 scan), plus a 35-case agreement check between model.js and the helper.
  - Two v0.5.0 uiV2 tests that sent HELD with no prove record now include a verified record (`baseline/mobile/ui-tests/uiV2.test.js`).
- Should-fix 2 (flaky test): 20 runs with BENIGN=0 and 20 with BENIGN=1 (190/190 each), each test file alone, and reverse file order all passed, so the failure did not reproduce. Likely cause (inferred): `test_security` rate-limit tests posted 3-4 times against per-minute fixed windows on the real clock, so a minute boundary mid-test resets the count. Those tests now pin the limiter clock 30 s into a window. No env dependence was found; BENIGN is already cleared in conftest.
- Should-fix 3: the 58995b9 parity tests fail loudly when git history is missing. They skip only with `LYLO_ALLOW_NO_GIT=1`.
