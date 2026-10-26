"""Photo Helper tests with mocked Meta calls (no network, no spend)."""
import io
import os
import unittest
from unittest import mock

os.environ["LYLO_HACK_MUSE"] = "0"
os.environ["LYLO_HACK_ENV_FILE"] = "none"
os.environ["LYLO_HACK_REQUIRE_APP_KEY"] = "0"
for _k in ("LYLO_HACK_RL_IP_PER_MIN", "LYLO_HACK_RL_IP_MUSE_PER_MIN", "LYLO_HACK_RL_KEY_MUSE_PER_MIN", "LYLO_HACK_RL_KEY_MUSE_PER_DAY", "LYLO_HACK_MUSE_DAILY_CAP"):
    os.environ[_k] = "1000000"
os.environ["LYLO_HACK_RATELIMIT_DB"] = "/tmp/lylo-hack-ratelimit-test.sqlite"
os.environ["HTTPS_PROXY"] = os.environ["HTTP_PROXY"] = "http://127.0.0.1:9"

from PIL import Image  # noqa: E402
from lylo_hack.app import create_app  # noqa: E402
from lylo_hack import helper, muse  # noqa: E402


def jpeg_with_exif():
    im = Image.new("RGB", (80, 60), (40, 40, 40))
    ex = Image.Exif()
    ex[0x010F] = "SecretCamMaker"
    ex[0x8825] = {2: (37.0, 46.0, 30.0)}
    b = io.BytesIO()
    im.save(b, "JPEG", exif=ex.tobytes())
    return b.getvalue()


def out(*marks, area=True, hazards=("none",), quality="good"):
    return {"shows_requested_area": area, "image_quality": quality, "hazards": list(hazards),
            "marks": [dict({"radius": 0.08, "confidence": 0.9, "seen": "black box"}, **m) for m in marks]}


def fake(o, seen=None):
    def call(messages, schema, **kw):
        if seen is not None:
            seen.append(messages)
        return o, {"model": "muse-spark-1.3", "latency_ms": 5, "usage": {"prompt_tokens": 1, "completion_tokens": 1}}
    return call


class Marks(unittest.TestCase):
    def test_clamp_threshold_number_and_label_filter(self):
        o = out({"label": "Unclip here", "x": 1.7, "y": -0.2, "radius": 9},
                {"label": "Lift the lid", "x": 0.5, "y": 0.4, "confidence": 0.95},
                {"label": "Unclip here", "x": 0.2, "y": 0.2, "confidence": 0.3},      # low confidence: dropped
                {"label": "Battery", "x": 0.2, "y": 0.2},                              # wrong job label: dropped
                {"label": "Unscrew here", "x": "nan", "y": 0.5},                       # bad number: dropped
                {"label": "Air filter box", "x": float("inf"), "y": 0.5})
        marks, dropped = helper.clean_marks(o, "engine_air_filter")
        self.assertEqual([m["text"] for m in marks], ["1. Lift the lid", "2. Unclip here"])
        m = marks[1]
        self.assertEqual((m["x"], m["y"], m["radius"]), (1.0, 0.0, 0.3))
        self.assertEqual(dropped, 4)
        for m in marks:
            self.assertTrue(0 <= m["x"] <= 1 and 0 <= m["y"] <= 1 and 0.02 <= m["radius"] <= 0.3)

    def test_max_six_marks(self):
        o = out(*[{"label": "Unclip here", "x": i / 10, "y": 0.5} for i in range(9)])
        self.assertEqual(len(helper.clean_marks(o, "engine_air_filter")[0]), 6)

    def test_not_found_never_guesses(self):
        for o in (out(), out({"label": "Air filter box", "x": .5, "y": .5, "confidence": .4}),
                  out({"label": "Air filter box", "x": .5, "y": .5}, area=False),
                  out({"label": "Air filter box", "x": .5, "y": .5}, quality="unusable"), "garbage", None):
            r = helper.build("engine_air_filter", o)
            self.assertFalse(r["found"])
            self.assertEqual(r["marks"], [])
            self.assertEqual(r["steps"], [])
            self.assertEqual(r["message"], "I can't see it in this photo. Try a closer picture or check your owner's manual.")
            self.assertEqual(r["disclaimer"], "This is not a guarantee. It gives you an idea of where to look.")

    def test_battery_always_warns(self):
        r = helper.build("battery", out({"label": "Negative (−) terminal", "x": .3, "y": .4}))
        self.assertTrue(r["found"])
        self.assertIn("negative", r["warnings"][0])
        self.assertIn("metal tool", r["warnings"][0])
        self.assertIn("negative", helper.build("battery", out())["warnings"][0])

    def test_high_voltage_hazard_refuses(self):
        r = helper.build("battery", out({"label": "Battery", "x": .3, "y": .4}, hazards=["high_voltage_orange_cables"]))
        self.assertEqual(r["helper_status"], "refused")
        self.assertEqual(r["message"], "Get a pro for this one.")
        self.assertEqual(r["marks"], [])

    def test_risky_jobs_refused_without_model(self):
        for j in ("brakes", "replace brake pads", "fuel pump", "airbag light", "hybrid battery", "EV high voltage"):
            r = helper.refusal(j)
            self.assertEqual(r["message"], "Get a pro for this one.", j)
        self.assertEqual(helper.refusal("make coffee")["helper_status"], "unknown_job")
        self.assertIsNone(helper.refusal("battery"))

    def test_steps_and_labels_are_fixed_text(self):
        for k, j in helper.JOBS.items():
            self.assertTrue(2 <= len(j["steps"]) <= 6 and j["photo"].endswith("."))
            for lab in j["labels"]:
                self.assertLessEqual(len(lab.split()), 4)

    def test_analyze_strips_exif_and_builds(self):
        seen = []
        r = helper.analyze("engine_air_filter", jpeg_with_exif(), call=fake(out({"label": "Air filter box", "x": .6, "y": .3}), seen))
        self.assertTrue(r["found"])
        self.assertTrue(r["receipt"]["exif_present_in_upload"] and r["receipt"]["metadata_stripped"])
        self.assertFalse(r["receipt"]["stored"])
        import base64
        img = base64.b64decode(seen[0][1]["content"][1]["image_url"]["url"].split(",", 1)[1])
        self.assertNotIn(b"SecretCamMaker", img)
        self.assertFalse(Image.open(io.BytesIO(img)).getexif())
        self.assertIn("Allowed labels for this job: Air filter box", seen[0][0]["content"])


class Route(unittest.TestCase):
    def setUp(self):
        self.c = create_app().test_client()

    def post(self, job, photo=b"x", flag="1", call=None):
        with mock.patch.dict(os.environ, {"LYLO_HACK_PHOTO_HELPER": flag}), \
             mock.patch.object(muse, "chat_json", call or fake(out({"label": "Light housing", "x": .5, "y": .5}))):
            return self.c.post("/api/v1/photo/helper", data={"job": job, "photo": (io.BytesIO(photo), "p.jpg")},
                               content_type="multipart/form-data")

    def test_flag_off_503(self):
        self.assertEqual(self.post("bulb", flag="0").status_code, 503)

    def test_ok(self):
        r = self.post("bulb", jpeg_with_exif())
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["marks"][0]["text"], "1. Light housing")

    def test_risky_refused_200_unknown_400_bad_photo_400(self):
        called = []
        r = self.post("brakes", call=lambda *a, **k: called.append(1))
        self.assertEqual((r.status_code, r.get_json()["message"]), (200, "Get a pro for this one."))
        self.assertEqual(called, [])
        self.assertEqual(self.post("juggling").status_code, 400)
        self.assertEqual(self.post("bulb", b"not an image").status_code, 400)

    def test_muse_error_502_not_found_message(self):
        def boom(*a, **k):
            raise muse.MuseError("TIMEOUT", "t")
        r = self.post("tires", jpeg_with_exif(), call=boom)
        self.assertEqual(r.status_code, 502)
        self.assertFalse(r.get_json()["found"])

    def test_jobs_list(self):
        j = self.c.get("/api/v1/photo/jobs").get_json()
        self.assertEqual(len(j["jobs"]), 6)


if __name__ == "__main__":
    unittest.main()
