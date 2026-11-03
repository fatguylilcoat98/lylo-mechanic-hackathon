"""v0.7.2 LYLO_HACK_VIEW_MODE: the phone's view picks Muse's writing register; safety rules unchanged. Stubs only."""
import os
import unittest
from unittest import mock

from tests.test_detective import SCAN, good, fake
from lylo_hack.app import create_app
from lylo_hack import muse


class ViewModeTests(unittest.TestCase):
    def setUp(self):
        self.c = create_app().test_client()

    def post(self, data, env, out=None):
        seen = []
        with mock.patch.dict(os.environ, {"LYLO_HACK_MUSE": "1", **env}):
            with mock.patch.object(muse, "chat_json", fake(out or good(), seen=seen)):
                r = self.c.post("/api/v1/live/live", json=data)
        self.assertEqual(r.status_code, 200)
        return r.get_json(), seen[0][0]["content"]

    def test_flag_off_view_ignored(self):
        j, sysmsg = self.post({**SCAN, "view": "simple"}, {})
        self.assertNotIn("REGISTER", sysmsg)
        self.assertNotIn("view", j["detective"])

    def test_simple_and_mechanic_registers(self):
        _, a = self.post({**SCAN, "view": "simple"}, {"LYLO_HACK_VIEW_MODE": "1"})
        self.assertIn("10-year-old", a)
        _, b = self.post({**SCAN, "view": "mechanic"}, {"LYLO_HACK_VIEW_MODE": "1"})
        self.assertIn("master technician", b); self.assertIn("Never invent values", b)
        _, c = self.post({**SCAN, "view": "bogus"}, {"LYLO_HACK_VIEW_MODE": "1"})
        self.assertNotIn("REGISTER", c)

    def test_view_cannot_lower_safety(self):
        for v in ("simple", "mechanic"):
            j, _ = self.post({**SCAN, "view": v}, {"LYLO_HACK_VIEW_MODE": "1"}, out=good(level="SAFE_TO_DRIVE"))
            d = j["detective"]
            self.assertEqual(d["safety_action"], "detective_lower_ignored")
            self.assertEqual(j["safety"]["level"], d["rule_safety_level"])
            self.assertEqual(d["view"], v)
