"""v0.4.8 owner-set engine ("Not my engine?"). Synthetic data; all network and Muse calls mocked."""
import copy
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

from lylo_hack.app import create_app  # noqa: E402
from lylo_hack import vin, muse, engine_user as E  # noqa: E402
from lylo_hack.validation import validate_live_payload  # noqa: E402
from tests.test_detective import SCAN, good, fake as det_fake  # noqa: E402
from tests.test_vin import fetch_of, VIN  # noqa: E402

# Synthetic vPIC answer shaped like an old Ford cutaway decoded as diesel.
VPIC_DIESEL = {"Results": [{"ModelYear": "1998", "Make": "FORD", "Model": "E-450", "Trim": "", "DisplacementL": "10.3",
                            "EngineCylinders": "6", "FuelTypePrimary": "Diesel", "ElectrificationLevel": ""}]}
ON = {"LYLO_HACK_ENGINE_OVERRIDE": "1"}


def scan_with(**vp):
    s = copy.deepcopy(SCAN)
    s.setdefault("vehicle_profile", {}).update(vp)
    s["vehicle_profile"]["vin"] = VIN
    return s


class UnitTests(unittest.TestCase):
    def test_off_ignores_everything(self):
        with mock.patch.dict(os.environ, {"LYLO_HACK_ENGINE_OVERRIDE": ""}):
            self.assertIsNone(E.from_fields({"engine_user": "6.8L V10", "fuel_user": "gas"}))
            self.assertEqual(E.validation_errors({"engine_user": 5, "fuel_user": "rocket"}), [])
            items = [{"id": "vin:decoded", "engine": "10.3L 6-cyl Diesel"}]
            self.assertEqual(E.apply_to_items(items, {"vehicle_profile": {"engine_user": "x"}}),
                             [{"id": "vin:decoded", "engine": "10.3L 6-cyl Diesel"}])
            self.assertIsNone(E.decode_hint({"status": "ok", "make": "Ford", "model": "E-450", "engine": "10.3L Diesel"}))

    def test_clean_caps_and_strips(self):
        self.assertEqual(E.clean_engine("  6.8L   V10 <b>Triton</b>\n"), "6.8L V10 bTriton/b")
        self.assertEqual(len(E.clean_engine("V" * 500)), E.MAX_ENGINE)
        self.assertEqual(E.clean_engine(42), "")
        self.assertEqual(E.clean_fuel("GAS"), "gas")
        self.assertEqual(E.clean_fuel("rocket"), "")

    def test_from_fields_labels(self):
        with mock.patch.dict(os.environ, ON):
            ov = E.from_fields({"engine_user": "6.8L V10 Triton", "fuel_user": "gas"})
            self.assertEqual(ov["label"], "6.8L V10 Triton Gas")
            self.assertEqual(ov["engine_source"], "set by owner")
            self.assertEqual(E.from_fields({"fuel_user": "diesel"})["label"], "Diesel")
            self.assertEqual(E.from_fields({"engine_user": "7.3 diesel", "fuel_user": "diesel"})["label"], "7.3 diesel")
            self.assertEqual(E.from_fields({"fuel_user": "not_sure"})["label"], "Owner is not sure of the engine")
            self.assertIsNone(E.from_fields({"engine_user": "", "fuel_user": ""}))

    def test_validation_on(self):
        with mock.patch.dict(os.environ, ON):
            self.assertTrue(E.validation_errors({"engine_user": 5}))
            self.assertTrue(E.validation_errors({"fuel_user": "rocket"}))
            self.assertTrue(E.validation_errors({"engine_user": "x" * 201}))
            self.assertEqual(E.validation_errors({"engine_user": "6.8L V10", "fuel_user": "gas", "engine_source": "user"}), [])
            self.assertTrue(validate_live_payload(scan_with(fuel_user="rocket")))
        self.assertEqual(validate_live_payload(scan_with(fuel_user="rocket")), [])  # off: unchanged (ignored)

    def test_hint_only_ford_e_f_diesel(self):
        with mock.patch.dict(os.environ, ON):
            d = {"status": "ok", "make": "Ford", "model": "E-450", "engine": "10.3L 6-cyl Diesel"}
            self.assertIn("may be wrong for this VIN", E.decode_hint(d))  # wording stays cautious
            self.assertIsNotNone(E.decode_hint(dict(d, model="F-350")))
            self.assertIsNone(E.decode_hint(dict(d, engine="6.8L 10-cyl Gasoline")))
            self.assertIsNone(E.decode_hint(dict(d, make="Ram", model="3500")))
            self.assertIsNone(E.decode_hint(dict(d, model="Transit")))
            self.assertNotIn("engine code", E.decode_hint(d).lower())  # never asserts anything about the engine code


class RouteTests(unittest.TestCase):
    def setUp(self):
        vin._cache.clear()
        self.c = create_app().test_client()

    def test_decode_route_hint(self):
        get = lambda url, t: VPIC_DIESEL if "vpic" in url else {"results": []}  # noqa: E731
        with mock.patch.dict(os.environ, {"LYLO_HACK_VIN": "1"}), mock.patch.object(vin, "_get", get):
            off = self.c.post("/api/v1/vin/decode", json={"vin": VIN}).get_json()
            vin._cache.clear()
            with mock.patch.dict(os.environ, ON):
                on = self.c.post("/api/v1/vin/decode", json={"vin": VIN}).get_json()
        self.assertNotIn("engine_check_hint", off)
        self.assertIn("may be wrong", on["engine_check_hint"])
        self.assertEqual(on["vehicle"]["engine"], "10.3L 6-cyl Diesel")  # decode itself is not altered

    def _live(self, env, scan):
        seen = []
        with mock.patch.dict(os.environ, {"LYLO_HACK_VIN": "1", "LYLO_HACK_MUSE": "1", **env}), \
             mock.patch.object(vin, "_get", fetch_of(VPIC_DIESEL)), mock.patch.object(muse, "chat_json", det_fake(good(), seen=seen)):
            j = self.c.post("/api/v1/live/live", json=scan).get_json()
        return j, seen

    def test_live_prefers_owner_engine(self):
        scan = scan_with(engine_user="6.8L V10 Triton", fuel_user="gas", engine_source="user")
        off, seen_off = self._live({}, scan)
        vin._cache.clear()
        on, seen_on = self._live(ON, scan)
        dec_off = [i for i in off["detective"]["ledger"] if i["id"] == "vin:decoded"][0]
        self.assertEqual(dec_off["engine"], "10.3L 6-cyl Diesel")
        self.assertFalse(any(i["id"] == "veh:engine_user" for i in off["detective"]["ledger"]))
        led = on["detective"]["ledger"]
        dec = [i for i in led if i["id"] == "vin:decoded"][0]
        self.assertEqual(dec["engine"], "6.8L V10 Triton Gas")
        self.assertEqual(dec["engine_source"], "set by owner")
        self.assertNotIn("nhtsa_engine", dec)
        self.assertEqual(on["vehicle_engine"], {"engine": "6.8L V10 Triton Gas", "engine_source": "set by owner",
                                                "nhtsa_engine": "10.3L 6-cyl Diesel"})  # phone only
        self.assertTrue(any(i["id"] == "veh:engine_user" and i["fuel"] == "gas" for i in led))
        prompt = json.dumps(seen_on, default=str)
        self.assertIn("6.8L V10 Triton", prompt)
        self.assertIn("10.3L 6-cyl Diesel", json.dumps(seen_off, default=str))  # off: decoded engine reaches the model as before

    def test_decoded_engine_never_reaches_model(self):
        """Vera review: with the owner's engine set, the decoded engine is in no model-bound byte."""
        scan = scan_with(engine_user="6.8L V10 Triton", fuel_user="gas", engine_source="user", engine="10.3L 6-cyl Diesel")
        on, seen = self._live(ON, scan)
        self.assertTrue(seen)
        prompt = json.dumps(seen, default=str)
        ledger = json.dumps(on["detective"]["ledger"])
        for blob in (prompt, ledger):
            self.assertNotIn("10.3L", blob)
            self.assertNotIn("6-cyl Diesel", blob)
        # unit level: apply_to_items and apply_to_decode output
        res = {}
        with mock.patch.dict(os.environ, ON):
            items = E.apply_to_items([{"id": "vin:decoded", "engine": "10.3L 6-cyl Diesel"},
                                      {"id": "veh:engine", "value": "10.3L 6-cyl Diesel"}],
                                     {"vehicle_profile": {"engine_user": "6.8L V10", "fuel_user": "gas"}}, res)
            dec = E.apply_to_decode({"status": "ok", "name": "1998 Ford E-450", "engine": "10.3L 6-cyl Diesel"},
                                    E.from_fields({"engine_user": "6.8L V10", "fuel_user": "gas"}))
        self.assertNotIn("10.3L", json.dumps(items))
        self.assertNotIn("10.3L", json.dumps(dec))
        self.assertNotIn("10.3L", vin.prompt_line(dec))
        self.assertEqual(res["vehicle_engine"]["nhtsa_engine"], "10.3L 6-cyl Diesel")

    def test_noadapter_engine(self):
        body = {"text": "check engine light is on", "make": "Ford", "model": "E-450", "year": "1998",
                "engine_user": "6.8L V10 Triton", "fuel_user": "gas"}
        with mock.patch.dict(os.environ, {"LYLO_HACK_NO_ADAPTER": "1"}):
            off = self.c.post("/api/v1/noadapter/check", json=body).get_json()
            with mock.patch.dict(os.environ, ON):
                on = self.c.post("/api/v1/noadapter/check", json=body).get_json()
        self.assertNotIn("vehicle_engine", off)
        self.assertFalse(any(i["id"] == "veh:engine_user" for i in off["ledger"]))
        self.assertEqual(on["vehicle_engine"], {"engine": "6.8L V10 Triton Gas", "engine_source": "set by owner"})
        self.assertTrue(any(i["id"] == "veh:engine_user" for i in on["ledger"]))
        self.assertEqual(off["final_safety_level"], on["final_safety_level"])  # the engine never changes the rule level


if __name__ == "__main__":
    unittest.main()
