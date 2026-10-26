# Hackathon build log (times are Pacific)

Each work session gets one entry: start/end time, who/what, commits, files, and the result (verified, or not yet tested).

## 2026-10-26, 6:15–6:30 AM PDT: repo setup (before the build opened at 9 AM PT)
- Imported the pre-hackathon code into `baseline/` as commit 867eece and tagged it `baseline-pre-hackathon`.
- Excluded: node_modules, __pycache__, keystores (including `mobile/android/app/debug.keystore`), .env*, the old .git, push_to_github.ps1, lylo_files.json (a base64 dump of the repo) and vicore's demo.sqlite (regenerable from fixtures).
- Added NEW_WORK.md, this log, `scripts/new-work-report.sh`, `scripts/check-baseline-integrity.sh` and `hackathon/.env.example`.
- No feature code was written and nothing was pushed.
