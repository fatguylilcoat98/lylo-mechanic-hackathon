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
