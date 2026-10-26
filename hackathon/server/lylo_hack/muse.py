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


def chat_json(messages, schema, *, model=None, timeout=45, max_tokens=4000, effort="low"):
    """Returns (parsed_json, meta). Raises MuseError on any failure."""
    key = _key()
    if not key:
        raise MuseError("NO_KEY", "No Meta Model API key configured.")
    model = model or os.environ.get("LYLO_HACK_MUSE_MODEL", DEFAULT_MODEL)
    body = {
        "model": model,
        "messages": messages,
        "response_format": {"type": "json_schema", "json_schema": {"name": "detective", "schema": schema, "strict": True}},
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
