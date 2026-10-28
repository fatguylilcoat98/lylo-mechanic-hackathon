# Ember 2026-10-28: threads so one slow Muse call cannot block quick lookups. Delete this file to revert.
worker_class = "gthread"
threads = 8
