import os
import unittest

os.environ["LYLO_HACK_MUSE"] = "0"
os.environ["LYLO_HACK_ENV_FILE"] = "none"
os.environ["HTTPS_PROXY"] = os.environ["HTTP_PROXY"] = "http://127.0.0.1:9"

from lylo_hack.detective import cap_for_cold_engine, cold_engine_no_codes  # noqa: E402

COLD = [{"id": "pid:ENGINE_COOLANT_TEMP", "type": "pid", "name": "ENGINE_COOLANT_TEMP", "value": 79, "unit": "°F"}]
WARM = [{"id": "pid:ENGINE_COOLANT_TEMP", "type": "pid", "name": "ENGINE_COOLANT_TEMP", "value": 195, "unit": "°F"}]
DTC = [{"id": "dtc:P0171:active", "type": "dtc", "code": "P0171", "status": "active"}]


class ColdEngine(unittest.TestCase):
    def test_detect(self):
        self.assertEqual(cold_engine_no_codes(COLD), (True, 79))
        self.assertFalse(cold_engine_no_codes(WARM)[0])
        self.assertFalse(cold_engine_no_codes(COLD + DTC)[0])
        self.assertEqual(cold_engine_no_codes([{**COLD[0], "value": 20, "unit": "°C"}]), (True, 68))
        self.assertEqual(cold_engine_no_codes([]), (False, None))

    def test_ai_capped_at_inspect_soon(self):
        lv, act, note = cap_for_cold_engine("SAFE_TO_DRIVE", "DO_NOT_DRIVE", "raised_by_detective", COLD)
        self.assertEqual((lv, act), ("INSPECT_SOON", "raised_by_detective"))
        self.assertIn("recheck when the engine is warm", note)

    def test_inspect_soon_allowed(self):
        self.assertEqual(cap_for_cold_engine("SAFE_TO_DRIVE", "INSPECT_SOON", "raised_by_detective", COLD)[:2],
                         ("INSPECT_SOON", "raised_by_detective"))

    def test_never_below_rule_level(self):
        lv, act, _ = cap_for_cold_engine("DO_NOT_DRIVE", "TOW_RECOMMENDED", "raised_by_detective", COLD)
        self.assertEqual((lv, act), ("DO_NOT_DRIVE", "kept_rule_level"))
        self.assertEqual(cap_for_cold_engine("DO_NOT_DRIVE", "DO_NOT_DRIVE", "kept_rule_level", COLD)[0], "DO_NOT_DRIVE")

    def test_warm_or_codes_uncapped(self):
        self.assertEqual(cap_for_cold_engine("SAFE_TO_DRIVE", "DO_NOT_DRIVE", "raised_by_detective", WARM),
                         ("DO_NOT_DRIVE", "raised_by_detective", None))
        self.assertEqual(cap_for_cold_engine("SAFE_TO_DRIVE", "DO_NOT_DRIVE", "raised_by_detective", COLD + DTC)[0],
                         "DO_NOT_DRIVE")


if __name__ == "__main__":
    unittest.main()
