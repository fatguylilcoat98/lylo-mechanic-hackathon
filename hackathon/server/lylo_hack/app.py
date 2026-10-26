"""Hackathon Flask app: POST /api/v1/live/live, GET /healthz.

Run locally:  python -m lylo_hack.app   (binds LYLO_HACK_HOST:LYLO_HACK_PORT,
default 127.0.0.1:5088). Does not import baseline/backend/app.py, so no
DATABASE_URL, billing, auth or Stripe code is loaded.
"""
import logging
import os

from flask import Flask, jsonify, request
from werkzeug.exceptions import HTTPException

from .validation import validate_live_payload
from . import live

log = logging.getLogger("lylo_hack")


def create_app():
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 256 * 1024
    live.install_handshake_stub()

    @app.get("/healthz")
    def healthz():
        return jsonify({"ok": True, "external_handshake": "stubbed" if live.external_handshake_disabled() else "live"})

    @app.post("/api/v1/live/live")
    def live_route():
        if not request.is_json:
            return jsonify({"error": "Send JSON with Content-Type: application/json.", "errors": []}), 415
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "Body is not valid JSON.", "errors": []}), 400
        errors = validate_live_payload(data)
        if errors:
            return jsonify({"error": "Invalid scan payload.", "errors": errors}), 400
        try:
            return jsonify(live.diagnose(data))
        except Exception:  # pipeline bug, not the caller's fault
            log.exception("diagnosis failed")
            return jsonify({"error": "Diagnosis failed inside the pipeline.", "errors": []}), 500

    @app.errorhandler(HTTPException)
    def http_error(e):  # keep 4xx as 4xx (baseline turned them into 500)
        return jsonify({"error": e.description, "errors": []}), e.code

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host=os.environ.get("LYLO_HACK_HOST", "127.0.0.1"),
            port=int(os.environ.get("LYLO_HACK_PORT", "5088")))
