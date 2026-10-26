#!/usr/bin/env bash
# Fails (exit 1) if any file under baseline/ differs from the baseline tag
# (committed or uncommitted) without its path appearing in the
# "## Modified baseline files" section of NEW_WORK.md.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
BASE=baseline-pre-hackathon
git rev-parse -q --verify "$BASE" >/dev/null || { echo "missing tag $BASE"; exit 2; }
section=$(awk '/^## Modified baseline files/{f=1;next} /^## /{f=0} f' NEW_WORK.md)
changed=$( { git diff --name-only "$BASE" -- baseline/; git ls-files --others --exclude-standard -- baseline/; } | sort -u)
fail=0
for f in $changed; do
  if ! grep -qF -- "$f" <<<"$section"; then echo "UNLOGGED baseline change: $f"; fail=1; fi
done
[ "$fail" -eq 0 ] && echo "OK: baseline integrity ($(echo -n "$changed" | grep -c . || true) logged change(s))"
exit $fail
