"""Public-API guard: app key, client IP, rate limits, daily Muse spend cap.

Flags/config (read per request from env, loaded from the gitignored .env):
  LYLO_HACK_REQUIRE_APP_KEY   default "1" (safe). "0" disables the key check (local dev only).
  LYLO_HACK_APP_KEY_SHA256    comma-separated SHA-256 hex digests of accepted X-LYLO-App-Key values.
                              Plain keys are never stored server-side. If the check is on and no
                              digest is configured, every /api/ call gets 503 (fail closed).
  LYLO_HACK_RL_IP_PER_MIN     default 30   all /api/ calls per client IP
  LYLO_HACK_RL_KEY_MUSE_PER_MIN  default 10   Muse-backed calls per app key
  LYLO_HACK_RL_KEY_MUSE_PER_DAY  default 100
  LYLO_HACK_RL_IP_MUSE_PER_MIN   default 10   Muse-backed calls per client IP
  LYLO_HACK_MUSE_DAILY_CAP    default 300  Muse-backed calls per UTC day, all callers (spend cap)
  LYLO_HACK_RATELIMIT_DB      default /tmp/lylo-hack-ratelimit.sqlite (shared by gunicorn workers)

Honest limits: a key shipped inside an APK can be extracted. It is a speed bump that keeps
casual scanners out. The real protections are the rate limits, the daily cap, and that the
Meta Model API key lives only on the server.
"""
import hashlib
import hmac
import os
import sqlite3
import time

LOOPBACK = {"127.0.0.1", "::1", "::ffff:127.0.0.1"}


def _int(name, default):
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def client_ip(remote_addr, headers):
    """Trust CF-Connecting-IP only when the TCP peer is loopback (i.e. cloudflared on this host)."""
    if remote_addr in LOOPBACK:
        cf = (headers.get("CF-Connecting-IP") or "").strip()
        if cf and len(cf) <= 64:
            return cf
    return remote_addr or "unknown"


def key_required():
    return os.environ.get("LYLO_HACK_REQUIRE_APP_KEY", "1") != "0"


def _digests():
    return [d.strip().lower() for d in os.environ.get("LYLO_HACK_APP_KEY_SHA256", "").split(",") if d.strip()]


def check_key(presented):
    """Returns (key_id|None, error|None). key_id is a short digest prefix, safe to log."""
    if not key_required():
        return "nokey", None
    digests = _digests()
    if not digests:
        return None, (503, "API key check is on but no key is configured on the server.")
    if not presented:
        return None, (401, "Missing X-LYLO-App-Key.")
    d = hashlib.sha256(presented.encode("utf8")).hexdigest()
    ok = False
    for want in digests:
        ok |= hmac.compare_digest(d, want)
    if not ok:
        return None, (401, "Invalid X-LYLO-App-Key.")
    return d[:12], None


class Limiter:
    """Fixed-window counters in SQLite so all gunicorn workers share them."""

    def __init__(self, path=None):
        self.path = path or os.environ.get("LYLO_HACK_RATELIMIT_DB", "/tmp/lylo-hack-ratelimit.sqlite")
        with self._db() as db:
            db.execute("CREATE TABLE IF NOT EXISTS hits (k TEXT PRIMARY KEY, n INTEGER, exp REAL)")

    def _db(self):
        db = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        return db

    def hit(self, rules, now=None):
        """rules: [(bucket_name, limit, window_s)]. Atomically checks all; increments only if all pass.
        Returns None if allowed, else (bucket_name, retry_after_s)."""
        now = now or time.time()
        db = self._db()
        try:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM hits WHERE exp < ?", (now,))
            keys = []
            for name, limit, window in rules:
                start = int(now // window) * window
                k = f"{name}:{start}"
                row = db.execute("SELECT n FROM hits WHERE k=?", (k,)).fetchone()
                if row and row[0] >= limit:
                    db.execute("COMMIT")
                    return name, max(1, int(start + window - now))
                keys.append((k, start + window))
            for k, exp in keys:
                db.execute("INSERT INTO hits(k,n,exp) VALUES(?,1,?) ON CONFLICT(k) DO UPDATE SET n=n+1", (k, exp))
            db.execute("COMMIT")
            return None
        finally:
            db.close()


def rules_for(ip, key_id, muse_route):
    r = [(f"ip:{ip}", _int("LYLO_HACK_RL_IP_PER_MIN", 30), 60)]
    if muse_route:
        r += [(f"ipmuse:{ip}", _int("LYLO_HACK_RL_IP_MUSE_PER_MIN", 10), 60),
              (f"key:{key_id}:min", _int("LYLO_HACK_RL_KEY_MUSE_PER_MIN", 10), 60),
              (f"key:{key_id}:day", _int("LYLO_HACK_RL_KEY_MUSE_PER_DAY", 100), 86400),
              ("global:muse:day", _int("LYLO_HACK_MUSE_DAILY_CAP", 300), 86400)]
    return r
