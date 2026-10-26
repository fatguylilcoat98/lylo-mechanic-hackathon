"""VIN-first tests: check digit, NHTSA decode (mocked), fail-open, cache, recalls, ledger, masking, routes."""
import io
import json
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
from lylo_hack import vin, muse, helper  # noqa: E402
from tests.test_detective import SCAN, good, fake as det_fake  # noqa: E402

VIN = "1HGCM82633A004352"  # NHTSA's published sample VIN
VPIC = {"Results": [{"ModelYear": "2003", "Make": "HONDA", "Model": "Accord", "Trim": "EX-V6", "DisplacementL": "3.0",
                     "EngineCylinders": "6", "FuelTypePrimary": "Gasoline", "ElectrificationLevel": ""}]}


def fetch_of(payload, calls=None):
    def f(url, timeout):
        if calls is not None:
            calls.append(url)
        if isinstance(payload, Exception):
            raise payload
        return payload
    return f


def jpeg():
    b = io.BytesIO()
    Image.new("RGB", (64, 48), (90, 90, 90)).save(b, "JPEG")
    return b.getvalue()


class Unit(unittest.TestCase):
    def setUp(self):
        vin._cache.clear()

    def test_check_digit(self):
        self.assertEqual(vin.validate(VIN), (True, ""))
        self.assertTrue(vin.validate(" 1hgcm82633a-004352 ")[0])
        self.assertFalse(vin.validate(VIN[:-1] + "3")[0])
        self.assertIn("I, O or Q", vin.validate(VIN[:8] + "O" + VIN[9:])[1])
        self.assertIn("17", vin.validate("123")[1])

    def test_decode_ok_cached_and_caveat(self):
        calls = []
        d = vin.decode(VIN, fetch=fetch_of(VPIC, calls))
        self.assertEqual((d["status"], d["name"], d["engine"]), ("ok", "2003 Honda Accord", "3.0L 6-cyl Gasoline"))
        self.assertEqual(d["caveat"], "assumes the factory engine (not swapped)")
        self.assertEqual(d["vin_masked"], "1HG**************")
        self.assertTrue(vin.decode(VIN, fetch=fetch_of(VPIC, calls))["cached"])
        self.assertEqual(len(calls), 1)
        self.assertIn("DecodeVinValues/" + VIN, calls[0])

    def test_decode_fail_open_and_invalid_no_network(self):
        self.assertEqual(vin.decode(VIN, fetch=fetch_of(TimeoutError("timed out")))["status"], "unknown")
        self.assertEqual(vin.decode(VIN, fetch=fetch_of({"Results": [{"ModelYear": "", "Make": ""}]}))["status"], "unknown")
        calls = []
        self.assertEqual(vin.decode(VIN[:-1] + "3", fetch=fetch_of(VPIC, calls))["status"], "invalid")
        self.assertEqual(calls, [])

    def test_recalls_labeled_and_fail_open(self):
        d = vin.decode(VIN, fetch=fetch_of(VPIC))
        r = vin.recalls(d, fetch=fetch_of({"results": [{"Component": "AIR BAGS:FRONTAL"}, {"Component": "ELECTRICAL SYSTEM"}]}))
        self.assertEqual((r["count"], r["components"]), (2, ["Air Bags", "Electrical System"]))
        self.assertIn("not checked against this exact VIN", r["source"])
        self.assertEqual(vin.recalls(d, fetch=fetch_of(OSError("x")))["status"], "unknown")

    def test_ledger_item_only_with_flag(self):
        data = {"vehicle_profile": {"vin": VIN}}
        with mock.patch.object(vin, "_get", fetch_of(VPIC)):
            self.assertEqual(vin.ledger_items(data), [])
            with mock.patch.dict(os.environ, {"LYLO_HACK_VIN": "1"}):
                [it] = vin.ledger_items(data)
        self.assertEqual((it["id"], it["source"], it["caveat"]), ("vin:decoded", "vin_decode", vin.CAVEAT))
        self.assertNotIn(VIN, json.dumps(it))

    def test_read_photo_never_guesses(self):
        ok = vin.read_photo(jpeg(), call=lambda *a, **k: ({"vin_visible": True, "vin": VIN, "unclear_characters": False}, {}))
        self.assertEqual((ok["vin_status"], ok["vin"]), ("read", VIN))
        for o in ({"vin_visible": True, "vin": VIN[:-1] + "3", "unclear_characters": False},
                  {"vin_visible": True, "vin": VIN, "unclear_characters": True},
                  {"vin_visible": False, "vin": "", "unclear_characters": False}):
            r = vin.read_photo(jpeg(), call=lambda *a, **k: (o, {}))
            self.assertEqual(r["vin_status"], "not_read")
            self.assertNotIn("vin", r)
            self.assertIn("Type it in instead", r["message"])


class Routes(unittest.TestCase):
    def setUp(self):
        vin._cache.clear()
        self.c = create_app().test_client()

    def test_flag_off_503(self):
        self.assertEqual(self.c.post("/api/v1/vin/decode", json={"vin": VIN}).status_code, 503)
        self.assertEqual(self.c.get("/healthz").get_json()["vin"], "off")

    def test_decode_route(self):
        with mock.patch.dict(os.environ, {"LYLO_HACK_VIN": "1"}), \
             mock.patch.object(vin, "_get", lambda url, t: VPIC if "vpic" in url else {"results": []}):
            bad = self.c.post("/api/v1/vin/decode", json={"vin": VIN[:-1] + "3"})
            ok = self.c.post("/api/v1/vin/decode", json={"vin": VIN}).get_json()
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(ok["vehicle"]["name"], "2003 Honda Accord")
        self.assertEqual(ok["recalls"]["count"], 0)

    def test_vin_photo_route_upstream_error_structured(self):
        def boom(*a, **k):
            raise muse.MuseError("RATE_LIMIT", "slow down")
        with mock.patch.dict(os.environ, {"LYLO_HACK_VIN": "1"}), mock.patch.object(muse, "chat_json", boom):
            r = self.c.post("/api/v1/vin/photo", data={"photo": (io.BytesIO(jpeg()), "v.jpg")}, content_type="multipart/form-data")
        self.assertEqual((r.status_code, r.get_json()["upstream_error"]), (424, "RATE_LIMIT"))

    def test_photo_helper_gets_vehicle_not_vin(self):
        seen = []

        def call(messages, schema, **kw):
            seen.append(messages)
            return {"shows_requested_area": True, "image_quality": "good", "hazards": ["none"], "engine_cover_hides_area": False,
                    "marks": [{"label": "Battery", "x": .5, "y": .5, "radius": .1, "confidence": .9, "seen": "box"}]}, {"model": "m"}
        with mock.patch.dict(os.environ, {"LYLO_HACK_VIN": "1", "LYLO_HACK_PHOTO_HELPER": "1"}), \
             mock.patch.object(vin, "_get", fetch_of(VPIC)), mock.patch.object(muse, "chat_json", call):
            j = self.c.post("/api/v1/photo/helper", data={"job": "battery", "vin": VIN, "photo": (io.BytesIO(jpeg()), "p.jpg")},
                            content_type="multipart/form-data").get_json()
        prompt = seen[0][0]["content"]
        self.assertIn("2003 Honda Accord", prompt)
        self.assertIn("assumes the factory engine", prompt)
        self.assertNotIn(VIN, json.dumps(seen))
        self.assertEqual(j["vehicle"]["name"], "2003 Honda Accord")

    def test_detective_ledger_has_vin_decode_and_no_raw_vin(self):
        seen = []
        with mock.patch.dict(os.environ, {"LYLO_HACK_VIN": "1", "LYLO_HACK_MUSE": "1"}), \
             mock.patch.object(vin, "_get", fetch_of(VPIC)), mock.patch.object(muse, "chat_json", det_fake(good(), seen=seen)):
            j = self.c.post("/api/v1/live/live", json=SCAN).get_json()
        sent = json.dumps(seen)
        self.assertIn('vin:decoded', sent)
        self.assertIn("vin_decode", sent)
        self.assertNotIn(VIN, sent)
        self.assertIn("vin:decoded", [i["id"] for i in j["detective"]["ledger"]])


if __name__ == "__main__":
    unittest.main()
