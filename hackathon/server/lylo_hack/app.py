"""Hackathon Flask app: POST /api/v1/live/live, /api/v1/vision/dash, /api/v1/voice/ask, /api/v1/noadapter/check, GET /healthz.

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
from . import demo, live
from . import detective
from . import muse, vision, voice, helper, symptoms
from . import vin as vinmod
from .safety import apply_floor, higher
from . import security

log = logging.getLogger("lylo_hack")

# Upstream (Meta model API) failures. 424 Failed Dependency, not 502: Cloudflare can replace an
# origin 502 body with its own "error code: 502" page, which hid the real cause (v0.4.2 incident).
UPSTREAM_STATUS = 424


def _upstream_fail(route, e, payload):
    """Log the upstream failure code (never the key or the photo) and return a structured error."""
    log.warning("muse upstream failure route=%s code=%s detail=%s", route, e.code, str(e)[:160].replace("\n", " "))
    payload.update({"error": "Meta AI could not answer this request.", "upstream_error": e.code, "errors": []})
    return jsonify(payload), UPSTREAM_STATUS
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
    app.config["MAX_CONTENT_LENGTH"] = 6 * 1024 * 1024  # photo (5 MB) + scan field; JSON route checks its own 256 KB cap
    limiter = security.Limiter()
    muse_routes = {"/api/v1/live/live": detective.enabled, "/api/v1/vision/dash": vision.enabled, "/api/v1/vin/photo": vinmod.enabled,
                   "/api/v1/voice/ask": voice.enabled, "/api/v1/photo/helper": helper.enabled,
                   "/api/v1/noadapter/check": symptoms.enabled,
                   "/api/v1/demo/replay": lambda: demo.enabled() and detective.enabled()}

    @app.before_request
    def guard():
        if not request.path.startswith("/api/"):
            return None
        if (request.content_length or 0) > app.config["MAX_CONTENT_LENGTH"]:
            return jsonify({"error": "Request too large.", "errors": []}), 413
        ip = security.client_ip(request.remote_addr, request.headers)
        # Per-IP budget first, so bad-key spraying is throttled too.
        hit = limiter.hit(security.rules_for(ip, None, False))
        if hit:
            return _limited(hit)
        key_id, err = security.check_key(request.headers.get("X-LYLO-App-Key"))
        if err:
            return jsonify({"error": err[1], "errors": []}), err[0]
        flag = muse_routes.get(request.path)
        if flag and flag():
            hit = limiter.hit(security.rules_for(ip, key_id, True)[1:])
            if hit:
                return _limited(hit)
        return None

    def _limited(hit):
        bucket, retry = hit
        scope = "daily server cap" if bucket.startswith("global") else ("per-day" if bucket.endswith(":day") else "per-minute")
        resp = jsonify({"error": f"Rate limit reached ({scope}). Try again later; the app works offline meanwhile.", "errors": []})
        resp.headers["Retry-After"] = str(retry)
        return resp, 429

    @app.after_request
    def no_cache(resp):
        resp.headers.setdefault("Cache-Control", "no-store")
        return resp
    live.install_handshake_stub()
    live.install_shared_list_fix()

    @app.get("/healthz")
    def healthz():
        return jsonify({"ok": True, "external_handshake": "stubbed" if live.external_handshake_disabled() else "live",
                        "muse": "on" if detective.enabled() else "off",
                        "vision": "on" if vision.enabled() else "off", "voice": "on" if voice.enabled() else "off", "no_adapter": "on" if symptoms.enabled() else "off",
                        "photo_helper": "on" if helper.enabled() else "off", "demo": "on" if demo.enabled() else "off",
                        "vin": "on" if vinmod.enabled() else "off"})

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
            return _upstream_fail("vision", e, {"vision_status": f"error: {e.code}; no photo evidence added, safety unchanged",
                                                "photo_evidence": [], "photo_safety_floor": None})
        except Exception:
            log.exception("vision failed")
            return jsonify({"vision_status": "error: internal; no photo evidence added, safety unchanged",
                            "photo_evidence": [], "photo_safety_floor": None}), 500
        if data is not None:
            # Photo floor first, so the ledger's rule:safety item (and the Detective) see the raised level.
            result = live.diagnose(data, muse=False, extra_items=v["photo_evidence"])
            v["photo_action"] = apply_floor(result, v["photo_safety_floor"], "; ".join(v["floor_reasons"])[:200], "photo")
            if request.form.get("detective") == "1":
                detective.run(data, result, extra_items=v["photo_evidence"])
            else:
                live._det_off(data, result, v["photo_evidence"])
            v["scan_result"] = result
            v["final_safety_level"] = result["safety"]["level"]
        else:
            v["final_safety_level"] = v["photo_safety_floor"]
        return jsonify(v)

    @app.post("/api/v1/vin/decode")
    def vin_decode_route():
        if not vinmod.enabled():
            return jsonify({"error": "VIN lookup is off (LYLO_HACK_VIN is not 1).", "errors": []}), 503
        body = request.get_json(silent=True) or {}
        dec = vinmod.decode(body.get("vin") or request.form.get("vin"))
        if dec["status"] == "invalid":
            return jsonify({"vin_status": "invalid", "message": dec["reason"], "errors": []}), 400
        out = {"vin_status": dec["status"], "vehicle": dec}
        if dec["status"] == "ok":
            out["recalls"] = vinmod.recalls(dec)
        return jsonify(out)

    @app.post("/api/v1/vin/photo")
    def vin_photo_route():
        if not vinmod.enabled():
            return jsonify({"error": "VIN lookup is off (LYLO_HACK_VIN is not 1).", "errors": []}), 503
        f = request.files.get("photo")
        raw = f.read(vision.max_bytes() + 1) if f else b""
        try:
            return jsonify(vinmod.read_photo(raw))
        except vision.PhotoError as e:
            return jsonify({"error": str(e), "errors": []}), 400
        except muse.MuseError as e:
            return _upstream_fail("vin_photo", e, {"vin_status": f"error: {e.code}", "message": vinmod.CANT_READ})
        except Exception:
            log.exception("vin photo failed")
            return jsonify({"vin_status": "error: internal", "message": vinmod.CANT_READ, "errors": []}), 500

    @app.get("/api/v1/photo/jobs")
    def helper_jobs():
        return jsonify({"jobs": helper.jobs_public(), "disclaimer": helper.DISCLAIMER})

    @app.post("/api/v1/photo/helper")
    def helper_route():
        if not helper.enabled():
            return jsonify({"error": "Photo Helper is off (LYLO_HACK_PHOTO_HELPER is not 1).", "errors": []}), 503
        job = (request.form.get("job") or request.args.get("job") or "").strip()
        ref = helper.refusal(job)
        if ref:
            return jsonify(ref), (200 if ref["helper_status"] == "refused" else 400)
        f = request.files.get("photo")
        raw = f.read(vision.max_bytes() + 1) if f else b""
        vehicle = None
        if vinmod.enabled() and request.form.get("vin"):
            vehicle = vinmod.decode(request.form.get("vin"))
        try:
            return jsonify(helper.analyze(job, raw, vehicle=vehicle))
        except vision.PhotoError as e:
            return jsonify({"error": str(e), "errors": []}), 400
        except muse.MuseError as e:
            return _upstream_fail("photo_helper", e, {"helper_status": f"error: {e.code}", "found": False, "marks": [], "steps": [],
                                                      "message": helper.NOT_FOUND, "disclaimer": helper.DISCLAIMER})
        except Exception:
            log.exception("photo helper failed")
            return jsonify({"helper_status": "error: internal", "found": False, "marks": [], "steps": [],
                            "message": helper.NOT_FOUND, "disclaimer": helper.DISCLAIMER}), 500

    @app.post("/api/v1/voice/ask")
    def voice_route():
        if not voice.enabled():
            return jsonify({"error": "Voice questions are off (LYLO_HACK_VOICE is not 1).", "errors": []}), 503
        data, err = _scan_from_form()
        if err:
            return err
        if data is None and not symptoms.enabled():
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
                return _upstream_fail("voice", e, {"voice_status": f"error: {e.code}; no transcript, nothing answered"})
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
        floor, reasons = vision.floor_for(photo_items)
        if data is None:  # no adapter: symptom-only ledger from the question itself (rule floors first)
            items, rule_level, _n, _h, _r = symptoms.build(question, [], None, photo_items, None, floor, reasons)
            out["mode"] = "no_adapter"
            out["confidence_note"] = symptoms.NO_SENSOR_NOTE
        else:
            result = live.diagnose(data, muse=False, extra_items=photo_items)
            apply_floor(result, floor, "; ".join(reasons)[:200], "photo")
            live._det_off(data, result, photo_items)  # rebuild so rule:safety carries the photo-raised level
            items = result["detective"]["ledger"]
            rule_level = result["safety"]["level"]
        out["question"] = question
        out.update(voice.answer(question, items, rule_level))
        out["final_safety_level"] = higher(rule_level, out["final_safety_level"])
        out["safety_notice"] = ("Safety level for this car: " + str(out["final_safety_level"]).replace("_", " ").lower()
                                + ". This always outranks the spoken answer.")
        out["ledger"] = items
        return jsonify(out)

    @app.get("/api/v1/demo/cases")
    def demo_cases():
        if not demo.enabled():
            return jsonify({"error": "Demo is off (LYLO_HACK_DEMO is not 1).", "errors": []}), 503
        return jsonify({"cases": demo.cases()})

    @app.post("/api/v1/demo/replay")
    def demo_replay():
        """A bundled demo scan through the real live pipeline (rules, Muse if on, never-lower merge)."""
        if not demo.enabled():
            return jsonify({"error": "Demo is off (LYLO_HACK_DEMO is not 1).", "errors": []}), 503
        body = request.get_json(silent=True) if request.is_json else None
        case = str((body or {}).get("case") or "")
        if case not in demo.CASE_IDS:
            return jsonify({"error": "Unknown demo case.", "errors": ["case must be one of " + ", ".join(demo.CASE_IDS)]}), 400
        try:
            return jsonify(demo.replay(case))
        except Exception:
            log.exception("demo replay failed")
            return jsonify({"error": "Diagnosis failed inside the pipeline.", "errors": []}), 500

    @app.post("/api/v1/demo/proof")
    def demo_proof():
        """AI vs rules: a labeled SIMULATED lower AI answer through the real never-lower merge. No model call."""
        if not demo.enabled():
            return jsonify({"error": "Demo is off (LYLO_HACK_DEMO is not 1).", "errors": []}), 503
        try:
            return jsonify(demo.proof())
        except Exception:
            log.exception("demo proof failed")
            return jsonify({"error": "Proof failed inside the pipeline.", "errors": []}), 500

    @app.post("/api/v1/noadapter/check")
    def noadapter_route():
        """No OBD adapter: symptoms (typed or spoken), typed codes, optional dash-photo items. Lower confidence, same rules."""
        if not symptoms.enabled():
            return jsonify({"error": "No-adapter check is off (LYLO_HACK_NO_ADAPTER is not 1).", "errors": []}), 503
        body = request.get_json(silent=True) if request.is_json else None
        src = body if isinstance(body, dict) else request.form
        text = str(src.get("text") or "").strip()[:symptoms.MAX_TEXT]
        codes, bad_codes = symptoms.parse_codes(src.get("codes") or "")
        vehicle = {}
        for k in ("year", "make", "model"):
            v = src.get(k)
            if k == "year":
                try:
                    v = int(v) if v not in (None, "") else None
                except (TypeError, ValueError):
                    v = None
                if v is not None and not 1980 <= v <= 2100:
                    v = None
            elif v is not None:
                v = str(v).strip()[:40]
            if v:
                vehicle[k] = v
        out = {"check_status": "ok", "mode": "no_adapter", "confidence_note": symptoms.NO_SENSOR_NOTE, "invalid_codes": bad_codes}
        f = request.files.get("audio") if body is None else None
        if f:
            try:
                wav, secs = voice.prepare_audio(f.read(voice.MAX_AUDIO_BYTES + 1))
                heard, meta = muse.transcribe_wav(wav, keywords=voice.KEYWORDS,
                                                  timeout=float(os.environ.get("LYLO_HACK_VOICE_ASR_TIMEOUT_S", "10")))
            except voice.AudioError as e:
                return jsonify({"error": str(e), "errors": []}), 400
            except muse.MuseError as e:
                return _upstream_fail("noadapter", e, {"check_status": f"error: {e.code}; no transcript, nothing answered"})
            out["transcript"] = heard.strip()
            out["transcribe_receipt"] = {**meta, "audio_seconds": round(secs, 2), "audio_stored": False}
            text = (text + " " + heard.strip()).strip()[:symptoms.MAX_TEXT]
        if not text and not codes:
            return jsonify({"error": "Tell us what is happening (text or audio) or type a trouble code.", "errors": bad_codes}), 400
        raw_pe = src.get("photo_evidence")
        photo_items = []
        if raw_pe:
            photo_items = _photo_items_from_form() if body is None else []
        floor, reasons = vision.floor_for(photo_items)
        diag = (lambda d: live.diagnose(d, muse=False)) if codes else None
        items, level, notes, hits, result = symptoms.build(text, codes, vehicle, photo_items, diag, floor, reasons)
        out.update({"rule_safety_level": level, "final_safety_level": level, "symptom_matches": hits, "codes": codes,
                    "notes": notes, "hypotheses": [{"cause": h.get("cause"), "confidence": h.get("confidence"), "id": h["id"]}
                                                    for h in items if h.get("type") == "rule_hypothesis"]})
        if (detective.enabled() or voice.enabled()) and text:
            q = text if "?" in text else ("What could be wrong, and is it safe to drive? The owner says: " + text)
            a = voice.answer(q, items, level)
            out.update({k: a[k] for k in ("answer_status", "answer", "follow_up_checks", "unverified_claims", "safety_action", "receipt")})
            out["safety_opinion"] = a.get("safety_opinion")
            out["final_safety_level"] = higher(level, a["final_safety_level"])
        else:
            out["answer_status"] = "skipped (no description or Meta AI off)"
        out["safety_notice"] = ("Safety level: " + str(out["final_safety_level"]).replace("_", " ").lower()
                                + ". Without an adapter this is a lower-confidence check. This level always outranks the written answer.")
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
