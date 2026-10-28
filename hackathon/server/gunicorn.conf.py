# Ember 2026-10-28: optional threads so one slow Muse call cannot block quick lookups.
# Auto-loaded by gunicorn because PM2's lylo-hack cwd is hackathon/server.
# Flag LYLO_HACK_GTHREAD=1 -> worker_class "gthread" with LYLO_HACK_THREADS threads (default 8).
# Unset/0 -> "sync", threads 1: exactly gunicorn's defaults (the pre-fix behavior).
# PM2's env does not carry the flag, so it is read from hackathon/server/.env here the same way
# the app reads it (process env wins; only these two names are read; no value is logged).
import os

_ENV = os.environ.get("LYLO_HACK_ENV_FILE") or os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")


def _flag(name, default=""):
    if name in os.environ:
        return os.environ[name]
    try:
        if _ENV != "none" and os.path.isfile(_ENV):
            for line in open(_ENV, encoding="utf8"):
                k, sep, v = line.strip().partition("=")
                if sep and k.strip() == name:
                    return v.strip()
    except OSError:
        pass
    return default


if _flag("LYLO_HACK_GTHREAD") == "1":
    worker_class = "gthread"
    try:
        threads = max(1, int(_flag("LYLO_HACK_THREADS", "8")))
    except ValueError:
        threads = 8
else:
    worker_class = "sync"
    threads = 1
