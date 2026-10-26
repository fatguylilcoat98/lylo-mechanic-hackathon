import os
import unittest
os.environ.setdefault("LYLO_HACK_ENV_FILE", "none")
from lylo_hack import wiring, detective  # noqa: E402


class Wiring(unittest.TestCase):
    def test_circuit_codes(self):
        for c in ("P0135", "P0141", "P0031", "P0113", "P0335", "P0102"):
            self.assertTrue(wiring.is_circuit_code(c), c)
        for c in ("P0420", "P0171", "P0300", "P0442", "U0100"):
            self.assertFalse(wiring.is_circuit_code(c), c)
        self.assertTrue(wiring.is_circuit_code("P2A00", "O2 Sensor Circuit Range/Performance"))

    def test_hint_item(self):
        it = wiring.hint_item([{"type": "dtc", "code": "P0135"}, {"type": "dtc", "code": "P0420"}])
        self.assertEqual(it["id"], "rule:wiring_first")
        self.assertEqual(it["codes"], ["P0135"])
        self.assertIn("Often it's the wire or plug, not the sensor", it["text"])
        self.assertIsNone(wiring.hint_item([{"type": "dtc", "code": "P0420"}]))

    def test_detective_prompt_and_ledger(self):
        self.assertIn("rule:wiring_first", detective.INSTRUCTIONS)
        seen = []

        def call(messages, schema, **kw):
            seen.append(messages)
            raise detective.muse.MuseError("TIMEOUT", "t")
        os.environ["LYLO_HACK_MUSE"] = "1"
        try:
            res = {"safety": {"level": "INSPECT_SOON"}}
            detective.run({"raw_dtcs": [{"code": "P0135", "status": "active"}]}, res, call=call)
        finally:
            os.environ["LYLO_HACK_MUSE"] = "0"
        self.assertTrue(any(i["id"] == "rule:wiring_first" for i in res["detective"]["ledger"]))
        self.assertIn("rule:wiring_first", seen[0][1]["content"])
