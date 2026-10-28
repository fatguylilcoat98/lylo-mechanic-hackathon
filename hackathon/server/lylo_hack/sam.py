"""SAM 3.1 part outline for Point and prove (hackathon v0.5.0). Flag LYLO_HACK_SAM=1 (default off).

POST {BASE}/responses, model sam-3.1, one short noun phrase + the user's photo; the stream returns
"<0f>id<|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..[;c=..]|><|mask;...|>,..." (dev.meta.ai/docs/sam/reading-segmentation).
We keep boxes only (masks dropped). Any failure returns status "error: <code>" and the Muse circles still show.
The photo is sent once and never stored.
"""
import base64
import json
import os
import re
import time
import urllib.error
import urllib.request

from . import muse

MODEL = "sam-3.1"
# Short concept phrases per Photo Helper job (SAM reads a noun phrase, not an instruction).
CONCEPTS = {"engine_air_filter": "air filter box", "battery": "car battery", "cabin_air_filter": "glove box",
            "wiper_blades": "windshield wiper", "bulb": "headlight", "tires": "tire",
            "ignition_coil": "ignition coil"}
BOX = re.compile(r"(\d+)<\|box;([^|]*)\|>")


def enabled():
    return os.environ.get("LYLO_HACK_SAM", "0") == "1"


def parse(text, limit=6):
    """Special-token text -> [{id, x1,y1,x2,y2 as 0..1 fractions, c?}]. Pure; ignores masks."""
    out = []
    for m in BOX.finditer(text or ""):
        f = {}
        for kv in m.group(2).split(";"):
            k, _, v = kv.partition("=")
            try:
                f[k.strip()] = float(v)
            except ValueError:
                pass
        if not all(k in f for k in ("x1", "y1", "x2", "y2", "w", "h")) or f["w"] <= 0 or f["h"] <= 0:
            continue
        b = {"id": int(m.group(1)), "x1": round(f["x1"] / f["w"], 4), "y1": round(f["y1"] / f["h"], 4),
             "x2": round(f["x2"] / f["w"], 4), "y2": round(f["y2"] / f["h"], 4)}
        if "c" in f:
            b["c"] = f["c"]
        out.append(b)
    return out[:limit]


def _stream_text(raw):
    """SSE body -> concatenated output_text deltas."""
    parts = []
    for line in raw.splitlines():
        if not line.startswith("data: "):
            continue
        try:
            ev = json.loads(line[6:])
        except ValueError:
            continue
        if ev.get("type") == "response.output_text.delta":
            parts.append(str(ev.get("delta", "")))
    return "".join(parts)


def _post(jpeg, concept, timeout):
    key = muse._key()
    if not key:
        raise muse.MuseError("NO_KEY", "No Meta Model API key configured.")
    url = "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()
    body = {"model": MODEL, "stream": True, "include_confidence": "true",
            "input": [{"type": "message", "role": "user", "content": [
                {"type": "input_text", "text": concept}, {"type": "input_image", "image_url": url}]}]}
    req = urllib.request.Request(muse.BASE_URL + "/responses", data=json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + key, "Content-Type": "application/json",
                                          "Accept": "text/event-stream"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf8", "replace")
    except urllib.error.HTTPError as e:
        raise muse.MuseError("RATE_LIMIT" if e.code == 429 else f"HTTP_{e.code}", "SAM request failed")
    except Exception as e:
        raise muse.MuseError("TIMEOUT" if "timed out" in str(e).lower() else "NETWORK", "SAM request failed")


def outline(job, jpeg, post=None):
    """Returns {status, model, concept, boxes, latency_ms}. Never raises."""
    concept = CONCEPTS.get(job)
    if not concept:
        return {"status": "skipped (no concept for this job)", "model": MODEL, "boxes": []}
    t0 = time.monotonic()
    try:
        raw = (post or _post)(jpeg, concept, float(os.environ.get("LYLO_HACK_SAM_TIMEOUT_S", "20")))
        boxes = parse(_stream_text(raw))
    except muse.MuseError as e:
        return {"status": f"error: {e.code}", "model": MODEL, "concept": concept, "boxes": []}
    except Exception as e:
        return {"status": f"error: {type(e).__name__}", "model": MODEL, "concept": concept, "boxes": []}
    return {"status": "ok" if boxes else "no match", "model": MODEL, "concept": concept, "boxes": boxes,
            "latency_ms": int((time.monotonic() - t0) * 1000), "source": "SAM 3.1 outline of your photo (not a diagnosis)"}
