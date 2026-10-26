"""Minimal Meta Model API client (Chat Completions, stdlib only).

Key: META_MODEL_API_KEY, or the file named by META_MODEL_API_KEY_FILE.
The key is never logged or returned; error text is redacted.
"""
import json
import os
import time
import urllib.error
import urllib.request

BASE_URL = "https://api.meta.ai/v1"
DEFAULT_MODEL = "muse-spark-1.3"


class MuseError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def _key():
    k = os.environ.get("META_MODEL_API_KEY", "").strip()
    if k:
        return k
    f = os.environ.get("META_MODEL_API_KEY_FILE", "")
    if f:
        try:
            for line in open(f, encoding="utf8"):
                if line.strip() and not line.strip().startswith("#"):
                    return line.strip()
        except OSError:
            pass
    return ""


def configured():
    return bool(_key())


def chat_json(messages, schema, *, model=None, timeout=25, max_tokens=4000, effort="low", name="detective"):
    """Returns (parsed_json, meta). Raises MuseError on any failure."""
    key = _key()
    if not key:
        raise MuseError("NO_KEY", "No Meta Model API key configured.")
    model = model or os.environ.get("LYLO_HACK_MUSE_MODEL", DEFAULT_MODEL)
    body = {
        "model": model,
        "messages": messages,
        "response_format": {"type": "json_schema", "json_schema": {"name": name, "schema": schema, "strict": True}},
        "max_completion_tokens": max_tokens,
        "reasoning_effort": effort,
        "store": False,
    }
    req = urllib.request.Request(BASE_URL + "/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf8", "replace")
    except urllib.error.HTTPError as e:
        txt = e.read()[:300].decode("utf8", "replace").replace(key, "[redacted]")
        raise MuseError("RATE_LIMIT" if e.code == 429 else f"HTTP_{e.code}", txt)
    except Exception as e:  # timeout, DNS, TLS
        name = "TIMEOUT" if "timed out" in str(e).lower() or isinstance(e, TimeoutError) else "NETWORK"
        raise MuseError(name, str(e).replace(key, "[redacted]")[:200])
    latency_ms = int((time.monotonic() - t0) * 1000)
    try:
        d = json.loads(raw)
        msg = d["choices"][0]["message"]
        content = msg.get("content") or ""
        finish = d["choices"][0].get("finish_reason")
    except Exception:
        raise MuseError("BAD_ENVELOPE", "Response was not a chat completion.")
    meta = {"model": d.get("model", model), "latency_ms": latency_ms, "usage": d.get("usage"), "finish_reason": finish}
    try:
        return json.loads(content), meta
    except Exception:
        e = MuseError("BAD_JSON", f"Model output was not valid JSON (finish_reason={finish}).")
        e.meta = meta
        raise e


TRANSCRIBE_MODEL = "muse-voice-transcribe-1.0"


def transcribe_wav(wav_bytes, *, timeout=12, keywords=None):
    """POST /v1/asr/transcribe (multipart: request JSON + audio WAV). Returns (text, meta)."""
    key = _key()
    if not key:
        raise MuseError("NO_KEY", "No Meta Model API key configured.")
    import uuid
    boundary = "lylo" + uuid.uuid4().hex
    settings = {"mode": "PUSH_TO_TALK", "model": TRANSCRIBE_MODEL, "audioEncoding": "WAV",
                "languageBias": ["English"]}
    if keywords:
        settings["keywords"] = list(keywords)[:20]
    parts = [
        (f'--{boundary}\r\nContent-Disposition: form-data; name="request"\r\n'
         'Content-Type: application/json\r\n\r\n').encode() + json.dumps(settings).encode() + b"\r\n",
        (f'--{boundary}\r\nContent-Disposition: form-data; name="audio"; filename="q.wav"\r\n'
         'Content-Type: audio/wav\r\n\r\n').encode() + wav_bytes + b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ]
    req = urllib.request.Request(BASE_URL + "/asr/transcribe", data=b"".join(parts),
                                 headers={"Authorization": "Bearer " + key, "Accept": "application/json",
                                          "Content-Type": "multipart/form-data; boundary=" + boundary})
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf8", "replace")
    except urllib.error.HTTPError as e:
        txt = e.read()[:300].decode("utf8", "replace").replace(key, "[redacted]")
        raise MuseError("RATE_LIMIT" if e.code == 429 else f"HTTP_{e.code}", txt)
    except Exception as e:
        name = "TIMEOUT" if "timed out" in str(e).lower() or isinstance(e, TimeoutError) else "NETWORK"
        raise MuseError(name, str(e).replace(key, "[redacted]")[:200])
    try:
        d = json.loads(raw)
        text = str(d["transcript"])
    except Exception:
        raise MuseError("BAD_ENVELOPE", "Response was not a transcript.")
    return text, {"model": TRANSCRIBE_MODEL, "latency_ms": int((time.monotonic() - t0) * 1000),
                  "audio_duration_ms": d.get("audioDurationMs")}
