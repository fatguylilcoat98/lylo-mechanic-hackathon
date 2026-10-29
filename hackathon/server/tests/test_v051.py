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

    def test_lowercase_code_classified_like_uppercase(self):
        import sys
        from types import SimpleNamespace as NS
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "baseline", "backend"))
        from safety.safety_classifier import classify_safety

        def lvl(code):
            st = NS(vehicle=NS(is_hybrid=False, is_ev=False, year=1998, make="FORD", model="E-450", engine="6.8L V10", fuel_type="gasoline", vin=None), dtcs=[NS(code=code, status="active", is_safety_related=False, system="powertrain",
                                           category="SAE_standard", description="", cascade_candidate=False, freeze_frame_attached=False)],
                    pids=[], freeze_frame=None, readiness_monitors=[], session_flags=[], connection_quality="good", read_complete=True)
            return classify_safety(st, None).level
        self.assertEqual(lvl("p0310"), lvl("P0310"))
        self.assertEqual(lvl(" p0301 "), lvl("P0301"))
        self.assertNotEqual(lvl("P0310"), lvl("P0000"))


class LockChainFields(unittest.TestCase):
    def test_lock_returns_chain_fields(self):
        r = {"safety": {"level": "SAFE_TO_DRIVE", "triggering_conditions": []}, "detective": {}}
        sid = P.lock(r, {"raw_dtcs": [{"code": "P0310", "status": "active"}]}, now=1000.0, store=P.Store())
        pr = r["detective"]["prove"]
        self.assertTrue(sid)
        self.assertIs(pr["chain_ok"], True)
        self.assertRegex(pr["head_sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(pr["head_sha256"], pr["lock_sha256"])
        self.assertEqual(pr["head_sha256"], pr["ledger"][-1]["sha256"])
        self.assertEqual(r["detective"]["prediction"]["status"], "LOCKED")

    def test_no_prediction_has_no_chain_fields(self):
        r = {"safety": {"level": "SAFE_TO_DRIVE", "triggering_conditions": []}, "detective": {}}
        self.assertIsNone(P.lock(r, {"raw_dtcs": []}, store=P.Store()))
        self.assertNotIn("head_sha256", r["detective"]["prove"])


def item(name, color="amber", conf="high"):
    return {"id": f"photo:{name}:{color}", "type": "photo_warning_light", "name": name, "color": color, "confidence": conf}


ON = {"LYLO_HACK_BENIGN_LIGHTS": "1"}


class BenignDashLights(unittest.TestCase):
    def test_benign_lights_never_escalate(self):
        with mock.patch.dict(os.environ, ON):
            for n in ("seatbelt", "door_ajar", "headlight_or_high_beam", "washer_fluid", "turn_signal", "cruise_control"):
                for c in ("amber", "red"):
                    self.assertEqual(vision.floor_for([item(n, c)]), (None, []), (n, c))

    def test_serious_lights_still_escalate(self):
        with mock.patch.dict(os.environ, ON):
            for n in ("check_engine", "abs", "airbag", "battery_charging", "parking_brake"):
                self.assertEqual(vision.floor_for([item(n)])[0], "INSPECT_SOON", n)
            for n in ("oil_pressure", "coolant_temperature", "brake_system"):
                self.assertEqual(vision.floor_for([item(n, "red")])[0], "DO_NOT_DRIVE", n)

    def test_red_parking_brake_same_floor_as_brake_system(self):
        with mock.patch.dict(os.environ, ON):
            for conf in ("low", "medium", "high"):
                self.assertEqual(vision.floor_for([item("parking_brake", "red", conf)])[0],
                                 vision.floor_for([item("brake_system", "red", conf)])[0], conf)
            self.assertEqual(vision.floor_for([item("parking_brake", "red")])[0], "DO_NOT_DRIVE")

    def test_benign_plus_serious_still_raises(self):
        with mock.patch.dict(os.environ, ON):
            self.assertEqual(vision.floor_for([item("seatbelt"), item("check_engine")])[0], "INSPECT_SOON")

    def test_flag_is_opt_in(self):
        for v in (None, "0", "", "true", "yes"):
            env = {} if v is None else {"LYLO_HACK_BENIGN_LIGHTS": v}
            with mock.patch.dict(os.environ, env):
                if v is None:
                    os.environ.pop("LYLO_HACK_BENIGN_LIGHTS", None)
                self.assertFalse(vision.benign_on(), v)
                self.assertEqual(vision.floor_for([item("seatbelt")])[0], "INSPECT_SOON")
                self.assertIs(vision.schema(), vision.SCHEMA)
                self.assertNotIn("parking_brake", vision.lights())

    def test_benign_item_is_noted_and_labeled(self):
        out = {"is_vehicle_photo": True, "photo_kind": "dashboard", "image_quality": "good",
               "findings": [{"kind": "warning_light", "name": "seatbelt", "color": "amber", "description": "belt", "confidence": "high"}]}
        with mock.patch.dict(os.environ, ON):
            items = vision.to_items(out)
            self.assertIn("not a safety problem", items[0]["safety_note"])
            self.assertIn("parking_brake", vision.schema()["properties"]["findings"]["items"]["properties"]["name"]["enum"])
        os.environ.pop("LYLO_HACK_BENIGN_LIGHTS", None)
        self.assertNotIn("safety_note", vision.to_items(out)[0])

    def test_photo_can_raise_never_lower(self):
        from lylo_hack.safety import apply_floor
        r = {"safety": {"level": "DO_NOT_DRIVE"}}
        apply_floor(r, None, "", "photo")
        self.assertEqual(r["safety"]["level"], "DO_NOT_DRIVE")


def _old_vision():
    """vision.py exactly as at 58995b9 (v0.5.0), loaded as a sibling module of lylo_hack."""
    import importlib.util, subprocess, sys
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    try:
        src = subprocess.run(["git", "-C", root, "show", "58995b9:hackathon/server/lylo_hack/vision.py"],
                             capture_output=True, text=True, timeout=20, check=True).stdout
    except Exception:  # noqa: BLE001
        return None
    spec = importlib.util.spec_from_loader("lylo_hack._vision_v050", loader=None)
    mod = importlib.util.module_from_spec(spec)
    mod.__package__ = "lylo_hack"
    sys.modules[spec.name] = mod
    exec(compile(src, "vision_v050.py", "exec"), mod.__dict__)
    return mod


class FlagUnsetMatchesV050(unittest.TestCase):
    def test_flag_unset_matches_58995b9_exactly(self):
        old = _old_vision()
        if old is None:
            if os.environ.get("LYLO_ALLOW_NO_GIT") == "1":
                self.skipTest("git history for 58995b9 not available (LYLO_ALLOW_NO_GIT=1)")
            self.fail("v0.5.0 parity test needs git history for 58995b9 (set LYLO_ALLOW_NO_GIT=1 to skip explicitly)")
        os.environ.pop("LYLO_HACK_BENIGN_LIGHTS", None)
        self.assertEqual(vision.LIGHTS, old.LIGHTS)
        self.assertEqual(vision.schema(), old.SCHEMA)
        names = old.LIGHTS + old.ISSUES + vision.NEW_LIGHTS + ["bogus"]
        n = 0
        for name in names:
            for kind in ("warning_light", "visible_issue"):
                for color in ("red", "amber", "green", "blue", "white", "unclear", None):
                    for conf in ("low", "medium", "high", "weird"):
                        out = {"is_vehicle_photo": True, "photo_kind": "dashboard", "image_quality": "good",
                               "findings": [{"kind": kind, "name": name, "color": color, "description": "d", "confidence": conf},
                                            {"kind": kind, "name": name, "color": color, "description": "d2", "confidence": conf}]}
                        a, b = vision.to_items(out), old.to_items(out)
                        self.assertEqual(a, b, (name, color, conf))
                        self.assertEqual(vision.floor_for(a), old.floor_for(b), (name, color, conf))
                        n += 1
        mixed = [item(x, c) for x in old.LIGHTS for c in ("red", "amber")]
        self.assertEqual(vision.floor_for(mixed), old.floor_for(mixed))
        self.assertGreater(n, 1000)

    def test_analyze_output_matches_when_unset(self):
        old = _old_vision()
        if old is None:
            if os.environ.get("LYLO_ALLOW_NO_GIT") == "1":
                self.skipTest("git history for 58995b9 not available (LYLO_ALLOW_NO_GIT=1)")
            self.fail("v0.5.0 parity test needs git history for 58995b9 (set LYLO_ALLOW_NO_GIT=1 to skip explicitly)")
        os.environ.pop("LYLO_HACK_BENIGN_LIGHTS", None)
        import io
        from PIL import Image
        buf = io.BytesIO(); Image.new("RGB", (64, 48), (90, 90, 90)).save(buf, "JPEG")
        seen = []
        out = {"is_vehicle_photo": True, "photo_kind": "dashboard", "image_quality": "good",
               "findings": [{"kind": "warning_light", "name": "seatbelt", "color": "amber", "description": "d", "confidence": "high"},
                            {"kind": "warning_light", "name": "parking_brake", "color": "red", "description": "d", "confidence": "high"}]}

        def fake(messages, schema, **kw):
            seen.append(schema)
            return out, {"model": "m", "latency_ms": 1}
        a, b = vision.analyze(buf.getvalue(), call=fake), old.analyze(buf.getvalue(), call=fake)
        self.assertEqual(a, b)
        self.assertEqual(seen[0], seen[1])
        self.assertEqual(a["photo_safety_floor"], "INSPECT_SOON")  # seatbelt escalates as in v0.5.0


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
