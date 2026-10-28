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
