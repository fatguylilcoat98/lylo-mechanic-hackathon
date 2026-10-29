import hashlib
import os
import tempfile
import unittest
from unittest import mock

os.environ["LYLO_HACK_MUSE"] = "0"
os.environ["LYLO_HACK_ENV_FILE"] = "none"
os.environ["HTTPS_PROXY"] = os.environ["HTTP_PROXY"] = "http://127.0.0.1:9"

from lylo_hack import security  # noqa: E402
from lylo_hack.app import create_app  # noqa: E402

KEY = "test-key-not-a-secret"
SCAN = {"vehicle": {"vin": "1HGCM82633A004352"}, "pids": {}, "dtcs": []}


class SecurityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False).name
        self.env = {"LYLO_HACK_RATELIMIT_DB": self.tmp, "LYLO_HACK_REQUIRE_APP_KEY": "1",
                    "LYLO_HACK_APP_KEY_SHA256": hashlib.sha256(KEY.encode()).hexdigest(),
                    "LYLO_HACK_RL_IP_PER_MIN": "30", "LYLO_HACK_RL_IP_MUSE_PER_MIN": "10",
                    "LYLO_HACK_RL_KEY_MUSE_PER_MIN": "10", "LYLO_HACK_RL_KEY_MUSE_PER_DAY": "100", "LYLO_HACK_MUSE_DAILY_CAP": "300",
                    "LYLO_HACK_VISION": "0", "LYLO_HACK_VOICE": "0"}
        self.old = {k: os.environ.get(k) for k in self.env}
        os.environ.update(self.env)
        self.c = create_app().test_client()

    def tearDown(self):
        for k, v in self.old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        os.unlink(self.tmp)

    def _freeze_clock(self):
        """Pin the limiter clock mid-window (30 s into a minute) so per-minute counts cannot reset during the test."""
        p = mock.patch.object(security.time, "time", return_value=1_000_000 * 60 + 30.0)
        p.start()
        self.addCleanup(p.stop)

    def post(self, key=KEY, **kw):
        h = {"X-LYLO-App-Key": key} if key else {}
        h.update(kw.pop("headers", {}))
        return self.c.post("/api/v1/live/live", json=SCAN, headers=h, **kw)

    def test_healthz_open(self):
        r = self.c.get("/healthz")
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("Access-Control-Allow-Origin", r.headers)

    def test_missing_and_bad_key(self):
        self.assertEqual(self.post(key=None).status_code, 401)
        self.assertEqual(self.post(key="wrong").status_code, 401)

    def test_good_key(self):
        r = self.post()
        self.assertNotIn(r.status_code, (401, 429, 503))
        self.assertNotIn("Access-Control-Allow-Origin", r.headers)

    def test_fail_closed_without_configured_digest(self):
        os.environ["LYLO_HACK_APP_KEY_SHA256"] = ""
        self.assertEqual(self.post().status_code, 503)

    def test_ip_rate_limit_429_with_retry_after(self):
        os.environ["LYLO_HACK_RL_IP_PER_MIN"] = "3"
        self._freeze_clock()  # v0.5.1: fixed windows on the real clock flaked when a minute boundary fell mid-test
        codes = [self.post(key="wrong").status_code for _ in range(4)]
        self.assertEqual(codes[:3], [401] * 3)
        self.assertEqual(codes[3], 429)

    def test_cf_ip_trusted_only_from_loopback(self):
        self.assertEqual(security.client_ip("127.0.0.1", {"CF-Connecting-IP": "203.0.113.9"}), "203.0.113.9")
        self.assertEqual(security.client_ip("198.51.100.2", {"CF-Connecting-IP": "203.0.113.9"}), "198.51.100.2")

    def test_per_ip_buckets_separate_behind_tunnel(self):
        os.environ["LYLO_HACK_RL_IP_PER_MIN"] = "2"
        self._freeze_clock()
        a = {"CF-Connecting-IP": "203.0.113.1"}
        b = {"CF-Connecting-IP": "203.0.113.2"}
        self.assertEqual([self.post(headers=a).status_code != 429 for _ in range(3)], [True, True, False])
        self.assertNotEqual(self.post(headers=b).status_code, 429)

    def test_muse_key_and_global_caps(self):
        lim = security.Limiter(self.tmp)
        rules = security.rules_for("1.2.3.4", "k1", True)[1:]
        os.environ["LYLO_HACK_MUSE_DAILY_CAP"] = "2"
        try:
            rules = security.rules_for("1.2.3.4", "k1", True)[1:]
            self.assertIsNone(lim.hit(rules, now=1000))
            self.assertIsNone(lim.hit(rules, now=1001))
            self.assertEqual(lim.hit(rules, now=1002)[0], "global:muse:day")
        finally:
            os.environ["LYLO_HACK_MUSE_DAILY_CAP"] = "300"

    def test_key_per_minute(self):
        lim = security.Limiter(self.tmp)
        rules = security.rules_for("1.2.3.4", "k2", True)[1:]
        for i in range(10):
            self.assertIsNone(lim.hit(rules, now=60 * 100 + i))
        self.assertIn(lim.hit(rules, now=60 * 100 + 11)[0], ("ipmuse:1.2.3.4", "key:k2:min"))
        self.assertIsNone(lim.hit(rules, now=60 * 101 + 1))  # next window

    def test_oversize_rejected(self):
        r = self.c.post("/api/v1/vision/dash", data=b"x" * (7 * 1024 * 1024),
                        headers={"X-LYLO-App-Key": KEY, "Content-Type": "application/octet-stream"})
        self.assertEqual(r.status_code, 413)


if __name__ == "__main__":
    unittest.main()
