"""Fixtures, state, trust, events, experiments, replay, and the evidence view."""

from __future__ import annotations

import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from vicore.baseline import BaselineTracker, assert_same_epoch, record_repair
from vicore.benchmark import apply_benchmark, benchmark_from_observations, run_benchmark
from vicore.clock import FakeClock
from vicore.db import Database, load_observations
from vicore.elm import ElmSession
from vicore.events import POST_S, PRE_S, EventBuffer
from vicore.experiments import ExperimentEngine
from vicore.features import query_feature
from vicore.fixtures import BUILDERS, build_fixture, load_fixture, write_fixtures
from vicore.formula import encode
from vicore.models import IncompatibleEpochError, Observation
from vicore.phone import probe_phone_sensors
from vicore.pipeline import ensure_adapter, ensure_session, ensure_vehicle, replay_session, save_profile
from vicore.recorder import Recorder
from vicore.registry import load_registry
from vicore.state import StateConfig, StateDetector
from vicore.status import build_status, render_html
from vicore.timeutil import iso_from_epoch
from vicore.transport import ScriptedTransport
from vicore.trust import TrustLedger


def _db():
    handle = tempfile.NamedTemporaryFile(suffix=".sqlite")
    return handle, Database(handle.name)


def _events(summary):
    return summary["db"].execute(
        "SELECT * FROM events WHERE session_id = ? ORDER BY triggered_at",
        (summary["session_id"],),
    ).fetchall()


def _load_named(test, name):
    handle, db = _db()
    test.addCleanup(db.close)
    test.addCleanup(handle.close)
    summary = load_fixture(db, name)
    summary["db"] = db
    return summary


def _obs(signal, value, t, state_session="s", quality="OK", raw="00", ecu="7E8"):
    return Observation(
        vehicle_id="V",
        session_id=state_session,
        signal_id=signal,
        request_timestamp=iso_from_epoch(1_767_225_600 + t),
        response_timestamp=iso_from_epoch(1_767_225_600 + t + 0.01),
        request_mono=t,
        response_mono=t + 0.01,
        raw_value=raw,
        decoded_value=value,
        unit=None,
        quality=quality,
        protocol="ISO_15765_4_CAN_11_500",
        ecu=ecu,
        sequence_number=1,
    )


class StateTests(unittest.TestCase):
    def test_normal_start_states(self):
        summary = self._load("normal_start")
        states = self._states(summary)
        self.assertIn("KEY_ON", states)
        self.assertIn("CRANKING", states)
        self.assertIn("ENGINE_START", states)
        self.assertIn("COLD_IDLE", states)
        self.assertNotIn("WARM_IDLE", states)
        self.assertNotIn("DFCO", states)

    def test_hot_idle_and_dfco(self):
        hot = self._load("hot_idle")
        self.assertIn("WARM_IDLE", self._states(hot))
        dfco = self._load("dfco")
        self.assertIn("STEADY_CRUISE", self._states(dfco))
        self.assertIn("DFCO", self._states(dfco))

    def test_dfco_requires_fuel_status(self):
        detector = StateDetector()
        t = 0.0
        samples = []
        while t <= 12:
            samples.append(("rpm", 2100, t))
            samples.append(("vehicle_speed", 80, t))
            samples.append(("ect", 90, t))
            samples.append(("throttle_rel", 20, t))
            t += 0.2
        while t <= 22:
            speed = max(20, 80 - 5 * (t - 12))
            samples.append(("rpm", 1700, t))
            samples.append(("vehicle_speed", speed, t))
            samples.append(("ect", 90, t))
            samples.append(("throttle_rel", 0, t))
            t += 0.2
        seen = set()
        for signal, value, moment in samples:
            detector.update(_obs(signal, value, moment))
            if detector.committed:
                seen.add(detector.committed)
        self.assertNotIn("DFCO", seen)
        self.assertIn("DECELERATION", seen)

    def test_warm_restart(self):
        detector = StateDetector()
        detector.update(_obs("rpm", 0, 0))
        detector.update(_obs("ect", 90, 0))
        detector.update(_obs("control_module_voltage", 12.4, 0))
        # The first sample commits before ECT arrives, so step forward.
        detector.update(_obs("rpm", 0, 1.0))
        self.assertEqual(detector.committed, "WARM_RESTART")

    def _load(self, name):
        handle, db = _db()
        self.addCleanup(db.close)
        self.addCleanup(handle.close)
        summary = load_fixture(db, name)
        summary["db"] = db
        return summary

    def _states(self, summary):
        rows = summary["db"].execute(
            "SELECT state FROM vehicle_states WHERE session_id = ?",
            (summary["session_id"],),
        ).fetchall()
        return [row["state"] for row in rows]


class TrustAndEpochTests(unittest.TestCase):
    def test_anchor_failure_suppresses_virtual(self):
        handle, db = _db()
        self.addCleanup(db.close)
        self.addCleanup(handle.close)
        summary = load_fixture(db, "sensor_anchor_failure")
        status = build_status(db, summary["session_id"])
        self.assertEqual(status["sensor_trust"]["map"]["state"], "UNTRUSTED")
        self.assertEqual(status["sensor_trust"]["map"]["anchor_result"], "FAIL")
        self.assertNotEqual(status["sensor_trust"]["phone_baro"]["state"], "UNTRUSTED")
        self.assertEqual(status["virtual_sensors"]["map_baro_residual"]["status"], "SUPPRESSED")
        self.assertEqual(status["virtual_sensors"]["map_baro_residual"]["reason"], "INPUT_UNTRUSTED")
        result = status["experiment_results"]["experiment_a_koeo_map"]
        self.assertEqual(result["status"], "COMPLETE")
        self.assertEqual(result["result"]["independence"], "PROVEN_PHONE_BAROMETER")
        self.assertEqual(result["result"]["anchor_agreement"], "FAIL")
        self.assertFalse(result["result"]["usable_as_baseline"])
        self.assertIsNone(result["result"]["diagnosis"])

    def test_ecu_baro_does_not_validate_map(self):
        handle, db = _db()
        self.addCleanup(db.close)
        self.addCleanup(handle.close)
        summary = load_fixture(db, "normal_start")
        status = build_status(db, summary["session_id"])
        self.assertNotEqual(status["sensor_trust"]["map"]["state"], "VALIDATED")
        result = status["experiment_results"]["experiment_a_koeo_map"]
        self.assertEqual(result["status"], "COMPLETE")
        self.assertEqual(result["result"]["independence"], "UNPROVEN")
        self.assertFalse(result["result"]["ecu_baro"]["independent"])

    def test_voltage_agreement_validates(self):
        handle, db = _db()
        self.addCleanup(db.close)
        self.addCleanup(handle.close)
        summary = load_fixture(db, "weak_voltage_start")
        status = build_status(db, summary["session_id"])
        self.assertEqual(status["sensor_trust"]["control_module_voltage"]["state"], "VALIDATED")
        self.assertEqual(status["sensor_trust"]["adapter_voltage"]["state"], "VALIDATED")
        self.assertEqual(status["recorded_events"], [])

    def test_epoch_rewind_and_compare(self):
        handle, db = _db()
        self.addCleanup(db.close)
        self.addCleanup(handle.close)
        ensure_vehicle(db, "V1", None, "UNTESTED", "fp", "2026-01-01T00:00:00.000000Z")
        tracker = BaselineTracker(db, "V1")
        first = tracker.ensure("2026-01-01T00:00:00.000000Z", "CAL-A")
        tracker.observe(_obs("runtime_since_start", 100, 1))
        second = tracker.observe(_obs("runtime_since_start", 2, 2))
        self.assertIsNotNone(second)
        self.assertEqual(second["reason_started"], "ecu_reset")
        with self.assertRaises(IncompatibleEpochError):
            assert_same_epoch(first["epoch_id"], second["epoch_id"])
        repair = record_repair(
            db,
            vehicle_id="V1",
            epoch_id=second["epoch_id"],
            recorded_at="2026-01-01T00:10:00.000000Z",
            category="sensor_replacement",
            description="fixture repair record",
        )
        self.assertTrue(repair["invalidates_epoch"])
        self.assertNotEqual(repair["epoch"]["epoch_id"], second["epoch_id"])

    def test_trust_cannot_be_overridden(self):
        ledger = TrustLedger(load_registry())
        with self.assertRaises(PermissionError):
            ledger.override("rpm", "VALIDATED")

    def test_recent_reset_holds_evidence(self):
        registry = load_registry()
        ledger = TrustLedger(registry)
        ledger.on_epoch({"epoch_id": "E", "reason_started": "ecu_reset"}, 0.0)
        ledger.seed(["rpm"])
        for index in range(25):
            moment = index * 0.2
            ledger.update(_obs("rpm", 800, moment), "WARM_IDLE")
        self.assertEqual(ledger.state_of("rpm"), "INSUFFICIENT_EVIDENCE")
        self.assertTrue(ledger.records["rpm"].recent_reset)


class EventTests(unittest.TestCase):
    def test_constants(self):
        self.assertGreaterEqual(PRE_S, 90)
        self.assertLessEqual(PRE_S, 120)
        self.assertGreaterEqual(POST_S, 30)
        self.assertLessEqual(POST_S, 60)

    def test_freeze_does_not_overwrite(self):
        buffer = EventBuffer(pre_s=10, post_s=3)
        for index in range(20):
            buffer.push(_obs("rpm", 2000, index * 0.5), "STEADY_CRUISE", {})
        buffer.push(_obs("rpm", 1000, 10.5), "STEADY_CRUISE", {})
        self.assertIsNotNone(buffer.active)
        frozen_later = None
        for index in range(10):
            buffer.push(_obs("rpm", 2000, 11 + index * 0.5), "STEADY_CRUISE", {})
            if buffer.frozen:
                frozen_later = buffer.frozen[0]["samples"]
                break
        self.assertIsNotNone(frozen_later)
        snapshot = tuple(sample.response_mono for sample in frozen_later)
        buffer.push(_obs("rpm", 2000, 30), "STEADY_CRUISE", {})
        self.assertEqual(tuple(sample.response_mono for sample in buffer.frozen[0]["samples"]), snapshot)
        self.assertFalse(buffer.frozen[0]["overwritten"])

    def test_user_button(self):
        buffer = EventBuffer(pre_s=10, post_s=2)
        for index in range(5):
            buffer.push(_obs("rpm", 700, index), "WARM_IDLE", {})
        buffer.user_trigger(4.5, "2026-01-01T00:00:04.500000Z")
        buffer.finish("2026-01-01T00:00:05.000000Z", 5.0)
        self.assertEqual(buffer.frozen[0]["triggers"][0]["source"], "USER_BUTTON")
        self.assertTrue(buffer.frozen[0]["frozen"])
        self.assertFalse(buffer.frozen[0]["post_window_complete"])

    def test_order_indeterminate(self):
        buffer = EventBuffer(pre_s=5, post_s=2)
        # Previous samples stay inside the 1 second discontinuity window.
        buffer.push(_obs("rpm", 2000, 0.90), "STEADY_CRUISE", {})
        buffer.push(_obs("control_module_voltage", 14.0, 0.90), "STEADY_CRUISE", {})
        # Overlapping windows: voltage request starts before the rpm response ends.
        rpm = _obs("rpm", 1000, 1.00)
        rpm.request_mono = 1.00
        rpm.response_mono = 1.20
        volt = _obs("control_module_voltage", 11.0, 1.05)
        volt.request_mono = 1.05
        volt.response_mono = 1.25
        buffer.push(rpm, "STEADY_CRUISE", {})
        buffer.push(volt, "STEADY_CRUISE", {})
        buffer.finish("2026-01-01T00:00:04.000000Z", 4)
        self.assertEqual(len(buffer.frozen), 1)
        self.assertEqual(buffer.frozen[0]["order_status"], "ORDER_INDETERMINATE")
        self.assertFalse(buffer.frozen[0]["overwritten"])

    def test_stumble_fixtures_keep_order(self):
        stumble = _load_named(self, "rpm_stumble")
        self.assertEqual(stumble["state"], "STEADY_CRUISE")
        rows = _events(stumble)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["trigger_source"], "RPM_DISCONTINUITY")
        self.assertEqual(rows[0]["order_status"], "SINGLE")
        self.assertEqual(rows[0]["overwritten"], 0)
        self.assertEqual(rows[0]["post_window_complete"], 1)
        self.assertGreater(rows[0]["sequence_start"], 1)

        voltage_first = _load_named(self, "voltage_first_stumble")
        rpm_first = _load_named(self, "rpm_first_voltage_drop")
        voltage_rows = _events(voltage_first)
        rpm_rows = _events(rpm_first)
        self.assertEqual(len(voltage_rows), 1)
        self.assertEqual(len(rpm_rows), 1)
        self.assertEqual(voltage_rows[0]["order_status"], "DETERMINATE")
        self.assertEqual(rpm_rows[0]["order_status"], "DETERMINATE")
        self.assertEqual(voltage_rows[0]["trigger_source"], "VOLTAGE_DISCONTINUITY")
        self.assertEqual(rpm_rows[0]["trigger_source"], "RPM_DISCONTINUITY")
        voltage_sources = [item["source"] for item in json.loads(voltage_rows[0]["trigger_detail"])]
        rpm_sources = [item["source"] for item in json.loads(rpm_rows[0]["trigger_detail"])]
        self.assertEqual(voltage_sources, ["VOLTAGE_DISCONTINUITY", "RPM_DISCONTINUITY"])
        self.assertEqual(rpm_sources, ["RPM_DISCONTINUITY", "VOLTAGE_DISCONTINUITY"])


class ExperimentTests(unittest.TestCase):
    def test_hot_idle_throttle_repeatability(self):
        handle, db = _db()
        self.addCleanup(db.close)
        self.addCleanup(handle.close)
        summary = load_fixture(db, "hot_idle")
        status = build_status(db, summary["session_id"])
        result = status["experiment_results"]["experiment_c_hot_idle_throttle"]
        self.assertEqual(result["status"], "COMPLETE")
        self.assertGreaterEqual(result["result"]["n_matched"], 20)
        self.assertLess(result["result"]["throttle_abs"]["sample_variance"], 5)
        self.assertEqual(result["result"]["accessory_state"]["status"], "UNSUPPORTED")
        self.assertIsNone(result["result"]["diagnosis"])
        text = json.dumps(result).lower()
        self.assertNotIn("vacuum leak", text)
        self.assertNotIn("carbon", text)
        fuel = status["experiment_results"]["experiment_b_fuel_trim"]
        self.assertEqual(fuel["status"], "INSUFFICIENT_EVIDENCE")
        self.assertGreaterEqual(fuel["result"]["cells"]["hot_idle"]["n_stft"], 30)

    def test_low_rate_does_not_run(self):
        handle, db = _db()
        self.addCleanup(db.close)
        self.addCleanup(handle.close)
        summary = load_fixture(db, "low_acquisition_rate")
        status = build_status(db, summary["session_id"])
        self.assertIsNone(status["current_state"]["state"])
        self.assertEqual(status["current_state"]["reason"], "INSUFFICIENT_ACQUISITION_RATE")
        for experiment_id in (
            "experiment_a_koeo_map",
            "experiment_b_fuel_trim",
            "experiment_c_hot_idle_throttle",
        ):
            self.assertEqual(
                status["experiment_results"][experiment_id]["status"],
                "INSUFFICIENT_ACQUISITION_RATE",
            )
        warning = " ".join(status["capability_warnings"])
        self.assertIn("Throttle hysteresis", warning)
        self.assertIn("INSUFFICIENT_ACQUISITION_RATE", warning)

    def test_fuel_trim_complete_when_coverage_met(self):
        registry = load_registry()
        from vicore.features import evaluate_features

        support = {sid: {"state": "FULL"} for sid in ("stft_b1", "ltft_b1", "rpm", "ect", "engine_load", "vehicle_speed")}
        benchmark = {"tiers": [{"n_signals": 4, "status": "COMPLETE", "sustained_hz": 5.0}]}
        features = evaluate_features(support, benchmark)
        gates = {key: query_feature({"features": features}, key) for key in features}
        engine = ExperimentEngine(registry, gates)
        t = 0.0

        def feed(state, stft, ltft, load, rpm, speed, ect, n):
            nonlocal t
            for _ in range(n):
                for signal, value in (
                    ("rpm", rpm),
                    ("vehicle_speed", speed),
                    ("ect", ect),
                    ("engine_load", load),
                    ("stft_b1", stft),
                    ("ltft_b1", ltft),
                ):
                    engine.observe(_obs(signal, value, t), state, None)
                t += 0.2

        feed("WARM_IDLE", 1, 4, 20, 700, 0, 90, 40)
        feed("STEADY_CRUISE", 2, 5, 35, 2000, 80, 92, 40)
        feed("STEADY_CRUISE", 3, 5, 70, 2500, 100, 93, 40)
        result = engine.finish(_TrustOk())
        fuel = next(item for item in result if item["experiment_id"] == "experiment_b_fuel_trim")
        self.assertEqual(fuel["status"], "COMPLETE")
        self.assertTrue(fuel["result"]["usable_as_baseline"])


class _TrustOk:
    def state_of(self, signal_id):
        return "QUESTIONABLE"


class ReplayAndRawTests(unittest.TestCase):
    def test_raw_is_stored(self):
        handle, db = _db()
        self.addCleanup(db.close)
        self.addCleanup(handle.close)
        summary = load_fixture(db, "normal_start")
        rows = db.execute(
            """
            SELECT raw_value, decoded_value, estimated_sample_window_json, signal_id
            FROM observations
            WHERE session_id = ? AND signal_id = 'rpm' AND decoded_value = 0
            LIMIT 1
            """,
            (summary["session_id"],),
        ).fetchone()
        self.assertEqual(rows["raw_value"], "0000")
        window = json.loads(rows["estimated_sample_window_json"])
        self.assertEqual(window["method"], "request_response_bounds")
        self.assertNotEqual(window["start"], window["end"])

    def test_replay_preserves_raw_and_changes_with_config(self):
        handle, db = _db()
        self.addCleanup(db.close)
        self.addCleanup(handle.close)
        summary = load_fixture(db, "dfco")
        before = db.execute(
            "SELECT sequence_number, raw_value FROM observations WHERE session_id = ? ORDER BY sequence_number",
            (summary["session_id"],),
        ).fetchall()
        replay_session(db, summary["session_id"], state_config=StateConfig(cruise_min_kph=200))
        after = db.execute(
            "SELECT sequence_number, raw_value FROM observations WHERE session_id = ? ORDER BY sequence_number",
            (summary["session_id"],),
        ).fetchall()
        self.assertEqual([tuple(row) for row in before], [tuple(row) for row in after])
        states = [
            row["state"]
            for row in db.execute(
                "SELECT state FROM vehicle_states WHERE session_id = ?",
                (summary["session_id"],),
            ).fetchall()
        ]
        self.assertNotIn("STEADY_CRUISE", states)
        self.assertIn("DFCO", states)

    def test_disk_fixtures_match_builder(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        from pathlib import Path

        write_fixtures(Path(directory.name))
        for name in BUILDERS:
            header, rows = build_fixture(name)
            disk = Path(directory.name, f"{name}.jsonl").read_text(encoding="utf-8").splitlines()
            self.assertEqual(json.loads(disk[0])["fixture"], header["fixture"])
            self.assertEqual(len(disk) - 1, len(rows))

    def test_viewer_sections(self):
        handle, db = _db()
        self.addCleanup(db.close)
        self.addCleanup(handle.close)
        summary = load_fixture(db, "adapter_disconnect")
        status = build_status(db, summary["session_id"])
        self.assertFalse(status["hardware_tested"])
        self.assertTrue(status["recorded_events"])
        self.assertTrue(status["recorded_events"][0]["frozen"])
        self.assertFalse(status["recorded_events"][0]["overwritten"])
        self.assertEqual(status["recorded_events"][0]["trigger_source"], "ADAPTER_COMMUNICATION_LOSS")
        html = render_html(status)
        for heading in (
            "CONNECTED VEHICLE",
            "PROTOCOL",
            "SUPPORTED SIGNALS",
            "CURRENT ACQUISITION RATE",
            "CURRENT STATE",
            "SENSOR TRUST",
            "LIVE VALUES",
            "RECORDED EVENTS",
            "BASELINE EPOCH",
            "EXPERIMENT RESULTS",
            "CAPABILITY WARNINGS",
        ):
            self.assertIn(heading, html)
        self.assertIn("OFF", [row["state"] for row in db.execute(
            "SELECT state FROM vehicle_states WHERE session_id = ?",
            (summary["session_id"],),
        ).fetchall()])


class BenchmarkScriptTests(unittest.TestCase):
    def test_live_benchmark_skips_unpopulated_tiers(self):
        registry = load_registry()
        clock = FakeClock()

        def handler(command: str):
            if command == "010C":
                return "7E8 04 41 0C 0C 80", 0.05
            return "NO DATA", 0.01

        transport = ScriptedTransport(handler, clock)
        transport.open()
        elm = ElmSession(transport, clock)
        profile = {
            "vehicle_id": "V",
            "session_id": "S",
            "signals": {"rpm": {"state": "FULL"}},
            "protocol": {"name": "ISO 15765-4 (CAN 11/500)"},
            "adapter": {"identity_raw": "script"},
            "phone_sensors": {"device": None},
            "created_at": "2026-01-01T00:00:00.000000Z",
        }
        handle, db = _db()
        self.addCleanup(db.close)
        self.addCleanup(handle.close)
        ensure_vehicle(db, "V", None, "UNTESTED", "fp", profile["created_at"])
        adapter_id = ensure_adapter(db, {"identity_raw": "script", "adapter_id": "AD"}, "script", profile["created_at"])
        ensure_session(db, profile, source="script", source_detail="bench", adapter_id=adapter_id)
        recorder = Recorder(db, "S")
        benchmark = run_benchmark(elm, profile, recorder=recorder, duration_s=1.2)
        gated = apply_benchmark(profile, benchmark)
        tiers = {tier["n_signals"]: tier["status"] for tier in benchmark["tiers"]}
        self.assertEqual(tiers[1], "COMPLETE")
        self.assertEqual(tiers[8], "SKIPPED")
        self.assertGreater(gated["sustained_feature_rate_hz"], 5)
        rows = load_observations(db, "S")
        self.assertTrue(all(row.raw_value for row in rows))
        self.assertTrue(any(row.decoded_value == 800 for row in rows))


class ViewerHttpTests(unittest.TestCase):
    def test_status_endpoint(self):
        handle, db = _db()
        self.addCleanup(db.close)
        self.addCleanup(handle.close)
        load_fixture(db, "sensor_anchor_failure")
        from vicore.viewer import Viewer

        viewer = Viewer(handle.name, port=0)
        httpd = viewer.start_thread()
        port = httpd.server_address[1]

        def _stop_viewer():
            httpd.shutdown()
            httpd.server_close()

        self.addCleanup(_stop_viewer)
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/status") as response:
            payload = json.loads(response.read().decode("utf-8"))
        self.assertIn("sensor_trust", payload)
        self.assertEqual(payload["sensor_trust"]["map"]["state"], "UNTRUSTED")
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/") as response:
            page = response.read().decode("utf-8")
        self.assertIn("SENSOR TRUST", page)
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}/api/it-just-did-it",
            data=b"",
            method="POST",
        )
        with self.assertRaises(urllib.error.HTTPError) as raised:
            urllib.request.urlopen(request)
        self.assertEqual(raised.exception.code, 409)


if __name__ == "__main__":
    unittest.main()
