"""v0.5.1: V10 misfire (P0309/P0310, Mode 06 cyl 9/10), benign dash lights, VIN-decoder engine label. Synthetic data."""
import copy
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

from lylo_hack import prove as P, vision, vin, engine_user, live  # noqa: E402
from lylo_hack.app import create_app  # noqa: E402
from tests.test_detective import SCAN  # noqa: E402


def scan_with(codes):
    s = copy.deepcopy(SCAN)
    s["raw_dtcs"] = [{"code": c, "status": "active"} for c in codes]
    return s


class V10Misfire(unittest.TestCase):
    def test_codes_p0309_p0310_parse_to_cylinders_9_10(self):
        mf = P.misfire({"raw_dtcs": [{"code": "P0309"}, {"code": "P0310"}]})
        self.assertEqual([c["cylinder"] for c in mf["codes"]], [9, 10])  # c[-1] used to give 0 for P0310
        self.assertIn("P0310", P.MISFIRE_DTCS)
        self.assertIn("P0312", P.MISFIRE_DTCS)
        self.assertNotIn("P03010", P.MISFIRE_DTCS)

    def test_rule_prediction_for_cylinder_10_uses_p0310(self):
        mf = P.misfire({"raw_dtcs": [{"code": "P0310"}]})
        pred = P.rule_prediction({"raw_dtcs": [{"code": "P0310"}]}, mf)
        self.assertEqual(pred["pids"], ["P0310"])
        self.assertIn("Cylinder 10", pred["hypothesis"])
        P.validate(dict(pred))

    def test_mode06_cylinders_9_and_10(self):
        mf = P.misfire({"mode06": {"supported": True, "misfire_counts": {"1": 0, "9": 2, "10": 37, "13": 99}}})
        self.assertEqual(mf["per_cylinder_counts"], {1: 0, 9: 2, 10: 37})  # 13 is out of range
        self.assertEqual(mf["worst_cylinder"], 10)
        pred = P.rule_prediction({}, mf)
        self.assertEqual(pred["pids"], ["MISFIRE_COUNT_CYL10"])
        held = P.check(P.validate(pred), 0, [{"t": 5, "pid": "MISFIRE_COUNT_CYL10", "value": 40}])
        self.assertEqual(held["status"], "HELD")

    def test_p0310_raises_safety_like_p0301(self):
        c = create_app().test_client()
        base = c.post("/api/v1/live/live", json=scan_with([])).get_json()["safety"]["level"]
        lv1 = c.post("/api/v1/live/live", json=scan_with(["P0301"])).get_json()["safety"]["level"]
        lv10 = c.post("/api/v1/live/live", json=scan_with(["P0310"])).get_json()["safety"]["level"]
        lv9 = c.post("/api/v1/live/live", json=scan_with(["P0309"])).get_json()["safety"]["level"]
        self.assertEqual(lv10, lv1)
        self.assertEqual(lv9, lv1)
        self.assertNotEqual(lv1, base)


def item(name, color="amber", conf="high"):
    return {"id": f"photo:{name}:{color}", "type": "photo_warning_light", "name": name, "color": color, "confidence": conf}


class BenignDashLights(unittest.TestCase):
    def test_benign_lights_never_escalate(self):
        for n in ("seatbelt", "door_ajar", "headlight_or_high_beam", "washer_fluid", "turn_signal", "cruise_control"):
            for c in ("amber", "red"):
                self.assertEqual(vision.floor_for([item(n, c)]), (None, []), (n, c))

    def test_serious_lights_still_escalate(self):
        for n in ("check_engine", "abs", "airbag", "battery_charging", "parking_brake"):
            self.assertEqual(vision.floor_for([item(n)])[0], "INSPECT_SOON", n)
        for n in ("oil_pressure", "coolant_temperature", "brake_system"):
            self.assertEqual(vision.floor_for([item(n, "red")])[0], "DO_NOT_DRIVE", n)

    def test_benign_plus_serious_still_raises(self):
        self.assertEqual(vision.floor_for([item("seatbelt"), item("check_engine")])[0], "INSPECT_SOON")

    def test_kill_switch_restores_old_behaviour(self):
        with mock.patch.dict(os.environ, {"LYLO_HACK_BENIGN_LIGHTS": "0"}):
            self.assertEqual(vision.floor_for([item("seatbelt")])[0], "INSPECT_SOON")

    def test_benign_item_is_noted_and_labeled(self):
        out = {"is_vehicle_photo": True, "photo_kind": "dashboard", "image_quality": "good",
               "findings": [{"kind": "warning_light", "name": "seatbelt", "color": "amber", "description": "belt", "confidence": "high"}]}
        items = vision.to_items(out)
        self.assertEqual(len(items), 1)
        self.assertIn("not a safety problem", items[0]["safety_note"])

    def test_photo_can_raise_never_lower(self):
        from lylo_hack.safety import apply_floor
        r = {"safety": {"level": "DO_NOT_DRIVE"}}
        apply_floor(r, None, "", "photo")
        self.assertEqual(r["safety"]["level"], "DO_NOT_DRIVE")


VPIC_S = {"Results": [{"ModelYear": "1998", "Make": "FORD", "Model": "E-450", "DisplacementL": "10.3", "EngineCylinders": "6",
                       "FuelTypePrimary": "Diesel", "EngineManufacturer": "Caterpillar", "EngineModel": "3176"}]}


def synthetic_vin(eight="S"):
    base = "1FDXE45" + eight + "0WHA00001"
    return base[:8] + vin.check_digit(base) + base[9:]


class VinEngineLabel(unittest.TestCase):
    def setUp(self):
        vin._cache.clear()

    def test_decode_labels_engine_unverified_and_keeps_fields(self):
        d = vin.decode(synthetic_vin(), fetch=lambda u, t: VPIC_S)
        self.assertEqual(d["engine"], "10.3L 6-cyl Diesel")  # fields map straight through: vPIC's data, not a parse swap
        self.assertEqual(d["engine_label"], "VIN decoder says (unverified)")
        self.assertEqual(d["engine_maker"], "Caterpillar 3176")
        self.assertEqual(d["engine_code"], "S")
        self.assertIn("VIN decoder says (unverified)", vin.prompt_line(d))

    def test_ford_code_s_hint_names_the_v10(self):
        d = vin.decode(synthetic_vin(), fetch=lambda u, t: VPIC_S)
        with mock.patch.dict(os.environ, {"LYLO_HACK_ENGINE_OVERRIDE": "1"}):
            h = engine_user.decode_hint(d)
        self.assertIn("6.8L V10 Triton", h)
        with mock.patch.dict(os.environ, {"LYLO_HACK_ENGINE_OVERRIDE": "0"}):
            self.assertIsNone(engine_user.decode_hint(d))
        vin._cache.clear()
        d2 = vin.decode(synthetic_vin("F"), fetch=lambda u, t: VPIC_S)
        with mock.patch.dict(os.environ, {"LYLO_HACK_ENGINE_OVERRIDE": "1"}):
            self.assertEqual(engine_user.decode_hint(d2), engine_user.HINT)  # generic hint for other codes


if __name__ == "__main__":
    unittest.main()
