"""Muse Detective tests with mocked Muse (no network, no spend)."""
import json
import os
import unittest
from unittest import mock

os.environ["LYLO_HACK_MUSE"] = "0"
os.environ["LYLO_HACK_ENV_FILE"] = "none"
os.environ["HTTPS_PROXY"] = os.environ["HTTP_PROXY"] = "http://127.0.0.1:9"

from lylo_hack.app import create_app  # noqa: E402
from lylo_hack import detective, ledger, muse  # noqa: E402

VIN = "1HGCM82633A004352"
SCAN = {
    "adapter_id": "Chris's OBDLink", "vehicle_profile": {"vin": VIN, "year": 2015, "make": "Mazda", "model": "CX-5", "odometer": 98000},
    "raw_dtcs": [{"code": "P0171", "status": "permanent"}, {"code": "P0420", "status": "pending"}],
    "raw_pids": [{"name": "LONG_TERM_FUEL_TRIM_B1", "pid_code": "07", "raw_value": 14.8, "unit": "%"},
                 {"name": "WARMUPS_SINCE_CLEAR", "pid_code": "30", "raw_value": 3, "unit": ""}],
    "readiness_monitors": [{"name": "Catalyst", "status": "incomplete"}],
    "codes_cleared_before_scan": True, "codes_cleared_evidence": ["Only 3 warm-ups since codes were cleared (under 10)."],
    "freeze_frame": {"dtc": "P0171", "values": {"ENGINE_RPM": 2100}},
}


def good(level="DRIVE_SHORT_DISTANCE_ONLY", **over):
    out = {"hypotheses": [{"rank": 1, "cause": "Vacuum leak", "reasoning": "Lean code plus high trim",
                           "confidence": "medium", "cites": ["dtc:P0171:permanent", "pid:LONG_TERM_FUEL_TRIM_B1"], "next_check": "smoke test"}],
           "explanation": {"text": "The engine runs lean.", "cites": ["dtc:P0171:permanent"]},
           "cleared_codes_warning": {"text": "Codes were wiped recently.", "cites": ["clr:flag", "pid:WARMUPS_SINCE_CLEAR", "clr:e1"]},
           "safety_opinion": {"level": level, "reason": "r", "cites": ["rule:safety"]}}
    out.update(over)
    return out


def fake(out=None, exc=None, seen=None):
    def call(messages, schema, **kw):
        if seen is not None:
            seen.append(messages)
        if exc:
            raise exc
        return out, {"model": "muse-spark-1.3", "latency_ms": 5, "usage": {"prompt_tokens": 10, "completion_tokens": 5}, "finish_reason": "stop"}
    return call


class DetectiveTests(unittest.TestCase):
    def setUp(self):
        self.c = create_app().test_client()

    def run_det(self, call, data=SCAN):
        with mock.patch.dict(os.environ, {"LYLO_HACK_MUSE": "1"}):
            with mock.patch.object(muse, "chat_json", call):
                r = self.c.post("/api/v1/live/live", json=data)
        self.assertEqual(r.status_code, 200)
        return r.get_json()

    def test_flag_off_by_default_no_call(self):
        called = []
        with mock.patch.object(muse, "chat_json", lambda *a, **k: called.append(1)):
            j = self.c.post("/api/v1/live/live", json=SCAN).get_json()
        self.assertFalse(called)
        self.assertTrue(j["detective"]["muse_status"].startswith("off"))
        self.assertTrue(j["detective"]["ledger"])

    def test_ledger_ids_stable_and_typed(self):
        a = ledger.build_ledger(SCAN, {"safety": {"level": "INSPECT_SOON"}})
        b = ledger.build_ledger(json.loads(json.dumps(SCAN)), {"safety": {"level": "INSPECT_SOON"}})
        self.assertEqual(a, b)
        ids = ledger.ledger_ids(a)
        for i in ("dtc:P0171:permanent", "dtc:P0420:pending", "pid:LONG_TERM_FUEL_TRIM_B1", "pid:WARMUPS_SINCE_CLEAR",
                  "mon:catalyst", "clr:flag", "clr:e1", "ff:dtc", "ff:ENGINE_RPM", "veh:odometer", "veh:vin_masked", "rule:safety"):
            self.assertIn(i, ids)
        self.assertEqual([x for x in a if x["id"] == "pid:WARMUPS_SINCE_CLEAR"][0]["type"], "codes_cleared_counter")

    def test_vin_masked_and_no_owner_info_sent(self):
        seen = []
        self.run_det(fake(good(), seen=seen))
        sent = json.dumps(seen)
        self.assertNotIn(VIN, sent)
        self.assertNotIn("04352", sent)
        self.assertIn("1HG**************", sent)
        self.assertNotIn("OBDLink", sent)
        self.assertNotIn("Chris", sent)

    def test_verified_output_and_receipt(self):
        j = self.run_det(fake(good()))
        d = j["detective"]
        self.assertEqual(d["muse_status"], "ok")
        self.assertEqual(len(d["hypotheses"]), 1)
        self.assertEqual(d["cleared_codes_warning"]["text"], "Codes were wiped recently.")
        r = d["receipt"]
        self.assertEqual(r["model"], "muse-spark-1.3")
        self.assertEqual(len(r["prompt_sha256_16"]), 16)
        self.assertIn("clr:e1", r["cited_ledger_ids"])
        self.assertIn("usage", r)

    def test_missing_citations_become_unverified(self):
        out = good()
        out["hypotheses"].append({"rank": 2, "cause": "Bad O2", "reasoning": "x", "confidence": "low",
                                  "cites": ["pid:O2_SENSOR_B1S1"], "next_check": "y"})
        out["hypotheses"].append({"rank": 3, "cause": "No cites", "reasoning": "x", "confidence": "low", "cites": [], "next_check": "y"})
        out["explanation"] = {"text": "Made up", "cites": ["dtc:P0300:active"]}
        d = self.run_det(fake(out))["detective"]
        self.assertEqual([h["cause"] for h in d["hypotheses"]], ["Vacuum leak"])
        kinds = sorted(u["kind"] for u in d["unverified_claims"])
        self.assertEqual(kinds, ["explanation", "hypothesis", "hypothesis"])
        self.assertIsNone(d["explanation"])
        self.assertIn("pid:O2_SENSOR_B1S1", json.dumps(d["unverified_claims"]))

    def test_muse_cannot_lower_safety(self):
        j = self.run_det(fake(good(level="SAFE_TO_DRIVE")))
        d = j["detective"]
        self.assertEqual(d["safety_action"], "detective_lower_ignored")
        self.assertEqual(j["safety"]["level"], d["rule_safety_level"])
        self.assertNotEqual(j["safety"]["level"], "SAFE_TO_DRIVE")

    def test_muse_can_raise_with_verified_cites_only(self):
        j = self.run_det(fake(good(level="EMERGENCY_STOP_IMMEDIATELY")))
        self.assertEqual(j["safety"]["level"], "EMERGENCY_STOP_IMMEDIATELY")
        self.assertEqual(j["detective"]["safety_action"], "raised_by_detective")
        self.assertIn("rule_level", j["safety"])
        bad = good(level="EMERGENCY_STOP_IMMEDIATELY")
        bad["safety_opinion"]["cites"] = ["made:up"]
        j2 = self.run_det(fake(bad))
        self.assertNotEqual(j2["safety"]["level"], "EMERGENCY_STOP_IMMEDIATELY")

    def test_merge_safety_table(self):
        self.assertEqual(detective.merge_safety("INSPECT_SOON", {"level": "INSPECT_SOON"}), ("INSPECT_SOON", "agreed"))
        self.assertEqual(detective.merge_safety("DO_NOT_DRIVE", {"level": "INSPECT_SOON"})[0], "DO_NOT_DRIVE")
        self.assertEqual(detective.merge_safety("DO_NOT_DRIVE", None), ("DO_NOT_DRIVE", "kept_rule_level"))

    def test_failures_fail_closed(self):
        base = self.c.post("/api/v1/live/live", json=SCAN).get_json()
        for exc in (muse.MuseError("TIMEOUT", "t"), muse.MuseError("BAD_JSON", "x"), muse.MuseError("RATE_LIMIT", "429"), RuntimeError("boom")):
            j = self.run_det(fake(exc=exc))
            self.assertIn("error", j["detective"]["muse_status"])
            self.assertIn("unchanged", j["detective"]["muse_status"])
            self.assertEqual(j["safety"], base["safety"])
            self.assertEqual(j["hypotheses"], base["hypotheses"])
            self.assertNotIn("boom", json.dumps(j))

    def test_malformed_shape_from_muse(self):
        j = self.run_det(fake(["not", "an", "object"]))
        self.assertIn("BAD_SHAPE", j["detective"]["muse_status"])
        j = self.run_det(fake({"hypotheses": "nope"}))  # garbage fields: nothing verified, no crash
        self.assertEqual(j["detective"]["muse_status"], "ok")

    def test_real_client_bad_json_and_timeout(self):
        class R:
            def __init__(self, b): self.b = b
            def read(self): return self.b
            def __enter__(self): return self
            def __exit__(self, *a): return False
        env = {"META_MODEL_API_KEY": "test-key-not-real"}
        body = json.dumps({"model": "muse-spark-1.3", "choices": [{"message": {"content": "{not json"}, "finish_reason": "length"}]}).encode()
        with mock.patch.dict(os.environ, env), mock.patch("urllib.request.urlopen", return_value=R(body)):
            with self.assertRaises(muse.MuseError) as cm:
                muse.chat_json([], {})
            self.assertEqual(cm.exception.code, "BAD_JSON")
        with mock.patch.dict(os.environ, env), mock.patch("urllib.request.urlopen", side_effect=TimeoutError("timed out")):
            with self.assertRaises(muse.MuseError) as cm:
                muse.chat_json([], {})
            self.assertEqual(cm.exception.code, "TIMEOUT")
        with mock.patch.dict(os.environ, {"META_MODEL_API_KEY": "", "META_MODEL_API_KEY_FILE": ""}):
            with self.assertRaises(muse.MuseError) as cm:
                muse.chat_json([], {})
            self.assertEqual(cm.exception.code, "NO_KEY")

    def test_freeze_frame_validation(self):
        r = self.c.post("/api/v1/live/live", json={**SCAN, "freeze_frame": {"dtc": "bad", "values": {"coolant": 1}}})
        self.assertEqual(r.status_code, 400)


if __name__ == "__main__":
    unittest.main()
