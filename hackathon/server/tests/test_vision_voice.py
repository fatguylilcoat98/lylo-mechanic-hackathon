"""Vision + voice tests with mocked Meta calls (no network, no spend)."""
import io
import json
import math
import os
import struct
import unittest
import wave
from unittest import mock

os.environ["LYLO_HACK_MUSE"] = "0"
os.environ["LYLO_HACK_ENV_FILE"] = "none"
os.environ["HTTPS_PROXY"] = os.environ["HTTP_PROXY"] = "http://127.0.0.1:9"

from PIL import Image  # noqa: E402

from lylo_hack.app import create_app  # noqa: E402
from lylo_hack import muse, vision, voice  # noqa: E402

SCAN = {"vehicle_profile": {"vin": "1HGCM82633A004352", "make": "Honda", "model": "Accord", "year": 2012},
        "raw_dtcs": [{"code": "P0171", "status": "active"}],
        "raw_pids": [{"name": "LONG_TERM_FUEL_TRIM_B1", "pid_code": "07", "raw_value": 14.8, "unit": "%"}]}
HOT = {"symptoms": {"primary_category": "overheating", "severity": "severe", "frequency": "constant"},
       "raw_pids": [{"name": "ENGINE_COOLANT_TEMP", "pid_code": "05", "raw_value": 260, "unit": "°F"}]}


def jpeg_with_exif():
    im = Image.new("RGB", (64, 48), (20, 20, 20))
    ex = Image.Exif()
    ex[0x010F] = "SecretCamMaker"   # Make
    ex[0x8825] = {2: (37.0, 46.0, 30.0)}  # GPS IFD (latitude) - must not survive
    b = io.BytesIO()
    im.save(b, "JPEG", exif=ex.tobytes())
    return b.getvalue()


def wav(seconds=1.0, rate=16000):
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"".join(struct.pack("<h", int(3000 * math.sin(i / 8))) for i in range(int(seconds * rate))))
    return b.getvalue()


def vision_out(*findings, vehicle=True):
    return {"is_vehicle_photo": vehicle, "photo_kind": "dashboard", "image_quality": "good",
            "findings": [dict(kind="warning_light", description="lit", confidence="high", **f) for f in findings]}


def fake(out=None, exc=None, seen=None):
    def call(messages, schema, **kw):
        if seen is not None:
            seen.append((messages, kw))
        if exc:
            raise exc
        return out, {"model": "muse-spark-1.3", "latency_ms": 5, "usage": {"prompt_tokens": 1, "completion_tokens": 1}, "finish_reason": "stop"}
    return call


class VisionUnitTests(unittest.TestCase):
    def test_sanitize_strips_exif_and_gps(self):
        raw = jpeg_with_exif()
        self.assertIn(b"SecretCamMaker", raw)
        out, info = vision.sanitize(raw)
        self.assertNotIn(b"SecretCamMaker", out)
        self.assertFalse(Image.open(io.BytesIO(out)).getexif())
        self.assertTrue(info["exif_present_in_upload"])
        self.assertTrue(info["metadata_stripped"])

    def test_size_limit_and_garbage(self):
        with mock.patch.dict(os.environ, {"LYLO_HACK_VISION_MAX_BYTES": "100"}):
            with self.assertRaises(vision.PhotoError):
                vision.sanitize(jpeg_with_exif())
        with self.assertRaises(vision.PhotoError):
            vision.sanitize(b"GIF89a not really")
        with self.assertRaises(vision.PhotoError):
            vision.sanitize(b"")

    def test_items_typed_as_photo_lower_trust(self):
        items = vision.to_items(vision_out({"name": "check_engine", "color": "amber"}, {"name": "check_engine", "color": "amber"},
                                           {"name": "made_up", "color": "red"}))
        self.assertEqual([i["id"] for i in items], ["photo:check_engine:amber", "photo:check_engine:amber:2"])
        self.assertTrue(all(i["source"] == "photo" and "lower" in i["trust"] for i in items))
        self.assertEqual(vision.to_items(vision_out({"name": "oil_pressure", "color": "red"}, vehicle=False)), [])
        self.assertEqual(vision.to_items("garbage"), [])

    def test_red_oil_or_coolant_raises_floor(self):
        for name in ("oil_pressure", "coolant_temperature"):
            lv, why = vision.floor_for(vision.to_items(vision_out({"name": name, "color": "red"})))
            self.assertEqual(lv, "DO_NOT_DRIVE", name)
        lv, _ = vision.floor_for(vision.to_items(vision_out({"name": "check_engine", "color": "amber"})))
        self.assertEqual(lv, "INSPECT_SOON")
        self.assertEqual(vision.floor_for([])[0], None)

    def test_analyze_sends_image_without_exif(self):
        seen = []
        v = vision.analyze(jpeg_with_exif(), call=fake(vision_out({"name": "oil_pressure", "color": "red"}), seen=seen))
        content = seen[0][0][1]["content"]
        self.assertEqual(content[1]["type"], "image_url")
        self.assertTrue(content[1]["image_url"]["url"].startswith("data:image/jpeg;base64,"))
        self.assertEqual(v["photo_safety_floor"], "DO_NOT_DRIVE")
        self.assertFalse(v["receipt"]["stored"])


class VisionRouteTests(unittest.TestCase):
    def setUp(self):
        self.c = create_app().test_client()

    def post(self, out=None, exc=None, scan=None, env=None):
        form = {"photo": (io.BytesIO(jpeg_with_exif()), "dash.jpg")}
        if scan is not None:
            form["scan"] = json.dumps(scan)
        with mock.patch.dict(os.environ, {"LYLO_HACK_VISION": "1", **(env or {})}), \
             mock.patch.object(muse, "chat_json", fake(out, exc)):
            return self.c.post("/api/v1/vision/dash", data=form, content_type="multipart/form-data")

    def test_off_by_default(self):
        r = self.c.post("/api/v1/vision/dash", data={"photo": (io.BytesIO(b"x"), "a.jpg")}, content_type="multipart/form-data")
        self.assertEqual(r.status_code, 503)

    def test_red_oil_light_raises_scan_safety_and_merges_ledger(self):
        r = self.post(vision_out({"name": "oil_pressure", "color": "red"}), scan=SCAN)
        self.assertEqual(r.status_code, 200, r.get_json())
        j = r.get_json()
        res = j["scan_result"]
        self.assertEqual(res["safety"]["level"], "DO_NOT_DRIVE")
        self.assertNotEqual(res["safety"]["rule_level"], "DO_NOT_DRIVE")
        self.assertEqual(j["photo_action"], "raised_by_photo")
        ids = [i["id"] for i in res["detective"]["ledger"]]
        self.assertIn("photo:oil_pressure:red", ids)
        self.assertIn("dtc:P0171:active", ids)
        self.assertNotIn("1HGCM82633A004352", json.dumps(res["detective"]["ledger"]))

    def test_photo_never_lowers(self):
        r = self.post(vision_out({"name": "seatbelt", "color": "red"}), scan=HOT)
        self.assertEqual(r.get_json()["scan_result"]["safety"]["level"], "EMERGENCY_STOP_IMMEDIATELY")
        r = self.post(vision_out(vehicle=False), scan=HOT)
        self.assertEqual(r.get_json()["final_safety_level"], "EMERGENCY_STOP_IMMEDIATELY")

    def test_muse_failure_adds_nothing(self):
        r = self.post(exc=muse.MuseError("RATE_LIMIT", "429"), scan=SCAN)
        self.assertEqual(r.status_code, 502)
        self.assertEqual(r.get_json()["photo_evidence"], [])

    def test_bad_scan_and_non_image(self):
        self.assertEqual(self.post(vision_out(), scan={"raw_pids": [{"name": "coolant_temp", "raw_value": 1}]}).status_code, 400)
        with mock.patch.dict(os.environ, {"LYLO_HACK_VISION": "1"}):
            r = self.c.post("/api/v1/vision/dash", data={"photo": (io.BytesIO(b"hello"), "a.jpg")}, content_type="multipart/form-data")
        self.assertEqual(r.status_code, 400)

    def test_debug_save_off_writes_nothing(self):
        with mock.patch("builtins.open", side_effect=AssertionError("must not write")) as m:
            vision.analyze(jpeg_with_exif(), call=fake(vision_out()))
            m.assert_not_called()


def voice_out(level="DRIVE_SHORT_DISTANCE_ONLY", answer_cites=("dtc:P0171:active",), op_cites=("rule:safety",)):
    return {"answer": {"text": "Short trips only; the engine runs lean.", "cites": list(answer_cites)},
            "follow_up_checks": [{"text": "Smoke-test for a vacuum leak.", "cites": ["pid:LONG_TERM_FUEL_TRIM_B1"]},
                                 {"text": "Invented check.", "cites": ["dtc:P9999:active"]}],
            "answerable_from_evidence": True,
            "safety_opinion": {"level": level, "reason": "r", "cites": list(op_cites)}}


class VoiceTests(unittest.TestCase):
    def setUp(self):
        self.c = create_app().test_client()

    def ask(self, form, out=None, exc=None, transcript="Is it safe to drive home?", asr_exc=None):
        def asr(wav_bytes, **kw):
            if asr_exc:
                raise asr_exc
            return transcript, {"model": "muse-voice-transcribe-1.0", "latency_ms": 3, "audio_duration_ms": 1000}
        with mock.patch.dict(os.environ, {"LYLO_HACK_VOICE": "1"}), \
             mock.patch.object(muse, "chat_json", fake(out, exc)), mock.patch.object(muse, "transcribe_wav", asr):
            return self.c.post("/api/v1/voice/ask", data=form, content_type="multipart/form-data")

    def test_off_by_default(self):
        self.assertEqual(self.c.post("/api/v1/voice/ask", data={}).status_code, 503)

    def test_audio_answer_cites_and_flags_unverified(self):
        r = self.ask({"audio": (io.BytesIO(wav()), "q.wav"), "scan": json.dumps(SCAN)}, voice_out())
        self.assertEqual(r.status_code, 200, r.get_json())
        j = r.get_json()
        self.assertEqual(j["transcript"], "Is it safe to drive home?")
        self.assertEqual(j["answer"]["status"], "verified")
        self.assertEqual(len(j["follow_up_checks"]), 1)
        self.assertEqual(j["unverified_claims"][0]["missing_ids"], ["dtc:P9999:active"])
        self.assertFalse(j["transcribe_receipt"]["audio_stored"])
        self.assertIn("dtc:P0171:active", j["receipt"]["cited_ledger_ids"])

    def test_answer_cannot_lower_safety(self):
        r = self.ask({"question": "It's fine right?", "scan": json.dumps(HOT)}, voice_out(level="SAFE_TO_DRIVE", answer_cites=("rule:safety",)))
        j = r.get_json()
        self.assertEqual(j["final_safety_level"], "EMERGENCY_STOP_IMMEDIATELY")
        self.assertEqual(j["safety_action"], "detective_lower_ignored")

    def test_uncited_answer_withheld(self):
        j = self.ask({"question": "q", "scan": json.dumps(SCAN)}, voice_out(answer_cites=("nope:1",))).get_json()
        self.assertEqual(j["answer"]["status"], "unverified_answer_withheld")

    def test_failures_fail_closed(self):
        j = self.ask({"question": "q", "scan": json.dumps(HOT)}, exc=muse.MuseError("TIMEOUT", "t")).get_json()
        self.assertIsNone(j["answer"])
        self.assertEqual(j["final_safety_level"], "EMERGENCY_STOP_IMMEDIATELY")
        j = self.ask({"question": "q", "scan": json.dumps(HOT)}, out="garbage").get_json()
        self.assertEqual(j["final_safety_level"], "EMERGENCY_STOP_IMMEDIATELY")
        r = self.ask({"audio": (io.BytesIO(wav()), "q.wav"), "scan": json.dumps(SCAN)}, asr_exc=muse.MuseError("HTTP_400", "x"))
        self.assertEqual(r.status_code, 502)

    def test_photo_evidence_merged_and_floor_applied(self):
        pe = [{"id": "photo:oil_pressure:red", "name": "oil_pressure", "color": "red", "confidence": "high", "source": "sensor"}]
        j = self.ask({"question": "q", "scan": json.dumps(SCAN), "photo_evidence": json.dumps(pe)}, voice_out()).get_json()
        item = [i for i in j["ledger"] if i["id"] == "photo:oil_pressure:red"][0]
        self.assertEqual(item["source"], "photo")  # client cannot upgrade trust
        self.assertEqual(j["final_safety_level"], "DO_NOT_DRIVE")

    def test_requires_scan_and_valid_audio(self):
        self.assertEqual(self.ask({"question": "q"}).status_code, 400)
        r = self.ask({"audio": (io.BytesIO(b"RIFFjunk"), "q.wav"), "scan": json.dumps(SCAN)})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(voice._check_wav(wav(rate=44100)), None)

    def test_live_route_still_capped_at_256kb(self):
        r = self.c.post("/api/v1/live/live", data="x" * (300 * 1024), content_type="application/json")
        self.assertEqual(r.status_code, 413)


class TranscribeClientTests(unittest.TestCase):
    def test_multipart_shape(self):
        sent = {}

        class R:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return json.dumps({"transcript": "hello", "audioDurationMs": 900}).encode()

        def urlopen(req, timeout):
            sent["url"], sent["body"], sent["headers"] = req.full_url, req.data, dict(req.headers)
            return R()
        with mock.patch.dict(os.environ, {"META_MODEL_API_KEY": "test-not-real"}), mock.patch("urllib.request.urlopen", urlopen):
            text, meta = muse.transcribe_wav(wav(), keywords=["P0171"])
        self.assertEqual(text, "hello")
        self.assertTrue(sent["url"].endswith("/v1/asr/transcribe"))
        self.assertIn(b'name="request"', sent["body"])
        self.assertIn(b'"muse-voice-transcribe-1.0"', sent["body"])
        self.assertIn(b'name="audio"', sent["body"])
        self.assertNotIn("test-not-real", json.dumps(meta))


if __name__ == "__main__":
    unittest.main()
