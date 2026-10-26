"""Hackathon server tests. Run: python -m unittest discover -s tests (from hackathon/server)."""
import json
import os
import shutil
import subprocess
import unittest
from unittest import mock

os.environ.setdefault("LYLO_HACK_DISABLE_EXTERNAL_HANDSHAKE", "1")
os.environ["LYLO_HACK_MUSE"] = "0"  # never call Muse in tests
os.environ["LYLO_HACK_ENV_FILE"] = "none"
os.environ["LYLO_HACK_REQUIRE_APP_KEY"] = "0"  # auth/limits covered by test_security.py
for _k in ("LYLO_HACK_RL_IP_PER_MIN", "LYLO_HACK_RL_IP_MUSE_PER_MIN", "LYLO_HACK_RL_KEY_MUSE_PER_MIN", "LYLO_HACK_RL_KEY_MUSE_PER_DAY", "LYLO_HACK_MUSE_DAILY_CAP"):
    os.environ[_k] = "1000000"
os.environ["LYLO_HACK_RATELIMIT_DB"] = "/tmp/lylo-hack-ratelimit-test.sqlite"
os.environ["HTTPS_PROXY"] = os.environ["HTTP_PROXY"] = "http://127.0.0.1:9"  # no real egress in tests

from lylo_hack.app import create_app  # noqa: E402
from lylo_hack import baseline_path  # noqa: E402

BRIDGE = os.path.join(baseline_path.REPO_ROOT, "hackathon", "mobile-bridge")
URL = "/api/v1/live/live"


def js_payload(demo, vehicle=None):
    """Run the real JS converter on a baseline demo scan."""
    script = ("const {scanToLivePayload}=require('./src/scanToLive');"
              "const {DEMO_SCANS}=require('../../baseline/mobile/src/data/demoScans');"
              f"process.stdout.write(JSON.stringify(scanToLivePayload(DEMO_SCANS[{json.dumps(demo)}],{{vehicle:{json.dumps(vehicle or {})}}})));")
    out = subprocess.run(["node", "-e", script], cwd=BRIDGE, capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


class LiveRouteTests(unittest.TestCase):
    def setUp(self):
        self.c = create_app().test_client()

    def post(self, body):
        return self.c.post(URL, json=body)

    # --- the safety-downgrade guard --------------------------------------
    def test_wrong_pid_name_is_rejected_not_silently_safe(self):
        hot = {"symptoms": {"primary_category": "overheating", "severity": "severe", "frequency": "constant"}}
        right = self.post({**hot, "raw_pids": [{"name": "ENGINE_COOLANT_TEMP", "pid_code": "05", "raw_value": 260, "unit": "°F"}]})
        self.assertEqual(right.status_code, 200)
        self.assertEqual(right.get_json()["safety"]["level"], "EMERGENCY_STOP_IMMEDIATELY")
        wrong = self.post({"raw_pids": [{"name": "coolant_temp", "pid_code": "05", "raw_value": 260, "unit": "°F"}]})
        self.assertEqual(wrong.status_code, 400, "a misnamed PID must never reach the pipeline")
        self.assertIn("safety check would not see it", " ".join(wrong.get_json()["errors"]))

    def test_coolant_alone_raises_safety_with_exact_name(self):
        r = self.post({"raw_pids": [{"name": "ENGINE_COOLANT_TEMP", "pid_code": "05", "raw_value": 260, "unit": "°F"}]})
        self.assertNotEqual(r.get_json()["safety"]["level"], "SAFE_TO_DRIVE")

    def test_wrong_unit_rejected(self):
        r = self.post({"raw_pids": [{"name": "ENGINE_COOLANT_TEMP", "pid_code": "05", "raw_value": 127, "unit": "°C"}]})
        self.assertEqual(r.status_code, 400)

    # --- end to end with the real JS converter ----------------------------
    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_js_converter_checkengine_end_to_end(self):
        r = self.post(js_payload("checkengine", {"model": "Accord", "odometer": 187000}))
        self.assertEqual(r.status_code, 200, r.get_json())
        j = r.get_json()
        self.assertEqual(j["safety"]["level"], "INSPECT_SOON")
        self.assertEqual(j["hackathon"]["vehicle_received"], {"vin": "1HGCM82633A004352", "model": "Accord", "odometer": 187000})
        self.assertTrue(j["hypotheses"])

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_js_converter_usedcar_codes_cleared_and_permanent(self):
        r = self.post(js_payload("usedcar"))
        self.assertEqual(r.status_code, 200, r.get_json())
        j = r.get_json()
        self.assertTrue(j["confidence"]["codes_possibly_cleared"])
        self.assertIn("P0171: permanent code treated as active.", j["hackathon"]["conversion_notes"])
        self.assertTrue(j["hackathon"]["codes_cleared_evidence"])
        # Baseline route gave zero hypotheses here; permanent P0171 now counts.
        self.assertTrue(any("vacuum" in h["cause_id"] or "maf" in h["cause_id"] for h in j["hypotheses"]))

    # --- permanent handling ----------------------------------------------
    def test_permanent_dedupes_with_stored(self):
        r = self.post({"raw_dtcs": [{"code": "P0302", "status": "permanent"}, {"code": "P0302", "status": "active"}]})
        self.assertEqual(r.status_code, 200)

    # --- handshake stub ----------------------------------------------------
    def test_no_external_handshake_call(self):
        with mock.patch("requests.post", side_effect=AssertionError("external call made")) as p:
            r = self.post(js_payload("checkengine")) if shutil.which("node") else self.post(
                {"raw_dtcs": [{"code": "P0171"}], "raw_pids": [{"name": "LONG_TERM_FUEL_TRIM_B1", "raw_value": 18, "unit": "%"}]})
            self.assertEqual(r.status_code, 200)
            p.assert_not_called()
        hs = r.get_json()["handshake_api"]
        if hs is not None:
            self.assertTrue(hs["requires_acknowledgment"])
        self.assertEqual(r.get_json()["hackathon"]["external_handshake"], "stubbed")

    # --- validation instead of 500s ---------------------------------------
    def test_malformed_inputs_are_4xx(self):
        cases = [
            ("empty body", lambda: self.c.post(URL, data=b"", content_type="application/json"), 400),
            ("text/plain", lambda: self.c.post(URL, data=b"hi", content_type="text/plain"), 415),
            ("bad json", lambda: self.c.post(URL, data=b"{bad", content_type="application/json"), 400),
            ("raw_value abc", lambda: self.post({"raw_pids": [{"name": "ENGINE_RPM", "raw_value": "abc", "unit": "rpm"}]}), 400),
            ("raw_dtcs string", lambda: self.post({"raw_dtcs": "P0300"}), 400),
            ("vehicle_profile null", lambda: self.post({"vehicle_profile": None}), 400),
            ("json list", lambda: self.post([1, 2]), 400),
            ("status weird", lambda: self.post({"raw_dtcs": [{"code": "P0300", "status": "weird"}]}), 400),
            ("bad code", lambda: self.post({"raw_dtcs": [{"code": "hello"}]}), 400),
            ("odometer string", lambda: self.post({"vehicle_profile": {"odometer": "lots"}}), 400),
            ("bool as number", lambda: self.post({"raw_pids": [{"name": "ENGINE_RPM", "raw_value": True, "unit": "rpm"}]}), 400),
            ("unknown route", lambda: self.c.get("/nope"), 404),
            ("wrong method", lambda: self.c.get(URL), 405),
        ]
        for name, fn, code in cases:
            with self.subTest(name):
                r = fn()
                self.assertEqual(r.status_code, code, (name, r.get_data(as_text=True)[:300]))
                self.assertIn("error", r.get_json())

    def test_minimal_valid_payload(self):
        r = self.post({"raw_dtcs": [{"code": "P0300"}]})
        self.assertEqual(r.status_code, 200)
        self.assertIn("level", r.get_json()["safety"])

    def test_pipeline_bug_is_500_without_leaking_exception(self):
        with mock.patch("lylo_hack.live.diagnose", side_effect=RuntimeError("secret detail")):
            r = self.post({"raw_dtcs": [{"code": "P0300"}]})
        self.assertEqual(r.status_code, 500)
        self.assertNotIn("secret detail", r.get_data(as_text=True))

    def test_deterministic(self):
        body = {"raw_dtcs": [{"code": "P0171"}], "raw_pids": [{"name": "LONG_TERM_FUEL_TRIM_B1", "raw_value": 18, "unit": "%"}]}
        outs = set()
        for _ in range(5):
            j = self.post(body).get_json(); j.pop("session_id", None)
            outs.add(json.dumps(j, sort_keys=True))
        self.assertEqual(len(outs), 1)

    def test_empty_scan_rejected(self):
        for body in ({}, {"raw_dtcs": [], "raw_pids": []},
                     {"raw_pids": [{"name": "ENGINE_RPM", "pid_code": "0C", "raw_value": None, "unit": "rpm"}]}):
            r = self.post(body)
            self.assertEqual(r.status_code, 400, body)
            self.assertIn("no trouble codes and no sensor readings", " ".join(r.get_json()["errors"]))
        self.assertEqual(self.post({"raw_pids": [{"name": "ENGINE_RPM", "pid_code": "0C", "raw_value": 800, "unit": "rpm"}]}).status_code, 200)
        with mock.patch.dict(os.environ, {"LYLO_HACK_REQUIRE_DATA": "0"}):
            self.assertEqual(self.post({}).status_code, 200)

    def test_repeated_calls_do_not_grow_shared_rule_lists(self):
        body = {"raw_dtcs": [{"code": "P0171", "status": "active"}],
                "raw_pids": [{"name": "LONG_TERM_FUEL_TRIM_B1", "pid_code": "07", "raw_value": 14.8, "unit": "%"}],
                "readiness_monitors": [{"name": "Catalyst", "status": "incomplete"}], "read_complete": False}
        runs = [self.post(body).get_json()["hypotheses"] for _ in range(3)]
        self.assertEqual(runs[0], runs[1])
        self.assertEqual(runs[1], runs[2])

    def test_healthz(self):
        self.assertTrue(self.c.get("/healthz").get_json()["ok"])


if __name__ == "__main__":
    unittest.main()


class OverheatRegressionTests(unittest.TestCase):
    """Permanent, Muse-free guard: 260 °F coolant must stay EMERGENCY_STOP_IMMEDIATELY."""
    HOT = {"symptoms": {"primary_category": "overheating", "severity": "severe", "frequency": "constant"},
           "raw_pids": [{"name": "ENGINE_COOLANT_TEMP", "pid_code": "05", "raw_value": 260, "unit": "°F"}]}

    def setUp(self):
        self.c = create_app().test_client()

    def test_overheat_emergency_with_muse_off(self):
        r = self.c.post(URL, json=self.HOT)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["safety"]["level"], "EMERGENCY_STOP_IMMEDIATELY")

    def test_overheat_emergency_when_muse_on_but_fails(self):
        from lylo_hack import muse
        boom = mock.Mock(side_effect=muse.MuseError("NETWORK", "mocked"))
        with mock.patch.dict(os.environ, {"LYLO_HACK_MUSE": "1", "META_MODEL_API_KEY": "test-not-real"}), \
             mock.patch.object(muse, "chat_json", boom):
            r = self.c.post(URL, json=self.HOT)
        self.assertEqual(r.status_code, 200)
        j = r.get_json()
        self.assertEqual(j["safety"]["level"], "EMERGENCY_STOP_IMMEDIATELY")
        self.assertEqual(j["detective"]["final_safety_level"], "EMERGENCY_STOP_IMMEDIATELY")
        self.assertTrue(boom.called)
