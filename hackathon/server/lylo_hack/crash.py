"""Crash Guard alert email (v0.6). Flag LYLO_HACK_CRASH_ALERT=1 (unset = route returns 503, nothing sent).

POST /api/v1/crash/alert (JSON, app key required like every /api route):
  {"emails": [..max 5], "name": "first name", "lat": .., "lon": .., "accuracy_m": .., "at": epoch_ms, "test": bool}
The message text is FIXED and built here (no free text from the phone), so the route cannot be used to send spam content.
Own limits: 3 per IP per hour, 20 per day server-wide (LYLO_HACK_CRASH_PER_HOUR / LYLO_HACK_CRASH_PER_DAY).
Sender: SMTP from env names LYLO_HACK_SMTP_HOST, LYLO_HACK_SMTP_PORT (587), LYLO_HACK_SMTP_USER, LYLO_HACK_SMTP_PASS,
LYLO_HACK_SMTP_FROM. Missing config = 503 "not configured" (phone then falls back to the SMS app). Values never logged.
NOT an emergency service.
"""
import os
import re
import smtplib
import ssl
from datetime import datetime, timezone
from email.message import EmailMessage

EMAIL_RE = re.compile(r"^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$")
MAX_TO = 5


def enabled():
    return os.environ.get("LYLO_HACK_CRASH_ALERT") == "1"


def configured():
    return all(os.environ.get(k) for k in ("LYLO_HACK_SMTP_HOST", "LYLO_HACK_SMTP_USER", "LYLO_HACK_SMTP_PASS", "LYLO_HACK_SMTP_FROM"))


def _int(name, d):
    try:
        return int(os.environ.get(name, d))
    except ValueError:
        return d


def rules(ip):
    return [(f"crash:ip:{ip}:hour", _int("LYLO_HACK_CRASH_PER_HOUR", 3), 3600),
            ("crash:global:day", _int("LYLO_HACK_CRASH_PER_DAY", 20), 86400)]


def parse(body):
    if not isinstance(body, dict):
        return None, "Send JSON."
    emails = [str(e).strip()[:120] for e in (body.get("emails") or []) if isinstance(e, str)]
    emails = [e for e in emails if EMAIL_RE.match(e)][:MAX_TO]
    if not emails:
        return None, "No valid contact email."
    name = re.sub(r"[^\w .'-]", "", str(body.get("name") or ""))[:40].strip() or "A LYLO Mechanic user"
    loc = None
    try:
        lat, lon = float(body.get("lat")), float(body.get("lon"))
        if -90 <= lat <= 90 and -180 <= lon <= 180:
            acc = body.get("accuracy_m")
            loc = (lat, lon, int(float(acc)) if isinstance(acc, (int, float)) and 0 < acc < 100000 else None)
    except (TypeError, ValueError):
        loc = None
    try:
        at = datetime.fromtimestamp(float(body.get("at")) / 1000, tz=timezone.utc)
    except (TypeError, ValueError, OverflowError, OSError):
        at = datetime.now(timezone.utc)
    return {"emails": emails, "name": name, "loc": loc, "at": at, "test": body.get("test") is True}, None


def message(p):
    test = "[TEST ONLY - no crash happened] " if p["test"] else ""
    when = p["at"].strftime("%Y-%m-%d %H:%M UTC")
    if p["loc"]:
        lat, lon, acc = p["loc"]
        where = f"Last known location{f' (within about {acc} m)' if acc else ''}: https://maps.google.com/?q={lat:.5f},{lon:.5f}"
    else:
        where = "Location was not available."
    subject = f"{test}{p['name']} may have been in a car crash"
    body = (f"{test}{p['name']}'s phone may have detected a car crash at {when}, and they did not answer "
            f"\"Are you okay?\" for 60 seconds.\n\n{where}\n\nPlease try to reach them. If you cannot, call 911 and give this location.\n\n"
            "Sent by LYLO Mechanic Crash Guard. It can be wrong, and it is not an emergency service.\n")
    return subject, body


def send(p, smtp_factory=None):
    subject, body = message(p)
    m = EmailMessage()
    m["From"] = os.environ["LYLO_HACK_SMTP_FROM"]
    m["To"] = ", ".join(p["emails"])
    m["Subject"] = subject
    m.set_content(body)
    host, port = os.environ["LYLO_HACK_SMTP_HOST"], _int("LYLO_HACK_SMTP_PORT", 587)
    factory = smtp_factory or (lambda: smtplib.SMTP(host, port, timeout=15))
    with factory() as s:
        s.starttls(context=ssl.create_default_context())
        s.login(os.environ["LYLO_HACK_SMTP_USER"], os.environ["LYLO_HACK_SMTP_PASS"])
        s.send_message(m)
    return len(p["emails"])


def install(app, limiter):
    from flask import jsonify, request
    from . import security

    @app.post("/api/v1/crash/alert")
    def crash_alert():
        if not enabled():
            return jsonify({"error": "Crash alerts are off (LYLO_HACK_CRASH_ALERT is not 1).", "sent": 0}), 503
        if not configured():
            return jsonify({"error": "Crash alert email is not configured on this server.", "sent": 0}), 503
        p, err = parse(request.get_json(silent=True))
        if err:
            return jsonify({"error": err, "sent": 0}), 400
        hit = limiter.hit(rules(security.client_ip(request.remote_addr, request.headers)))
        if hit:
            return jsonify({"error": "Alert limit reached.", "sent": 0}), 429
        try:
            n = send(p)
        except Exception as e:  # never log addresses or credentials
            app.logger.warning("crash alert send failed: %s", type(e).__name__)
            return jsonify({"error": "Email send failed.", "sent": 0}), 502
        return jsonify({"sent": n, "test": p["test"]})
