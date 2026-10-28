"""v0.4.4: phone audio (Android AAC/ADTS, m4a) converted by ffmpeg through a pipe gets a correct WAV header."""
import io
import os
import shutil
import subprocess
import unittest
import wave

from lylo_hack import voice

HERE = os.path.dirname(__file__)
WAV = os.path.join(HERE, "..", "evidence", "assets", "synthetic_question.wav")
FF = shutil.which("ffmpeg")


def _encode(fmt, codec_args):
    p = subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-i", WAV, "-ar", "16000", "-ac", "1", *codec_args, "-f", fmt, "pipe:1"],
                       capture_output=True, timeout=20, check=True)
    return p.stdout


@unittest.skipUnless(FF, "ffmpeg not installed")
class ConvertTest(unittest.TestCase):
    def _secs(self):
        with wave.open(WAV) as w:
            return w.getnframes() / w.getframerate()

    def test_adts_aac_from_phone(self):
        out, secs = voice.prepare_audio(_encode("adts", ["-c:a", "aac", "-b:a", "64k"]))
        self.assertAlmostEqual(secs, self._secs(), delta=0.3)
        with wave.open(io.BytesIO(out)) as w:
            self.assertEqual((w.getnchannels(), w.getsampwidth(), w.getframerate()), (1, 2, 24000))
            self.assertAlmostEqual(w.getnframes() / 24000, secs, delta=0.01)  # header matches the data

    def test_wav_passthrough_unchanged(self):
        raw = open(WAV, "rb").read()
        out, secs = voice.prepare_audio(raw)
        self.assertIs(out, raw)

    def test_garbage_still_400(self):
        with self.assertRaises(voice.AudioError):
            voice.prepare_audio(b"not audio at all" * 100)

    def test_fix_piped_wav_bad_input(self):
        self.assertEqual(voice._fix_piped_wav(b"xx"), b"")


if __name__ == "__main__":
    unittest.main()
