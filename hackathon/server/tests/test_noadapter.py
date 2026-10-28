"""No-adapter mode: rule floors on the owner's words, typed codes, no-scan voice. All Muse calls mocked."""
import io
import json
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
from lylo_hack import muse, symptoms  # noqa: E402
from lylo_hack.ledger import SAFETY_ORDER  # noqa: E402
from tests.test_vision_voice import fake, wav  # noqa: E402

RANK = {lv: i for i, lv in enumerate(SAFETY_ORDER)}


def lv(text):
    items, level, *_ = symptoms.build(text, [])
    return level


class RuleTests(unittest.TestCase):
    def test_floors(self):
        cases = {
            "the car is on fire": "EMERGENCY_STOP_IMMEDIATELY",
            "smoke coming from the hood": "DO_NOT_DRIVE",
            "there's steam from the engine": "DO_NOT_DRIVE",
            "I smell something burning": "DO_NOT_DRIVE",
            "burning smell after driving": "DO_NOT_DRIVE",
            "grinding noise when I brake": "DO_NOT_DRIVE",
            "brakes are grinding": "DO_NOT_DRIVE",
            "brake pedal goes to the floor": "DO_NOT_DRIVE",
            "red oil light came on": "DO_NOT_DRIVE",
            "oil pressure light is on": "DO_NOT_DRIVE",
            "coolant light on": "DO_NOT_DRIVE",
            "temperature gauge is in the red": "DO_NOT_DRIVE",
            "it's overheating": "DO_NOT_DRIVE",
            "brake light on the dash": "DO_NOT_DRIVE",
            "check engine light is flashing": "DO_NOT_DRIVE",
            "smell gas in the cabin": "DO_NOT_DRIVE",
            "check engine light is on": "INSPECT_SOON",
            "it makes a weird noise": "INSPECT_SOON",
        }
        for text, want in cases.items():
            self.assertEqual(lv(text), want, text)

    def test_shared_cases_match_phone(self):
        p = os.path.join(os.path.dirname(__file__), "..", "..", "mobile-bridge", "test", "fixtures", "symptom_cases.json")
        with open(p) as fh:
            for text, want in json.load(fh).items():
                self.assertEqual(lv(text), want, text)

    def test_never_safe_without_data(self):
        self.assertNotEqual(lv("everything seems fine"), "SAFE_TO_DRIVE")

    def test_negation(self):
        self.assertEqual(lv("no smoke, just a rattle"), "INSPECT_SOON")
        self.assertEqual(lv("there isn't any smoke but brakes are grinding"), "DO_NOT_DRIVE")

    def test_ledger_labels(self):
        items, *_ = symptoms.build("smoke from the hood", [])
        ids = {i["id"]: i for i in items}
        self.assertIn("ctx:no_adapter", ids)
        self.assertEqual(ids["sym:smoke"]["source"], "owner's words")
        self.assertEqual(ids["rule:safety"]["level"], "DO_NOT_DRIVE")

    def test_parse_codes(self):
        good, bad = symptoms.parse_codes("p0171, P0300 xyz P0171")
        self.assertEqual(good, ["P0171", "P0300"])
        self.assertEqual(bad, ["XYZ"])


def answer_out(level="SAFE_TO_DRIVE", cites=("sym:smoke",)):
    return {"answer": {"text": "Could be oil on the exhaust.", "cites": list(cites)},
            "follow_up_checks": [{"text": "Look for leaks.", "cites": ["owner:description"]},
                                 {"text": "Invented.", "cites": ["pid:MADE_UP"]}],
            "answerable_from_evidence": True, "safety_opinion": {"level": level, "reason": "r", "cites": ["rule:safety"]}}


class RouteTests(unittest.TestCase):
    def setUp(self):
        self.c = create_app().test_client()

    def post(self, body, env=None, out=None, form=False, asr=None):
        e = {"LYLO_HACK_NO_ADAPTER": "1", **(env or {})}
        with mock.patch.dict(os.environ, e), mock.patch.object(muse, "chat_json", fake(out or answer_out())), \
             mock.patch.object(muse, "transcribe_wav", asr or (lambda w, **k: ("smoke from the hood", {"model": "m"}))):
            if form:
                return self.c.post("/api/v1/noadapter/check", data=body, content_type="multipart/form-data")
            return self.c.post("/api/v1/noadapter/check", json=body)

    def test_off_by_default(self):
        self.assertEqual(self.c.post("/api/v1/noadapter/check", json={"text": "x"}).status_code, 503)

    def test_needs_something(self):
        self.assertEqual(self.post({}).status_code, 400)

    def test_rules_only_without_muse(self):
        r = self.post({"text": "grinding when I brake"})
        j = r.get_json()
        self.assertEqual(r.status_code, 200, j)
        self.assertEqual(j["final_safety_level"], "DO_NOT_DRIVE")
        self.assertIn("lower", j["confidence_note"].lower())
        self.assertTrue(j["answer_status"].startswith("skipped"))

    def test_ai_cannot_lower_and_unverified_flagged(self):
        r = self.post({"text": "smoke from the hood"}, env={"LYLO_HACK_MUSE": "1"})
        j = r.get_json()
        self.assertEqual(j["final_safety_level"], "DO_NOT_DRIVE")
        self.assertEqual(j["answer"]["status"], "verified")
        self.assertEqual(j["unverified_claims"][0]["missing_ids"], ["pid:MADE_UP"])

    def test_ai_can_raise(self):
        r = self.post({"text": "rattle"}, env={"LYLO_HACK_MUSE": "1"}, out=answer_out("TOW_RECOMMENDED", ("owner:description",)))
        self.assertEqual(r.get_json()["final_safety_level"], "TOW_RECOMMENDED")

    def test_typed_codes_use_rule_engine(self):
        r = self.post({"codes": "P0300", "year": 2012, "make": "Honda", "model": "Accord"})
        j = r.get_json()
        self.assertEqual(r.status_code, 200, j)
        self.assertEqual(j["codes"], ["P0300"])
        ids = [i["id"] for i in j["ledger"]]
        self.assertIn("dtc:P0300:active", ids)
        self.assertIn("ctx:no_adapter", ids)
        self.assertGreaterEqual(RANK[j["final_safety_level"]], RANK["INSPECT_SOON"])

    def test_code_plus_symptom_floor(self):
        j = self.post({"codes": ["P0171"], "text": "and the oil light is on"}).get_json()
        self.assertEqual(j["final_safety_level"], "DO_NOT_DRIVE")

    def test_audio(self):
        r = self.post({"audio": (io.BytesIO(wav()), "q.wav")}, form=True)
        j = r.get_json()
        self.assertEqual(r.status_code, 200, j)
        self.assertEqual(j["transcript"], "smoke from the hood")
        self.assertEqual(j["final_safety_level"], "DO_NOT_DRIVE")

    def test_photo_floor(self):
        pe = json.dumps([{"id": "photo:light:coolant_temperature", "name": "coolant_temperature", "color": "red", "confidence": "high"}])
        j = self.post({"text": "rattle", "photo_evidence": pe}, form=True).get_json()
        self.assertGreaterEqual(RANK[j["final_safety_level"]], RANK["DO_NOT_DRIVE"])

    def test_voice_without_scan_when_flag_on(self):
        with mock.patch.dict(os.environ, {"LYLO_HACK_VOICE": "1", "LYLO_HACK_NO_ADAPTER": "1"}), \
             mock.patch.object(muse, "chat_json", fake(answer_out())):
            r = self.c.post("/api/v1/voice/ask", data={"question": "smoke from the hood, can I drive?"}, content_type="multipart/form-data")
        j = r.get_json()
        self.assertEqual(r.status_code, 200, j)
        self.assertEqual(j["mode"], "no_adapter")
        self.assertEqual(j["final_safety_level"], "DO_NOT_DRIVE")

    def test_voice_still_needs_scan_when_flag_off(self):
        with mock.patch.dict(os.environ, {"LYLO_HACK_VOICE": "1"}):
            r = self.c.post("/api/v1/voice/ask", data={"question": "q"}, content_type="multipart/form-data")
        self.assertEqual(r.status_code, 400)


if __name__ == "__main__":
    unittest.main()
