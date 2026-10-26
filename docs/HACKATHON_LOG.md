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
