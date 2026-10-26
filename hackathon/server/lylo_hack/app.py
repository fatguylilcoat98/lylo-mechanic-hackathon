"""Hackathon Flask app: POST /api/v1/live/live, /api/v1/vision/dash, /api/v1/voice/ask, GET /healthz.

Run locally:  python -m lylo_hack.app   (binds LYLO_HACK_HOST:LYLO_HACK_PORT,
default 127.0.0.1:5088). Does not import baseline/backend/app.py, so no
DATABASE_URL, billing, auth or Stripe code is loaded.
"""
import json
import logging
import os

from flask import Flask, jsonify, request
from werkzeug.exceptions import HTTPException

from .validation import validate_live_payload
from . import live
from . import detective
from . import muse, vision, voice
from .safety import apply_floor, higher

log = logging.getLogger("lylo_hack")
LIVE_MAX_BYTES = 256 * 1024
DEFAULT_ENV_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")


def load_env_file(path=None):
    """Load KEY=VALUE lines from the gitignored hackathon/server/.env (chmod 600).
    Never overrides variables already set; never logs values. Returns key names."""
    path = path or os.environ.get("LYLO_HACK_ENV_FILE", DEFAULT_ENV_FILE)
    if path == "none" or not os.path.isfile(path):
        return []
    names = []
    for line in open(path, encoding="utf8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        os.environ.setdefault(k, v.strip())
        names.append(k)
    return names


def create_app():
    load_env_file()
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024  # photo/audio routes; JSON route checks its own 256 KB cap
    live.install_handshake_stub()
    live.install_shared_list_fix()

    @app.get("/healthz")
    def healthz():
        return jsonify({"ok": True, "external_handshake": "stubbed" if live.external_handshake_disabled() else "live",
                        "muse": "on" if detective.enabled() else "off",
                        "vision": "on" if vision.enabled() else "off", "voice": "on" if voice.enabled() else "off"})

    @app.post("/api/v1/live/live")
    def live_route():
        if (request.content_length or 0) > LIVE_MAX_BYTES:
            return jsonify({"error": "Scan payload too large.", "errors": []}), 413
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

    def _scan_from_form():
        """Optional 'scan' form field: the same JSON the live route takes. Returns (data|None, error_response|None)."""
        raw = request.form.get("scan")
        if not raw:
            return None, None
        if len(raw) > LIVE_MAX_BYTES:
            return None, (jsonify({"error": "scan field too large.", "errors": []}), 413)
        try:
            data = json.loads(raw)
        except ValueError:
            return None, (jsonify({"error": "scan field is not valid JSON.", "errors": []}), 400)
        errors = validate_live_payload(data)
        if errors:
            return None, (jsonify({"error": "Invalid scan payload.", "errors": errors}), 400)
        return data, None

    def _photo_items_from_form():
        """Optional 'photo_evidence' field (items returned by /vision/dash). Re-typed: source=photo, lower trust."""
        try:
            raw = json.loads(request.form.get("photo_evidence") or "[]")
        except ValueError:
            return []
        items = []
        for i in raw if isinstance(raw, list) else []:
            if isinstance(i, dict) and str(i.get("id", "")).startswith("photo:") and i.get("name") in vision.LIGHTS + vision.ISSUES:
                items.append({"id": str(i["id"])[:80], "type": "photo_" + ("warning_light" if i["name"] in vision.LIGHTS else "visible_issue"),
                              "source": "photo", "trust": "lower than sensor data", "name": i["name"],
                              "color": str(i.get("color", "unclear"))[:20],
                              "confidence": i.get("confidence") if i.get("confidence") in ("low", "medium", "high") else "low",
                              "description": str(i.get("description", ""))[:200]})
        return items[:20]

    @app.post("/api/v1/vision/dash")
    def vision_route():
        if not vision.enabled():
            return jsonify({"error": "Photo analysis is off (LYLO_HACK_VISION is not 1).", "errors": []}), 503
        f = request.files.get("photo")
        raw = f.read(vision.max_bytes() + 1) if f else request.get_data(cache=False)[: vision.max_bytes() + 1]
        data, err = _scan_from_form()
        if err:
            return err
        try:
            v = vision.analyze(raw)
        except vision.PhotoError as e:
            return jsonify({"error": str(e), "errors": []}), 400
        except muse.MuseError as e:
            return jsonify({"vision_status": f"error: {e.code}; no photo evidence added, safety unchanged",
                            "photo_evidence": [], "photo_safety_floor": None}), 502
        except Exception:
            log.exception("vision failed")
            return jsonify({"vision_status": "error: internal; no photo evidence added, safety unchanged",
                            "photo_evidence": [], "photo_safety_floor": None}), 500
        if data is not None:
            run_det = request.form.get("detective") == "1"
            result = live.diagnose(data, muse=run_det, extra_items=v["photo_evidence"])
            v["photo_action"] = apply_floor(result, v["photo_safety_floor"], "; ".join(v["floor_reasons"])[:200], "photo")
            v["scan_result"] = result
            v["final_safety_level"] = result["safety"]["level"]
        else:
            v["final_safety_level"] = v["photo_safety_floor"]
        return jsonify(v)

    @app.post("/api/v1/voice/ask")
    def voice_route():
        if not voice.enabled():
            return jsonify({"error": "Voice questions are off (LYLO_HACK_VOICE is not 1).", "errors": []}), 503
        data, err = _scan_from_form()
        if err:
            return err
        if data is None:
            return jsonify({"error": "Send the scan (form field 'scan') so the answer can cite its evidence.", "errors": []}), 400
        out = {"voice_status": "ok"}
        question = (request.form.get("question") or "").strip()
        f = request.files.get("audio")
        if f:
            try:
                wav, secs = voice.prepare_audio(f.read(voice.MAX_AUDIO_BYTES + 1))
                text, meta = muse.transcribe_wav(wav, keywords=voice.KEYWORDS,
                                                 timeout=float(os.environ.get("LYLO_HACK_VOICE_ASR_TIMEOUT_S", "10")))
            except voice.AudioError as e:
                return jsonify({"error": str(e), "errors": []}), 400
            except muse.MuseError as e:
                return jsonify({"voice_status": f"error: {e.code}; no transcript, nothing answered"}), 502
            question = text.strip()
            out["transcript"] = question
            out["transcribe_receipt"] = {**meta, "audio_seconds": round(secs, 2), "audio_stored": False}
        elif question:
            out["transcript"] = None
            out["question_source"] = "typed"
        else:
            return jsonify({"error": "Send 'audio' (WAV) or a typed 'question'.", "errors": []}), 400
        if not question:
            out["voice_status"] = "no speech recognized"
            return jsonify(out)
        photo_items = _photo_items_from_form()
        result = live.diagnose(data, muse=False, extra_items=photo_items)
        floor, reasons = vision.floor_for(photo_items)
        apply_floor(result, floor, "; ".join(reasons)[:200], "photo")
        items = result["detective"]["ledger"]
        rule_level = result["safety"]["level"]
        out["question"] = question
        out.update(voice.answer(question, items, rule_level))
        out["final_safety_level"] = higher(rule_level, out["final_safety_level"])
        out["ledger"] = items
        return jsonify(out)

    @app.errorhandler(HTTPException)
    def http_error(e):  # keep 4xx as 4xx (baseline turned them into 500)
        return jsonify({"error": e.description, "errors": []}), e.code

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host=os.environ.get("LYLO_HACK_HOST", "127.0.0.1"),
            port=int(os.environ.get("LYLO_HACK_PORT", "5088")))
