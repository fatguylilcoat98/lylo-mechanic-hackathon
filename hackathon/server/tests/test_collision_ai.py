"""v0.7.1 collision summary (LYLO_HACK_COLLISION_AI). Muse is stubbed; synthetic images; nothing is stored."""
import io, json, os, unittest
from unittest import mock

os.environ["LYLO_HACK_ENV_FILE"] = "none"
from PIL import Image  # noqa: E402
from lylo_hack.app import create_app  # noqa: E402
from lylo_hack import collision_ai as CA, muse  # noqa: E402


def png():
    b = io.BytesIO(); Image.new("RGB", (64, 48), (200, 30, 30)).save(b, "PNG"); return b.getvalue()


def stub(out):
    calls = []
    def call(messages, schema, **kw):
        calls.append(messages); return out, {"model": "stub", "latency_ms": 1}
    return call, calls


class CollisionAITests(unittest.TestCase):
    def client(self, env):
        db = f"/tmp/lylo-col-{os.getpid()}.sqlite"
        if os.path.exists(db): os.remove(db)
        p = mock.patch.dict(os.environ, {"LYLO_HACK_REQUIRE_APP_KEY": "0", "LYLO_HACK_RATELIMIT_DB": db, **env}); p.start(); self.addCleanup(p.stop)
        return create_app().test_client()

    def test_flag_off_503(self):
        c = self.client({})
        self.assertEqual(c.post("/api/v1/collision/summary", data={"answers": "{}"}).status_code, 503)

    def test_neutral_output_passes_and_missing_is_deterministic(self):
        call, calls = stub({"photos": [{"index": 1, "damage": "Dented rear bumper."}], "summary": "Two cars met at an intersection. Police report: not provided."})
        r = CA.summarize([png()], ["my_damage"], CA.clean_answers({"other_name": "Pat Example", "junk": "x"}), call=call, have=["my_damage"])
        self.assertEqual(r["label"], "Written by Meta AI: check it before sending")
        self.assertEqual(r["photos"][0]["damage"], "Dented rear bumper.")
        self.assertIn("not provided", r["summary"])
        self.assertFalse(r["stored"])
        self.assertIn("No photo or entry of the other car's license plate", r["missing"])
        self.assertIn("Police report number: not provided", r["missing"])
        self.assertNotIn("Other driver's name: not provided", r["missing"])
        sent = json.dumps(calls[0][1]["content"][0])
        self.assertIn("not provided", sent); self.assertNotIn("junk", sent)

    def test_fault_injury_cost_speed_rejected(self):
        for bad in ["The other driver was at fault.", "Driver was hurt.", "Repair will cost $2,000.", "Car was going 40 mph.", "I caused the crash"]:
            call, _ = stub({"photos": [{"index": 1, "damage": bad}], "summary": bad})
            r = CA.summarize([png()], ["scene"], CA.clean_answers({}), call=call)
            self.assertNotIn(bad, r["summary"]); self.assertIn("write your own", r["summary"])
            self.assertIn("describe it yourself", r["photos"][0]["damage"])

    def test_route_upstream_error_still_gives_missing(self):
        c = self.client({"LYLO_HACK_COLLISION_AI": "1"})
        def boom(*a, **k): raise muse.MuseError("NO_KEY", "x")
        with mock.patch.object(muse, "chat_json", boom):
            r = c.post("/api/v1/collision/summary", data={"answers": json.dumps({}), "have": json.dumps(["plates"]),
                                                            "photo": [(io.BytesIO(png()), "a.png")], "labels": '["plates"]'},
                       content_type="multipart/form-data")
        self.assertEqual(r.status_code, 502)
        self.assertNotIn("No photo or entry of the other car's license plate", r.get_json()["missing"])

    def test_no_debug_save_even_if_set(self):
        call, _ = stub({"photos": [], "summary": "ok"})
        with mock.patch.dict(os.environ, {"LYLO_HACK_VISION_DEBUG_SAVE": "1"}), mock.patch("builtins.open", side_effect=AssertionError("write")):
            CA.summarize([png()], ["scene"], CA.clean_answers({}), call=call)

    def test_too_many_photos(self):
        c = self.client({"LYLO_HACK_COLLISION_AI": "1"})
        files = [(io.BytesIO(png()), f"{i}.png") for i in range(7)]
        self.assertEqual(c.post("/api/v1/collision/summary", data={"photo": files}, content_type="multipart/form-data").status_code, 400)

    def test_rate_limited_like_vision(self):
        from lylo_hack import app as A
        self.assertIn("/api/v1/collision/summary", open(A.__file__).read())
