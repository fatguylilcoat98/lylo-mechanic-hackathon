# Public API (v0.4.0): lylo-api.thegoodneighborguard.com

The Android app reaches the Dell hackathon server over HTTPS through the existing
Cloudflare Tunnel, so it works on cellular data anywhere. With no server (no signal,
server down, 401/413/429/5xx, or slower than 20 s) the app uses its on-phone engine,
exactly as v0.3.0 did.

## Path
phone --HTTPS--> Cloudflare edge --tunnel--> cloudflared (Dell, PM2 "tunnel") --> http://127.0.0.1:5088 (PM2 "lylo-hack", gunicorn -w 2 --timeout 60)

TLS terminates at Cloudflare; the tunnel leg is encrypted by cloudflared. The server
still binds loopback only.

## Guard (hackathon/server/lylo_hack/security.py)
| Control | Default | Env |
|---|---|---|
| App key header `X-LYLO-App-Key` on every `/api/` route | required | `LYLO_HACK_REQUIRE_APP_KEY=1` |
| Accepted keys stored only as SHA-256 digests | — | `LYLO_HACK_APP_KEY_SHA256` |
| No digest configured | 503 on `/api/` (fail closed) | |
| All `/api/` calls per client IP | 30/min | `LYLO_HACK_RL_IP_PER_MIN` |
| Muse-backed calls per client IP | 10/min | `LYLO_HACK_RL_IP_MUSE_PER_MIN` |
| Muse-backed calls per app key | 10/min, 100/day | `LYLO_HACK_RL_KEY_MUSE_PER_MIN`, `..._PER_DAY` |
| Muse-backed calls, whole server (spend cap) | 300/UTC day | `LYLO_HACK_MUSE_DAILY_CAP` |
| Request body | 6 MB (scan JSON 256 KB, photo 5 MB, audio 4 MB) | |
| CORS | none (no `Access-Control-*` headers; the app is not a browser) | |
| `/healthz` | open, flags only, no secrets | |

Client IP: `CF-Connecting-IP` is trusted only when the TCP peer is loopback (cloudflared on
the same host); otherwise the socket address is used. Counters live in SQLite
(`LYLO_HACK_RATELIMIT_DB`, default `/tmp/lylo-hack-ratelimit.sqlite`) so both gunicorn
workers share them. Over a limit: 429 with `Retry-After`. Per-IP limits are checked
before the key, so key guessing is throttled too.

Worst-case spend at the cap: 300 calls/day x roughly $0.006 (largest observed Muse call,
photo + Detective) ≈ $1.80/day. Lower `LYLO_HACK_MUSE_DAILY_CAP` to tighten.

## Honest limits
- The app key is compiled into the APK (`EXPO_PUBLIC_LYLO_APP_KEY`). Anyone with the APK can
  extract it. It is a speed bump that keeps scanners and casual callers out, not a secret.
- The real protections: the Meta Model API key exists only in the Dell's gitignored
  `hackathon/server/.env` (never in the app), plus the per-IP, per-key and daily caps.
- To rotate: generate a new key, put its SHA-256 in `LYLO_HACK_APP_KEY_SHA256` (comma-separate
  old and new during rollout), rebuild the APK with the new key, then drop the old digest.

## Where the key lives
- Plain key: on the build box only, `~/.lylo/app_key` (mode 600). Never committed, never on the Dell.
- Digest: Dell `hackathon/server/.env` (`LYLO_HACK_APP_KEY_SHA256`).
