"""v0.6 Crash Guard alert email: flag, parsing, fixed text, limits. SMTP is stubbed; nothing is sent."""
import os, unittest
from unittest import mock

os.environ["LYLO_HACK_ENV_FILE"] = "none"
from lylo_hack.app import create_app  # noqa: E402
from lylo_hack import crash  # noqa: E402

SMTP = {"LYLO_HACK_SMTP_HOST": "smtp.invalid", "LYLO_HACK_SMTP_USER": "u", "LYLO_HACK_SMTP_PASS": "p", "LYLO_HACK_SMTP_FROM": "lylo@example.com"}


class Stub:
    sent = []
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def starttls(self, context=None): pass
    def login(self, u, p): pass
    def send_message(self, m): Stub.sent.append(m)


class CrashTests(unittest.TestCase):
    def client(self, env):
        db = f"/tmp/lylo-crash-{os.getpid()}.sqlite"
        if os.path.exists(db):
            os.remove(db)
        full = {"LYLO_HACK_REQUIRE_APP_KEY": "0", "LYLO_HACK_RATELIMIT_DB": db, **env}
        p = mock.patch.dict(os.environ, full); p.start(); self.addCleanup(p.stop)
        return create_app().test_client()

    def test_flag_off(self):
        c = self.client({})
        os.environ.pop("LYLO_HACK_CRASH_ALERT", None)
        self.assertEqual(c.post("/api/v1/crash/alert", json={"emails": ["a@b.co"]}).status_code, 503)

    def test_not_configured(self):
        c = self.client({"LYLO_HACK_CRASH_ALERT": "1"})
        for k in SMTP: os.environ.pop(k, None)
        r = c.post("/api/v1/crash/alert", json={"emails": ["a@b.co"]})
        self.assertEqual(r.status_code, 503); self.assertIn("not configured", r.get_json()["error"])

    def test_fixed_text_and_limit(self):
        c = self.client({"LYLO_HACK_CRASH_ALERT": "1", "LYLO_HACK_CRASH_PER_HOUR": "2", **SMTP})
        Stub.sent.clear()
        with mock.patch.object(crash.smtplib, "SMTP", lambda *a, **k: Stub()):
            body = {"emails": ["mom@example.com", "bad", "x@y.co"] + ["z@z.co"] * 8, "name": "Chris<script>", "lat": 38.5, "lon": -121.4,
                    "accuracy_m": 12, "at": 1793664000000, "test": True, "message": "BUY NOW"}
            r = c.post("/api/v1/crash/alert", json=body)
            self.assertEqual(r.status_code, 200)
            m = Stub.sent[0]
            self.assertEqual(len(m["To"].split(",")), 5)
            t = m.get_content()
            self.assertIn("TEST ONLY", t); self.assertIn("maps.google.com/?q=38.50000,-121.40000", t)
            self.assertNotIn("BUY NOW", t); self.assertNotIn("<script>", m["Subject"])
            self.assertEqual(c.post("/api/v1/crash/alert", json=body).status_code, 200)
            self.assertEqual(c.post("/api/v1/crash/alert", json=body).status_code, 429)

    def test_no_email(self):
        c = self.client({"LYLO_HACK_CRASH_ALERT": "1", **SMTP})
        self.assertEqual(c.post("/api/v1/crash/alert", json={"emails": ["nope"]}).status_code, 400)


if __name__ == "__main__":
    unittest.main()
