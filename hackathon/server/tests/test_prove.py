"""Point and prove (LYLO_HACK_PROVE / LYLO_HACK_SAM). Synthetic data only, no network."""
import copy
import threading
import os
import unittest
from unittest import mock

os.environ["LYLO_HACK_MUSE"] = "0"
os.environ["LYLO_HACK_SAM"] = "0"
os.environ["LYLO_HACK_ENV_FILE"] = "none"
os.environ["LYLO_HACK_REQUIRE_APP_KEY"] = "0"
for _k in ("LYLO_HACK_RL_IP_PER_MIN", "LYLO_HACK_RL_IP_MUSE_PER_MIN", "LYLO_HACK_RL_KEY_MUSE_PER_MIN", "LYLO_HACK_RL_KEY_MUSE_PER_DAY", "LYLO_HACK_MUSE_DAILY_CAP"):
    os.environ[_k] = "1000000"
os.environ["LYLO_HACK_RATELIMIT_DB"] = "/tmp/lylo-hack-ratelimit-test.sqlite"
os.environ["HTTPS_PROXY"] = os.environ["HTTP_PROXY"] = "http://127.0.0.1:9"

from lylo_hack.app import create_app  # noqa: E402
from lylo_hack import prove as P, detective, live, ledger as L  # noqa: E402

GOOD = {"hypothesis": "Cylinder 2 is misfiring from a bad coil", "pids": ["MISFIRE_COUNT_CYL2"], "condition": "above",
        "threshold": [10], "window_s": 60, "if_fails": "Cylinder 2 is firing normally at idle now."}
SCAN = {"raw_dtcs": [{"code": "P0302", "status": "pending"}],
        "raw_pids": [{"name": "ENGINE_RPM", "pid_code": "0C", "raw_value": 700, "unit": "rpm"}],
        "mode06": {"supported": True, "misfire_counts": {"1": 0, "2": 2, "3": 0, "4": 0}}}


class Validate(unittest.TestCase):
    def test_good(self):
        p = P.validate(GOOD)
        self.assertEqual(p["threshold"], [10.0])

    def test_vague_and_malformed_rejected(self):
        bad = [dict(GOOD, hypothesis="Something might be wrong with the engine"),
               dict(GOOD, hypothesis="short"), dict(GOOD, pids=[]), dict(GOOD, pids=["VIBES"]),
               dict(GOOD, condition="feels_off"), dict(GOOD, threshold=["high"]), dict(GOOD, threshold=[]),
               dict(GOOD, threshold=[True]), dict(GOOD, window_s=0), dict(GOOD, window_s=9999),
               dict(GOOD, if_fails=""), dict(GOOD, condition="between", threshold=[5, 1]),
               dict(GOOD, condition="dtc_present", pids=["cyl 2"]), "not a dict", None]
        for b in bad:
            with self.assertRaises(P.Rejected, msg=str(b)):
                P.validate(b)

    def test_model_cannot_self_certify(self):
        p = P.validate(dict(GOOD, status="HELD", proven=True, measured="99 misfires", verified=True))
        for k in ("status", "proven", "measured", "verified"):
            self.assertNotIn(k, p)


class Ledger(unittest.TestCase):
    def test_append_only_chain(self):
        led = P.ProveLedger()
        a = led.append("prediction", {"x": 1}, now=100)
        b = led.append("outcome", {"y": 2}, now=101)
        self.assertEqual(b["prev"], a["sha256"])
        self.assertTrue(led.verify())
        self.assertFalse(hasattr(led, "update") or hasattr(led, "delete"))
        copy_ = led.entries()
        copy_[0]["body"]["x"] = 999  # editing a returned copy does nothing
        self.assertTrue(led.verify())
        led._e[0]["body"]["x"] = 999  # tampering inside is detected
        self.assertFalse(led.verify())


class Checker(unittest.TestCase):
    def setUp(self):
        self.p = P.validate(GOOD)

    def test_held_failed_locked(self):
        self.assertEqual(P.check(self.p, 100, [{"t": 120, "pid": "MISFIRE_COUNT_CYL2", "value": 25}])["status"], "HELD")
        self.assertEqual(P.check(self.p, 100, [{"t": 120, "pid": "MISFIRE_COUNT_CYL2", "value": 3}])["status"], "FAILED")
        self.assertEqual(P.check(self.p, 100, [{"t": 120, "pid": "RPM", "value": 3}])["status"], "LOCKED")
        self.assertEqual(P.check(self.p, 100, [])["status"], "LOCKED")

    def test_readings_before_lock_or_after_window_ignored(self):
        s = [{"t": 99, "pid": "MISFIRE_COUNT_CYL2", "value": 50}, {"t": 161, "pid": "MISFIRE_COUNT_CYL2", "value": 50}]
        self.assertEqual(P.check(self.p, 100, s)["status"], "LOCKED")

    def test_bad_values_ignored(self):
        s = [{"t": 110, "pid": "MISFIRE_COUNT_CYL2", "value": True}, {"t": 110, "pid": "MISFIRE_COUNT_CYL2", "value": "50"}]
        self.assertEqual(P.check(self.p, 100, s)["status"], "LOCKED")

    def test_dtc_present(self):
        p = P.validate({"hypothesis": "Cylinder 3 is misfiring at idle", "pids": ["P0303"], "condition": "dtc_present",
                        "threshold": [], "window_s": 90, "if_fails": "No cylinder 3 code came back."})
        self.assertEqual(P.check(p, 0, [{"t": 30, "dtc": "P0303"}])["status"], "HELD")
        self.assertEqual(P.check(p, 0, [{"t": 30, "dtc": "P0301"}])["status"], "FAILED")
        self.assertEqual(P.check(p, 0, [])["status"], "LOCKED")

    def test_ranges(self):
        p = P.validate(dict(GOOD, pids=["RPM"], condition="outside", threshold=[600, 900]))
        self.assertEqual(P.check(p, 0, [{"t": 5, "pid": "RPM", "value": 450}])["status"], "HELD")
        self.assertEqual(P.check(p, 0, [{"t": 5, "pid": "RPM", "value": 700}])["status"], "FAILED")


class Flow(unittest.TestCase):
    def _result(self, scan=SCAN):
        return live.diagnose(copy.deepcopy(scan), muse=False)

    def test_lock_then_evaluate_and_outcome_is_final(self):
        st = P.Store()
        r = self._result()
        sid = P.lock(r, SCAN, proposal=GOOD, now=1000, store=st)
        self.assertEqual(r["detective"]["prediction"]["status"], "LOCKED")
        self.assertEqual(set(r["detective"]["prediction"]), {"text", "status", "measured"})
        v = P.evaluate(sid, [{"t": 1010, "pid": "MISFIRE_COUNT_CYL2", "value": 30}], store=st)
        self.assertEqual(v["prediction"]["status"], "HELD")
        v2 = P.evaluate(sid, [{"t": 1020, "pid": "MISFIRE_COUNT_CYL2", "value": 0}], store=st)  # cannot be re-decided
        self.assertEqual(v2["prediction"]["status"], "HELD")
        self.assertTrue(v2["prove"]["chain_ok"])
        self.assertEqual([e["kind"] for e in v2["prove"]["ledger"]], ["prediction", "outcome"])

    def test_failed_downgrades_never_drops(self):
        st = P.Store()
        r = self._result()
        r["detective"]["hypotheses"] = [{"cause": "Cylinder 2 is misfiring from a bad coil", "confidence": "high"},
                                        {"cause": "Vacuum leak", "confidence": "low"}]
        sid = P.lock(r, SCAN, proposal=GOOD, now=0, store=st)
        v = P.evaluate(sid, [{"t": 10, "pid": "MISFIRE_COUNT_CYL2", "value": 1}], store=st)
        self.assertEqual(v["prediction"]["status"], "FAILED")
        self.assertEqual(len(v["hypotheses"]), 2)
        self.assertEqual(v["hypotheses"][0]["confidence"], "medium")
        self.assertTrue(v["hypotheses"][0]["prediction_failed"])

    def test_failed_unmatched_hypothesis_is_kept(self):
        st = P.Store()
        r = self._result()
        sid = P.lock(r, SCAN, proposal=GOOD, now=0, store=st)
        v = P.evaluate(sid, [{"t": 10, "pid": "MISFIRE_COUNT_CYL2", "value": 1}], store=st)
        self.assertTrue(any(h.get("prediction_failed") and h["cause"] == GOOD["hypothesis"] for h in v["hypotheses"]))

    def test_vague_model_proposal_falls_back_to_rules(self):
        r = self._result()
        P.lock(r, SCAN, proposal=dict(GOOD, hypothesis="Something might be off"), store=P.Store())
        pr = r["detective"]["prove"]
        self.assertIn("vague", pr["proposal_rejected"])
        self.assertEqual(pr["proposed_by"], "rules")

    def test_adversarial_model_claims_held_stays_locked(self):
        r = self._result()
        st = P.Store()
        sid = P.lock(r, SCAN, proposal=dict(GOOD, status="HELD", proven=True, measured="cyl 2: 400"), store=st)
        self.assertEqual(r["detective"]["prediction"]["status"], "LOCKED")
        self.assertIsNone(r["detective"]["prediction"]["measured"])
        self.assertEqual(P.evaluate(sid, [], store=st)["prediction"]["status"], "LOCKED")

    def test_safety_override_stays_on_top(self):
        hot = {"raw_dtcs": [], "raw_pids": [{"name": "ENGINE_COOLANT_TEMP", "pid_code": "05", "raw_value": 260, "unit": "\u00b0F"},
                                             {"name": "ENGINE_RPM", "pid_code": "0C", "raw_value": 800, "unit": "rpm"}]}
        r = self._result(hot)
        before = r["safety"]["level"]
        st = P.Store()
        sid = P.lock(r, hot, proposal=dict(GOOD, pids=["ENGINE_COOLANT_TEMP"], hypothesis="Coolant reading is a gauge glitch",
                                           condition="below", threshold=[200]), store=st)
        P.evaluate(sid, [{"t": r["detective"]["prove"]["locked_at"] + 5, "pid": "ENGINE_COOLANT_TEMP", "value": 150}], store=st)
        self.assertEqual(r["safety"]["level"], before)
        self.assertGreaterEqual(L.SAFETY_ORDER.index(before), L.SAFETY_ORDER.index("DO_NOT_DRIVE"))

    def test_misfire_raises_floor_only(self):
        r = self._result()
        P.lock(r, SCAN, store=P.Store())
        self.assertGreaterEqual(L.SAFETY_ORDER.index(r["safety"]["level"]), L.SAFETY_ORDER.index(P.MISFIRE_FLOOR))

    def test_mode06_not_reported(self):
        mf = P.misfire({"raw_dtcs": [{"code": "P0304"}]})
        self.assertEqual(mf["per_cylinder_counts"], P.NOT_REPORTED)
        ids = [i["id"] for i in P.misfire_items(mf)]
        self.assertIn("m06:misfire:not_reported", ids)
        rp = P.rule_prediction({}, mf)
        self.assertEqual(rp["condition"], "dtc_present")
        self.assertEqual(rp["pids"], ["P0304"])
        self.assertEqual(P.misfire({"mode06": {"supported": False, "misfire_counts": {"1": 50}}})["per_cylinder_counts"], P.NOT_REPORTED)


class Replay(unittest.TestCase):
    def test_synthetic_replays(self):
        for case, want in (("prove_misfire_synthetic", "HELD"), ("prove_lean_fail_synthetic", "FAILED")):
            r = P.replay_session(P.load_replay(case), case, store=P.Store())
            self.assertEqual(r["replay"]["badge"], "REPLAY")
            self.assertTrue(r["replay"]["label"].startswith("SYNTHETIC "))
            self.assertTrue(r["replay"]["synthetic"])
            self.assertEqual(r["detective"]["prediction"]["status"], want)

    def test_replay_badge_cannot_be_hidden(self):
        sess = dict(P.load_replay("prove_misfire_synthetic"), synthetic=False, title="", badge=None, replay=False)
        r = P.replay_session(sess, "x", store=P.Store())
        self.assertEqual(r["replay"]["badge"], "REPLAY")
        self.assertTrue(r["replay"]["label"].startswith("RECORDED "))


class Routes(unittest.TestCase):
    def setUp(self):
        self.c = create_app().test_client()

    def test_off_by_default_and_live_unchanged(self):
        with mock.patch.dict(os.environ, {"LYLO_HACK_PROVE": "0"}):
            self.assertEqual(self.c.post("/api/v1/prove/replay", json={"case": "prove_misfire_synthetic"}).status_code, 503)
            self.assertEqual(self.c.post("/api/v1/prove/check", json={}).status_code, 503)
            r = self.c.post("/api/v1/live/live", json=SCAN).get_json()
            self.assertNotIn("prediction", r["detective"])
            self.assertNotIn("prove", r["detective"])
            self.assertNotIn("prove", self.c.get("/healthz").get_json())
            self.assertEqual(detective.SCHEMA["required"], ["hypotheses", "explanation", "cleared_codes_warning", "safety_opinion"])

    def test_live_lock_then_check(self):
        with mock.patch.dict(os.environ, {"LYLO_HACK_PROVE": "1"}):
            r = self.c.post("/api/v1/live/live", json=SCAN).get_json()
            self.assertEqual(r["detective"]["prediction"]["status"], "LOCKED")
            sid = r["detective"]["prove"]["session_id"]
            v = self.c.post("/api/v1/prove/check", json={"session_id": sid, "samples": [
                {"dt": 1, "pid": "MISFIRE_COUNT_CYL2", "value": 40}, {"dt": 3600, "dtc": "P0302"}]}).get_json()
            self.assertEqual(v["prediction"]["status"], "HELD")
            self.assertEqual(self.c.post("/api/v1/prove/check", json={"session_id": "nope", "samples": []}).status_code, 404)

    def test_future_readings_dropped(self):
        with mock.patch.dict(os.environ, {"LYLO_HACK_PROVE": "1"}):
            r = self.c.post("/api/v1/live/live", json=SCAN).get_json()
            sid = r["detective"]["prove"]["session_id"]
            v = self.c.post("/api/v1/prove/check", json={"session_id": sid, "samples": [
                {"dt": 50, "pid": "MISFIRE_COUNT_CYL2", "value": 40}]}).get_json()
            self.assertEqual(v["prediction"]["status"], "LOCKED")

    def test_replay_route(self):
        with mock.patch.dict(os.environ, {"LYLO_HACK_PROVE": "1"}):
            r = self.c.post("/api/v1/prove/replay", json={"case": "prove_misfire_synthetic"}).get_json()
            self.assertEqual(r["replay"]["badge"], "REPLAY")
            self.assertEqual(self.c.post("/api/v1/prove/replay", json={"case": "truck"}).status_code, 400)

    def test_muse_proposal_through_detective(self):
        def fake(messages, schema, timeout=None):
            self.assertIn("prediction", schema["required"])
            return ({"hypotheses": [], "explanation": {"text": "", "cites": []}, "cleared_codes_warning": {"text": "", "cites": []},
                     "safety_opinion": {"level": "SAFE_TO_DRIVE", "reason": "fine", "cites": ["rule:safety"]},
                     "prediction": dict(GOOD, status="HELD")}, {"model": "stub", "latency_ms": 1})
        with mock.patch.dict(os.environ, {"LYLO_HACK_PROVE": "1", "LYLO_HACK_MUSE": "1"}):
            with mock.patch.object(detective.muse, "chat_json", fake):
                r = live.diagnose(copy.deepcopy(SCAN))
        det = r["detective"]
        self.assertNotIn("prediction_proposal", det)
        self.assertEqual(det["prove"]["proposed_by"], "model")
        self.assertEqual(det["prediction"]["status"], "LOCKED")
        self.assertNotEqual(r["safety"]["level"], "SAFE_TO_DRIVE")  # model's lower opinion never wins over the misfire floor


class VeraFixes(unittest.TestCase):
    def test_concurrent_checks_record_one_outcome(self):
        for _ in range(20):
            st = P.Store()
            r = live.diagnose(copy.deepcopy(SCAN), muse=False)
            sid = P.lock(r, SCAN, proposal=GOOD, now=0, store=st)
            held = [{"t": 5, "pid": "MISFIRE_COUNT_CYL2", "value": 40}]
            failed = [{"t": 5, "pid": "MISFIRE_COUNT_CYL2", "value": 1}]
            go = threading.Barrier(8)
            out = []

            def run(s):
                go.wait()
                out.append(P.evaluate(sid, s, store=st)["prediction"]["status"])
            ts = [threading.Thread(target=run, args=(held if i % 2 else failed,)) for i in range(8)]
            [t.start() for t in ts]
            [t.join() for t in ts]
            self.assertEqual(len(set(out)), 1, out)
            kinds = [e["kind"] for e in st.get(sid)["ledger"].entries()]
            self.assertEqual(kinds, ["prediction", "outcome"])

    def test_tail_truncation_detected(self):
        st = P.Store()
        r = live.diagnose(copy.deepcopy(SCAN), muse=False)
        sid = P.lock(r, SCAN, proposal=GOOD, now=0, store=st)
        P.evaluate(sid, [{"t": 5, "pid": "MISFIRE_COUNT_CYL2", "value": 40}], store=st)
        sess = st.get(sid)
        self.assertTrue(P.chain_ok(sess))
        sess["ledger"]._e.pop()  # remaining chain is still internally valid
        self.assertTrue(sess["ledger"].verify())
        self.assertFalse(P.chain_ok(sess))

    def test_non_finite_threshold_rejected(self):
        for bad in (float("nan"), float("inf"), float("-inf")):
            with self.assertRaises(P.Rejected):
                P.validate(dict(GOOD, threshold=[bad]))

    def test_proof_claims_rejected(self):
        for h in ("Cylinder 2 misfire confirmed by the scan", "Cylinder 2 is proven to misfire",
                  "Cylinder 2 misfire verified by sensor data", "Cylinder 2 is definitely misfiring"):
            with self.assertRaises(P.Rejected, msg=h):
                P.validate(dict(GOOD, hypothesis=h))

    def test_malformed_scan_lists_do_not_crash(self):
        mf = P.misfire({"raw_dtcs": ["P0302", None, {"code": "P0302"}], "mode06": "yes"})
        self.assertEqual([c["code"] for c in mf["codes"]], ["P0302"])
        self.assertIsNone(P.rule_prediction({"raw_pids": [None, "x"]}, P.misfire({})))

    def test_check_route_malformed_samples_400_not_500(self):
        c = create_app().test_client()
        with mock.patch.dict(os.environ, {"LYLO_HACK_PROVE": "1"}):
            sid = c.post("/api/v1/live/live", json=SCAN).get_json()["detective"]["prove"]["session_id"]
            for body in ({"session_id": sid, "samples": [{"dt": 0.1, "pid": ["x"], "value": 1}]},
                         {"session_id": sid, "samples": "nope"}, {"session_id": sid, "samples": [None, 3, {"dt": "1"}]}):
                self.assertIn(c.post("/api/v1/prove/check", json=body).status_code, (200, 400))


if __name__ == "__main__":
    unittest.main()
