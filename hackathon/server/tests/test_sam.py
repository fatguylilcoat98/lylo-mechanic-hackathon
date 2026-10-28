"""SAM 3.1 outline client (LYLO_HACK_SAM). Synthetic stream text only, no network."""
import os
import unittest
from unittest import mock

os.environ["HTTPS_PROXY"] = os.environ["HTTP_PROXY"] = "http://127.0.0.1:9"
from lylo_hack import sam  # noqa: E402


class Sam(unittest.TestCase):
    LINE = ("<0f>0<|box;x1=100;y1=50;x2=300;y2=150;w=1000;h=500;c=0.91|><|mask;x=0;y=0;c=0.91;data=10,20,~abc|>,"
            "2<|box;x1=10;y1=10;x2=20;y2=20;w=1000;h=500|><|mask;x=0;y=0;data=2,2,!zz|>")

    def test_parse(self):
        b = sam.parse(self.LINE)
        self.assertEqual(b[0], {"id": 0, "x1": 0.1, "y1": 0.1, "x2": 0.3, "y2": 0.3, "c": 0.91})
        self.assertEqual(b[1]["id"], 2)
        self.assertEqual(sam.parse(""), [])
        self.assertEqual(sam.parse("<0f>0<|box;x1=1;y1=1|>"), [])

    def test_outline_stream_and_errors(self):
        sse = 'data: {"type":"response.output_text.delta","delta":"%s"}\ndata: {"type":"response.completed"}\n' % self.LINE.replace('"', '\\"')
        ok = sam.outline("engine_air_filter", b"jpeg", post=lambda j, c, t: sse)
        self.assertEqual(ok["status"], "ok")
        self.assertEqual(ok["concept"], "air filter box")

        def boom(j, c, t):
            raise sam.muse.MuseError("HTTP_404", "x")
        self.assertEqual(sam.outline("engine_air_filter", b"j", post=boom)["status"], "error: HTTP_404")
        self.assertEqual(sam.outline("engine_air_filter", b"j", post=lambda j, c, t: "")["status"], "no match")
        with mock.patch.dict(os.environ, {"LYLO_HACK_SAM": "0"}):
            self.assertFalse(sam.enabled())
        with mock.patch.dict(os.environ, {"LYLO_HACK_SAM": "1"}):
            self.assertTrue(sam.enabled())


if __name__ == "__main__":
    unittest.main()
