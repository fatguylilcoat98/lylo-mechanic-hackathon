"""v0.6 judge web demo + JSON photo_evidence. All Muse calls off/stubbed."""
import io, os, unittest
from unittest import mock

os.environ["LYLO_HACK_ENV_FILE"] = "none"
os.environ["HTTPS_PROXY"] = os.environ["HTTP_PROXY"] = "http://127.0.0.1:9"

from lylo_hack.app import create_app  # noqa: E402

PE = [{"id": "photo:1", "name": "oil_pressure", "color": "red", "confidence": "high", "description": "oil light"}]
BASE = {"LYLO_HACK_MUSE": "0", "LYLO_HACK_REQUIRE_APP_KEY": "1", "LYLO_HACK_APP_KEY_SHA256": "00", "LYLO_HACK_NO_ADAPTER": "1"}


def app(extra, db):
    env = dict(BASE, LYLO_HACK_RATELIMIT_DB=db, **extra)
    with mock.patch.dict(os.environ, env):
        for k in ("LYLO_HACK_WEB_DEMO", "LYLO_HACK_JSON_PHOTO"):
            if k not in extra:
                os.environ.pop(k, None)
        return create_app().test_client(), env


class WebDemo(unittest.TestCase):
    def setUp(self):
        self.db = f"/tmp/lylo-webdemo-{os.getpid()}-{id(self)}.sqlite"

    def tearDown(self):
        if os.path.exists(self.db):
            os.remove(self.db)

    def test_flag_off_no_routes(self):
        c, env = app({}, self.db)
        with mock.patch.dict(os.environ, env):
            os.environ.pop("LYLO_HACK_WEB_DEMO", None)
            self.assertEqual(c.get("/try").status_code, 404)
            self.assertEqual(c.post("/try/check", json={"text": "x"}).status_code, 404)

    def test_flag_off_json_photo_dropped_as_before(self):
        c, env = app({"LYLO_HACK_REQUIRE_APP_KEY": "0"}, self.db)
        with mock.patch.dict(os.environ, env):
            os.environ.pop("LYLO_HACK_WEB_DEMO", None); os.environ.pop("LYLO_HACK_JSON_PHOTO", None)
            b = c.post("/api/v1/noadapter/check", json={"codes": "P0171", "photo_evidence": PE}).get_json()
            self.assertEqual(b["final_safety_level"], "INSPECT_SOON")

    def test_json_photo_flag_raises_level(self):
        c, env = app({"LYLO_HACK_REQUIRE_APP_KEY": "0", "LYLO_HACK_JSON_PHOTO": "1"}, self.db)
        with mock.patch.dict(os.environ, env):
            b = c.post("/api/v1/noadapter/check", json={"codes": "P0171", "photo_evidence": PE}).get_json()
            self.assertNotEqual(b["final_safety_level"], "INSPECT_SOON")
            self.assertTrue(any(i.get("source") == "photo" for i in b["ledger"]))

    def test_page_has_no_key_and_check_works_without_key(self):
        c, env = app({"LYLO_HACK_WEB_DEMO": "1"}, self.db)
        with mock.patch.dict(os.environ, env):
            page = c.get("/try").get_data(as_text=True)
            self.assertIn("LYLO Mechanic", page); self.assertNotIn("X-LYLO-App-Key", page)
            self.assertEqual(c.post("/api/v1/noadapter/check", json={"codes": "P0171"}).status_code, 401)
            r = c.post("/try/check", json={"text": "smoke from the hood", "photo_evidence": PE})
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.get_json()["mode"], "no_adapter")

    def test_rejects_extra_fields_and_scan_on_dash(self):
        c, env = app({"LYLO_HACK_WEB_DEMO": "1"}, self.db)
        with mock.patch.dict(os.environ, env):
            self.assertEqual(c.post("/try/check", json={"text": "x", "audio": "y"}).status_code, 400)
            r = c.post("/try/dash", data={"scan": "{}", "photo": (io.BytesIO(b"x"), "a.jpg")}, content_type="multipart/form-data")
            self.assertEqual(r.status_code, 400)

    def test_per_ip_limit_and_global_cap(self):
        c, env = app({"LYLO_HACK_WEB_DEMO": "1", "LYLO_HACK_WEB_IP_PER_MIN": "2", "LYLO_HACK_WEB_DAILY_CAP": "1000"}, self.db)
        with mock.patch.dict(os.environ, env):
            codes = [c.post("/try/check", json={"codes": "P0171"}).status_code for _ in range(3)]
            self.assertEqual(codes, [200, 200, 429])
        c, env = app({"LYLO_HACK_WEB_DEMO": "1", "LYLO_HACK_WEB_DAILY_CAP": "1"}, self.db + "2")
        with mock.patch.dict(os.environ, env):
            self.assertEqual([c.post("/try/check", json={"codes": "P0171"}).status_code for _ in range(2)], [200, 429])
        os.remove(self.db + "2")


if __name__ == "__main__":
    unittest.main()
