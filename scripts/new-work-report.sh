#!/usr/bin/env bash
# Prints hackathon-new files vs modified baseline files since the baseline tag.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
BASE=baseline-pre-hackathon
echo "Baseline: $BASE ($(git rev-parse --short "$BASE^{commit}")) .. HEAD ($(git rev-parse --short HEAD))"
echo
echo "== New / changed files outside baseline/ (hackathon work) =="
git diff --name-status "$BASE"..HEAD -- . ':(exclude)baseline/' || true
echo
echo "== Modified baseline files (must be logged in NEW_WORK.md) =="
git diff --name-status "$BASE"..HEAD -- baseline/ || true
echo
echo "== Uncommitted changes under baseline/ =="
git status --porcelain -- baseline/ || true
