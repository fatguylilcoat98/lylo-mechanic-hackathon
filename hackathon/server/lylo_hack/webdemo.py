"""Judge web demo (v0.6). Flag LYLO_HACK_WEB_DEMO=1 (unset = routes not registered, app unchanged).

GET  /try            one static page (no secrets in it; it never sees the app key)
POST /try/check      -> same handler as /api/v1/noadapter/check (JSON: text, codes, year/make/model, photo_evidence)
POST /try/dash       -> same handler as /api/v1/vision/dash (multipart: photo only; no scan, so no extra Detective call)

/try/* is outside /api/, so the app-key guard does not run; these routes have their OWN limits, using the existing
security.Limiter (security.py unchanged). Every /try call that can reach Meta AI also counts against the server-wide
global:muse:day bucket, so judges can never push total spend past LYLO_HACK_MUSE_DAILY_CAP.
Limits (env, defaults): LYLO_HACK_WEB_IP_PER_MIN=4, LYLO_HACK_WEB_IP_PER_DAY=25, LYLO_HACK_WEB_DAILY_CAP=150.
No audio upload on the web page (keeps cost down); the page uses the browser's own dictation if it has one.

Rate-limit DB: security.Limiter reads LYLO_HACK_RATELIMIT_DB (default /tmp/..., wiped on reboot). Deploy sets it in .env to a
persistent path, e.g. LYLO_HACK_RATELIMIT_DB=/home/chris/lylo-data/ratelimit.sqlite, so daily caps survive restarts.
The keyless /try IP limit trusts CF-Connecting-IP only from loopback (security.client_ip): cloudflared must be the only
loopback forwarder to :5088 (deploy check: ss -ltnp; ps).

Flag LYLO_HACK_JSON_PHOTO=1 (separate, NOT turned on by LYLO_HACK_WEB_DEMO; set both explicitly): /api/v1/noadapter/check also accepts photo_evidence as a JSON list
(before, a JSON body silently dropped it; the phone uses multipart and was not affected).
"""
import os

from flask import jsonify, request, send_from_directory

from . import security

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
CHECK_FIELDS = {"text", "codes", "year", "make", "model", "photo_evidence", "followup_answers"}


def enabled():
    return os.environ.get("LYLO_HACK_WEB_DEMO") == "1"


def json_photo_on():
    return os.environ.get("LYLO_HACK_JSON_PHOTO") == "1"  # independent of LYLO_HACK_WEB_DEMO (set each explicitly)


def _int(name, default):
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def rules(ip):
    return [(f"web:ip:{ip}:min", _int("LYLO_HACK_WEB_IP_PER_MIN", 4), 60),
            (f"web:ip:{ip}:day", _int("LYLO_HACK_WEB_IP_PER_DAY", 25), 86400),
            ("web:global:day", _int("LYLO_HACK_WEB_DAILY_CAP", 150), 86400),
            ("global:muse:day", _int("LYLO_HACK_MUSE_DAILY_CAP", 300), 86400)]


def install(app, limiter, check_handler, dash_handler):
    if not enabled():
        return

    def limited():
        ip = security.client_ip(request.remote_addr, request.headers)
        hit = limiter.hit(rules(ip))
        if not hit:
            return None
        resp = jsonify({"error": "The web demo is busy or at today's limit. Try again later, or use the app.", "errors": []})
        resp.headers["Retry-After"] = str(hit[1])
        return resp, 429

    @app.get("/try")
    def web_demo_page():
        return send_from_directory(STATIC, "try.html")

    @app.post("/try/check")
    def web_demo_check():
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or request.files:
            return jsonify({"error": "Send JSON: text, codes, year, make, model.", "errors": []}), 400
        extra = set(body) - CHECK_FIELDS
        if extra:
            return jsonify({"error": "Unknown fields: " + ", ".join(sorted(extra))[:200], "errors": []}), 400
        request.lylo_web_demo = True  # /try/check uses the photo path itself; LYLO_HACK_JSON_PHOTO stays as set
        return limited() or check_handler()

    @app.post("/try/dash")
    def web_demo_dash():
        if set(request.form) or set(request.files) != {"photo"}:
            return jsonify({"error": "Send one photo (field 'photo') and nothing else.", "errors": []}), 400
        return limited() or dash_handler()
