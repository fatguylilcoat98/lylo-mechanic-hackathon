"""Registry, formulas, handshake, benchmark math, and the serial pty path."""

from __future__ import annotations

import io
import os
import tempfile
import threading
import unittest
from contextlib import redirect_stdout

from vicore.clock import FakeClock
from vicore.db import Database
from vicore.elm import ElmSession, UnsafeCommand, assert_safe_command
from vicore.features import evaluate_features, query_feature
from vicore.formula import decode, encode
from vicore.handshake import run_handshake
from vicore.obdparse import decode_bitmap, decode_dtcs, decode_vin, encode_bitmap
from vicore.phone import probe_phone_sensors
from vicore.registry import export_json, load_registry, require_signal
from vicore.registry_data import SOURCE_KINDS
from vicore.stats import percentile, summarize_acquisition
from vicore.transport import ScriptedTransport, SerialTransport


class RegistryTests(unittest.TestCase):
    def test_schema_and_export(self):
        registry = load_registry()
        self.assertIn("rpm", registry)
        self.assertIn("map", registry)
        self.assertIn("phone_baro", registry)
        for item in registry.values():
            self.assertIn(item["source_kind"], SOURCE_KINDS)
            self.assertEqual(item["minimum_rate"]["unit"], "Hz")
        with self.assertRaises(Exception):
            require_signal(registry, "map_baro_residual")
        path = export_json()
        self.assertTrue(path.is_file())
        loaded = __import__("json").loads(path.read_text(encoding="utf-8"))
        self.assertEqual(len(loaded), len(registry))

    def test_formulas_roundtrip_raw(self):
        registry = load_registry()
        cases = {
            "rpm": 800,
            "ect": 90,
            "map": 100,
            "stft_b1": 6.25,
            "ltft_b1": -6.25,
            "throttle_abs": 0,
            "control_module_voltage": 14.2,
            "fuel_system_status": 4,
            "adapter_voltage": 12.4,
            "phone_baro": 101.3,
        }
        for signal_id, value in cases.items():
            signal = registry[signal_id]
            raw = encode(signal["formula"], value)
            decoded = decode(signal["formula"], raw)
            self.assertAlmostEqual(decoded, value, places=2)
            # The raw bytes are the measurement. They are not discarded.
            self.assertTrue(len(raw) > 0)
        # 50% is not a multiple of 100/255. The SAE byte is authoritative.
        throttle = registry["throttle_abs"]
        raw = encode(throttle["formula"], 50)
        decoded = decode(throttle["formula"], raw)
        self.assertEqual(encode(throttle["formula"], decoded), raw)
        self.assertAlmostEqual(decoded, 50, places=0)
        self.assertNotEqual(decoded, 50)


class BitmapTests(unittest.TestCase):
    def test_known_bits(self):
        self.assertEqual(encode_bitmap(0x00, {0x01}).hex().upper(), "80000000")
        self.assertEqual(encode_bitmap(0x00, {0x0C}).hex().upper(), "00100000")
        self.assertEqual(encode_bitmap(0x00, {0x20}).hex().upper(), "00000001")
        self.assertEqual(decode_bitmap(0x00, bytes.fromhex("00100000")), {0x0C})

    def test_vin_and_dtc_do_not_invent(self):
        vin, status = decode_vin(bytes.fromhex("490201") + b"1FAHP2EJ7AL123456")
        self.assertEqual(status, "ok")
        self.assertEqual(vin, "1FAHP2EJ7AL123456")
        bad, status = decode_vin(b"\x49\x02\x01NOPE")
        self.assertIsNone(bad)
        parsed = decode_dtcs(bytes.fromhex("430000"), "6")
        self.assertEqual(parsed["codes"], [])
        self.assertEqual(parsed["dtc_count"], 0)
        self.assertEqual(parsed["claim"], "NONE")
        one = decode_dtcs(bytes.fromhex("430133"), "6")
        self.assertEqual(one["codes"], ["P0133"])
        self.assertEqual(one["claim"], "NONE")
        odd = decode_dtcs(bytes.fromhex("4300"), "6")
        self.assertEqual(odd["parse_status"], "ORDER_INDETERMINATE")
        self.assertEqual(odd["codes"], [])


class StatsTests(unittest.TestCase):
    def test_sustained_is_p5_not_peak(self):
        # One slow second, four fast seconds, then a trailing sample.
        # The trailing partial bucket is dropped, so the slow second counts.
        times = [0.0, 0.4]
        for bucket in (1, 2, 3, 4):
            for index in range(10):
                times.append(bucket + 0.05 + index * 0.08)
        times.append(5.1)
        stats = summarize_acquisition(
            request_times=times,
            success_times=times,
            latencies=[0.02] * len(times),
            requests_sent=len(times),
            successful_responses=len(times),
            negative_responses=0,
            timeouts=0,
            duration_s=5,
        )
        self.assertEqual(stats["status"], "COMPLETE")
        self.assertLess(stats["p5_rate_hz"], stats["p95_rate_hz"])
        self.assertAlmostEqual(stats["sustained_hz"], stats["p5_rate_hz"])
        self.assertGreater(stats["p95_rate_hz"], 5)

    def test_percentile(self):
        self.assertEqual(percentile([2, 10, 10, 10, 10], 5), 2 * 0.8 + 10 * 0.2)


def _support_line(group: int, pids: set[int], header: str = "7E8") -> str:
    raw = encode_bitmap(group, pids)
    payload = bytes([0x41, group]) + raw
    body = bytes([len(payload)]) + payload
    hexes = " ".join(f"{byte:02X}" for byte in body)
    return f"{header} {hexes}"


class HandshakeTests(unittest.TestCase):
    def _pids(self):
        group0 = {0x03, 0x04, 0x05, 0x06, 0x07, 0x0B, 0x0C, 0x0D, 0x0F, 0x11, 0x1F, 0x20}
        group1 = {0x33, 0x40}
        group2 = {0x42, 0x45, 0x4C}
        return group0, group1, group2

    def _handler(self, mode06: str = "OK"):
        g0, g1, g2 = self._pids()
        vin = "1FAHP2EJ7AL123456"
        vin_payload = bytes([0x49, 0x02, 0x01]) + vin.encode()
        vin_line = "7E8 " + " ".join(f"{byte:02X}" for byte in bytes([len(vin_payload)]) + vin_payload)
        mode09 = encode_bitmap(0x00, {0x02, 0x04, 0x0A})
        m09_payload = bytes([0x49, 0x00]) + mode09
        m09_line = "7E8 " + " ".join(f"{byte:02X}" for byte in bytes([len(m09_payload)]) + m09_payload)
        table = {
            "ATZ": "OBDLink MX+ v5.8.1",
            "ATE0": "OK",
            "ATL0": "OK",
            "ATS1": "OK",
            "ATH1": "OK",
            "ATAT1": "OK",
            "ATAL": "OK",
            "ATCAF1": "OK",
            "ATSP0": "OK",
            "ATI": "STN2120 v5.8.1",
            "AT@1": "OBDLink MX+",
            "AT@2": "OBDLink MX+",
            "STI": "STN2120 v5.8.1",
            "STDI": "OBDLink MX+",
            "STSN": "112233445566",
            "ATRV": "12.60V",
            "ATIGN": "ON",
            "ATDP": "ISO 15765-4 (CAN 11/500)",
            "ATDPN": "A6",
            "0100": _support_line(0x00, g0),
            "0120": _support_line(0x20, g1),
            "0140": _support_line(0x40, g2),
            "0900": m09_line,
            "0902": vin_line,
            "0904": "7E8 03 49 04 41",
            "090A": "7E8 04 49 0A 01 45",
            "0600": "7E8 06 46 00 C0 00 00 00" if mode06 == "OK" else "7F 06 11",
            "03": "7E8 03 43 00 00",
            "07": "7E8 03 47 00 00",
            "0A": "7E8 03 4A 00 00",
        }

        def handler(command: str):
            if command not in table:
                return "?", 0.0
            return table[command], 0.0

        return handler

    def test_mxplus_profile_does_not_invent_maf(self):
        clock = FakeClock()
        transport = ScriptedTransport(self._handler(), clock)
        transport.open()
        elm = ElmSession(transport, clock)
        phone = probe_phone_sensors()
        profile = run_handshake(
            elm,
            vehicle_id=None,
            session_id="sess-test",
            phone=phone,
            transport_meta={"kind": "scripted", "path": None, "hardware_tested": False},
        )
        self.assertFalse(profile["hardware_tested"])
        self.assertEqual(profile["adapter"]["vendor_hint"], "OBDLink MX+")
        self.assertIn("STN2120", profile["adapter"]["firmware"])
        self.assertEqual(profile["protocol"]["number"], "6")
        self.assertEqual(profile["vin"]["value"], "1FAHP2EJ7AL123456")
        self.assertEqual(profile["vin"]["status"], "READ")
        self.assertEqual(profile["signals"]["rpm"]["state"], "FULL")
        self.assertEqual(profile["signals"]["maf"]["state"], "UNSUPPORTED")
        self.assertNotIn("10", profile["mode01"]["supported_pids"])
        self.assertEqual(profile["mode06"]["state"], "SUPPORTED")
        self.assertFalse(profile["mode06"]["o2_trend_computed"])
        self.assertEqual(profile["diagnostic"]["mode03"]["claim"], "NONE")
        self.assertEqual(profile["diagnostic"]["mode03"]["dtc_count"], 0)
        self.assertEqual(profile["diagnostic"]["mode04_clear"]["state"], "UNSUPPORTED")
        self.assertEqual(profile["phone_sensors"]["sensors"]["barometer"]["state"], "UNTESTED")
        self.assertEqual(profile["signals"]["phone_baro"]["state"], "UNTESTED")
        headers = [item["header"] for item in profile["ecus"]]
        self.assertIn("7E8", headers)
        feature = query_feature(profile, "experiment_a_koeo_map")
        self.assertEqual(feature.state, "UNTESTED")
        self.assertIn("benchmark", feature.reason)
        self.assertNotIn("0160", transport.sent)
        self.assertTrue(profile["vehicle_id"].startswith("VIN-"))

    def test_generic_elm_is_not_called_mxplus(self):
        def handler(command: str):
            # A generic ELM does not answer identity commands with an MX+ string.
            if command in {"ATZ", "ATI", "AT@2"}:
                return "ELM327 v1.5", 0.0
            if command in {"AT@1", "STI", "STDI"}:
                return "?", 0.0
            base = HandshakeTests._handler(self)
            return base(command)

        clock = FakeClock()
        transport = ScriptedTransport(handler, clock)
        transport.open()
        profile = run_handshake(
            ElmSession(transport, clock),
            vehicle_id=None,
            session_id="sess-generic",
            phone=probe_phone_sensors(),
            transport_meta={"kind": "scripted", "hardware_tested": False},
        )
        self.assertNotEqual(profile["adapter"]["vendor_hint"], "OBDLink MX+")
        self.assertIn("ELM327", profile["adapter"]["vendor_hint"])

    def test_mode06_negative_is_unsupported(self):
        clock = FakeClock()
        transport = ScriptedTransport(self._handler(mode06="NO"), clock)
        transport.open()
        profile = run_handshake(
            ElmSession(transport, clock),
            vehicle_id=None,
            session_id="sess-no06",
            phone=probe_phone_sensors(),
            transport_meta={"kind": "scripted", "hardware_tested": False},
        )
        self.assertEqual(profile["mode06"]["state"], "UNSUPPORTED")

    def test_mode04_refused(self):
        with self.assertRaises(UnsafeCommand):
            assert_safe_command("04")

    def test_feature_blocks_slow_rate(self):
        support = {"throttle_abs": {"state": "FULL"}, "rpm": {"state": "FULL"}}
        benchmark = {
            "tiers": [
                {"n_signals": 1, "status": "COMPLETE", "sustained_hz": 5.0},
            ]
        }
        features = evaluate_features(support, benchmark)
        self.assertEqual(features["throttle_hysteresis"]["state"], "UNSUPPORTED")
        self.assertEqual(features["throttle_hysteresis"]["reason"], "INSUFFICIENT_ACQUISITION_RATE")
        # rpm is present, but ect, speed, and fuel status are not. That is REDUCED.
        self.assertEqual(features["state_detector"]["state"], "REDUCED")
        self.assertIn("ect", features["state_detector"]["reason"])


class SerialPtyTests(unittest.TestCase):
    def test_prompt_roundtrip(self):
        master, slave = os.openpty()
        slave_name = os.ttyname(slave)
        transport = SerialTransport(slave_name)

        def adapter():
            data = b""
            while b"\r" not in data:
                chunk = os.read(master, 256)
                if not chunk:
                    return
                data += chunk
            os.write(master, b"STN2120 v5.8.1\r>")

        thread = threading.Thread(target=adapter)
        thread.start()
        transport.open()
        try:
            body = transport.exchange("ATI", 2.0)
        finally:
            transport.close()
            thread.join(timeout=2)
            os.close(master)
            os.close(slave)
        self.assertIn("STN2120", body)


class DatabaseTests(unittest.TestCase):
    def test_tables_exist(self):
        handle = tempfile.NamedTemporaryFile(suffix=".sqlite")
        db = Database(handle.name)
        rows = db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        names = {row["name"] for row in rows}
        for required in (
            "vehicles",
            "sessions",
            "adapters",
            "capability_profiles",
            "signals",
            "observations",
            "sensor_trust",
            "baseline_epochs",
            "vehicle_states",
            "transitions",
            "events",
            "experiments",
            "experiment_results",
            "repairs",
            "dead_ideas",
            "analysis_versions",
        ):
            self.assertIn(required, names)
        db.close()

    def test_db_flag_follows_the_command(self):
        from vicore.__main__ import main

        handle = tempfile.NamedTemporaryFile(suffix=".sqlite")
        with redirect_stdout(io.StringIO()):
            code = main(["status", "--db", handle.name])
        self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
