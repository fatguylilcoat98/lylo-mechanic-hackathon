"""Judge demo (LYLO_HACK_DEMO): bundled scans through the real pipeline; AI-vs-rules proof with a labeled simulated answer. No network."""
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
from lylo_hack import demo, muse  # noqa: E402


class DemoTests(unittest.TestCase):
    def setUp(self):
        self.c = create_app().test_client()

    def test_off_by_default(self):
        with mock.patch.dict(os.environ, {"LYLO_HACK_DEMO": "0"}):
            for r in (self.c.get("/api/v1/demo/cases"), self.c.post("/api/v1/demo/replay", json={"case": "truck"}),
                      self.c.post("/api/v1/demo/proof")):
                self.assertEqual(r.status_code, 503)
            self.assertEqual(self.c.get("/healthz").get_json()["demo"], "off")

    def test_cases_and_bad_case(self):
        with mock.patch.dict(os.environ, {"LYLO_HACK_DEMO": "1"}):
            ids = [c["id"] for c in self.c.get("/api/v1/demo/cases").get_json()["cases"]]
            self.assertEqual(ids, ["truck", "usedcar", "overheat"])
            self.assertEqual(self.c.post("/api/v1/demo/replay", json={"case": "../etc/passwd"}).status_code, 400)
            self.assertEqual(self.c.post("/api/v1/demo/replay", json={}).status_code, 400)

    def test_replays_use_real_rules(self):
        with mock.patch.dict(os.environ, {"LYLO_HACK_DEMO": "1"}):
            got = {}
            for case in demo.CASE_IDS:
                r = self.c.post("/api/v1/demo/replay", json={"case": case})
                self.assertEqual(r.status_code, 200, case)
                j = r.get_json()
                self.assertTrue(j["demo"]["replay"])
                got[case] = j
            self.assertEqual(got["overheat"]["safety"]["level"], "EMERGENCY_STOP_IMMEDIATELY")
            self.assertTrue(got["usedcar"]["detective"]["recently_cleared"])
            ids = {i["id"] for i in got["truck"]["detective"]["ledger"]}
            self.assertIn("pid:SHORT_TERM_FUEL_TRIM_B1", ids)
            self.assertIn("off", got["truck"]["detective"]["muse_status"])  # Muse off in tests

    def test_replay_with_muse_never_lowered(self):
        # Muse on but mocked to say SAFE on the overheat case: the rules still win.
        def fake_chat(messages, schema, timeout=None):
            return demo._simulated_safe(messages, schema)
        with mock.patch.dict(os.environ, {"LYLO_HACK_DEMO": "1", "LYLO_HACK_MUSE": "1"}), mock.patch.object(muse, "chat_json", fake_chat):
            j = self.c.post("/api/v1/demo/replay", json={"case": "overheat"}).get_json()
        self.assertEqual(j["safety"]["level"], "EMERGENCY_STOP_IMMEDIATELY")
        self.assertEqual(j["detective"]["safety_action"], "detective_lower_ignored")

    def test_proof_shows_both_verdicts_and_rules_win(self):
        with mock.patch.dict(os.environ, {"LYLO_HACK_DEMO": "1"}), \
                mock.patch.object(muse, "chat_json", side_effect=AssertionError("no model call")):
            j = self.c.post("/api/v1/demo/proof").get_json()
        p = j["proof"]
        self.assertTrue(p["simulated"])
        self.assertIn("Simulated AI answer", p["label"])
        self.assertEqual(p["ai_verdict"], "SAFE_TO_DRIVE")
        self.assertEqual(p["rules_verdict"], "EMERGENCY_STOP_IMMEDIATELY")
        self.assertEqual(p["final_verdict"], "EMERGENCY_STOP_IMMEDIATELY")
        self.assertEqual(p["winner"], "rules")
        self.assertEqual(p["safety_action"], "detective_lower_ignored")
        self.assertEqual(p["receipt"]["model"], "simulated (no model call)")
        self.assertEqual(j["safety"]["level"], "EMERGENCY_STOP_IMMEDIATELY")


if __name__ == "__main__":
    unittest.main()
