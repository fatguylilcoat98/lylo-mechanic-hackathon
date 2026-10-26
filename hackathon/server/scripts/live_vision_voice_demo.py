"""LIVE photo + voice demo calls; saves outputs to evidence/. Spends real Meta credit.

Calls (paced 8 s, stops on any error or 429):
  1+2. POST /api/v1/vision/dash  synthetic dashboard photo + usedcar scan, detective=1
       (1 muse-spark-1.3 vision call + 1 detective call that can cite photo:* items)
  3+4. POST /api/v1/voice/ask    synthetic TTS question (espeak-ng) + usedcar scan + photo evidence
       (1 muse-voice-transcribe-1.0 call + 1 muse-spark-1.3 answer call)
Assets are synthetic: an AI-generated generic dashboard (no people/plates) and a robot voice.
Usage (from hackathon/server): .venv/bin/python scripts/live_vision_voice_demo.py
"""
import io
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "scripts"))
os.environ.update({"LYLO_HACK_MUSE": "1", "LYLO_HACK_VISION": "1", "LYLO_HACK_VOICE": "1"})
from lylo_hack.app import create_app, load_env_file  # noqa: E402
from lylo_hack.ledger import mask_vin  # noqa: E402
from live_detective_demo import demo, PRICE_IN, PRICE_OUT  # noqa: E402

ASSETS = os.path.join(HERE, "evidence", "assets")
ASR_PER_SEC = 0.18 / 3600


def chat_cost(rc):
    u = (rc or {}).get("usage") or {}
    return u.get("prompt_tokens", 0) * PRICE_IN + u.get("completion_tokens", 0) * PRICE_OUT


def scrub(o):
    if isinstance(o, dict):
        return {k: (mask_vin(v) if k == "vin" and isinstance(v, str) else scrub(v)) for k, v in o.items()}
    if isinstance(o, list):
        return [scrub(v) for v in o]
    return o


def save(name, rec):
    with open(os.path.join(HERE, "evidence", name), "w") as f:
        json.dump(scrub(rec), f, indent=2, ensure_ascii=False)


def main():
    print("env keys loaded:", sorted(load_env_file()))
    c = create_app().test_client()
    scan = demo("usedcar")
    total, calls = 0.0, 0

    if "--voice-only" in sys.argv:  # reuse photo evidence saved by the last full run (no vision call)
        with open(os.path.join(HERE, "evidence", "vision_usedcar_dash.json")) as fh:
            j = json.load(fh)["response"]
        return voice_step(c, scan, j, total, calls)
    with open(os.path.join(ASSETS, "synthetic_dash_cel_oil.jpg"), "rb") as fh:
        photo = fh.read()
    r = c.post("/api/v1/vision/dash", content_type="multipart/form-data",
               data={"photo": (io.BytesIO(photo), "dash.jpg"), "scan": json.dumps(scan), "detective": "1"})
    j = r.get_json()
    calls += 1
    vc = chat_cost(j.get("receipt"))
    det = ((j.get("scan_result") or {}).get("detective") or {})
    dc = chat_cost(det.get("receipt"))
    calls += 1 if det.get("receipt", {}).get("model") else 0
    total += vc + dc
    save("vision_usedcar_dash.json", {"scenario": "vision usedcar + synthetic dash photo", "http_status": r.status_code,
                                      "estimated_cost_usd": round(vc + dc, 5), "request": {"scan": scan, "photo": "assets/synthetic_dash_cel_oil.jpg", "detective": "1"},
                                      "response": j})
    print(f"vision: http {r.status_code} status={j.get('vision_status')} items={[i['id'] for i in j.get('photo_evidence', [])]} "
          f"floor={j.get('photo_safety_floor')} final={j.get('final_safety_level')} action={j.get('photo_action')} "
          f"vision_latency={j.get('receipt', {}).get('latency_ms')} det_status={det.get('muse_status')} det_action={det.get('safety_action')} "
          f"cost=${vc + dc:.4f}")
    if r.status_code != 200 or j.get("vision_status") != "ok":
        print("stopping")
        return print(f"calls={calls} total=${total:.4f}")

    time.sleep(8)
    voice_step(c, scan, j, total, calls)


def voice_step(c, scan, j, total, calls):
    with open(os.path.join(ASSETS, "synthetic_question.wav"), "rb") as fh:
        audio = fh.read()
    r = c.post("/api/v1/voice/ask", content_type="multipart/form-data",
               data={"audio": (io.BytesIO(audio), "q.wav"), "scan": json.dumps(scan),
                     "photo_evidence": json.dumps(j.get("photo_evidence", []))})
    k = r.get_json()
    tr = k.get("transcribe_receipt") or {}
    calls += 1 if tr else 0
    calls += 1 if (k.get("receipt") or {}).get("model") else 0
    cost = chat_cost(k.get("receipt")) + (tr.get("audio_seconds") or 0) * ASR_PER_SEC
    total += cost
    save("voice_usedcar_question.json", {"scenario": "voice question about usedcar + photo evidence", "http_status": r.status_code,
                                         "estimated_cost_usd": round(cost, 5),
                                         "request": {"scan": scan, "audio": "assets/synthetic_question.wav", "photo_evidence": j.get("photo_evidence", [])},
                                         "response": k})
    print(f"voice: http {r.status_code} status={k.get('voice_status')} transcript={k.get('transcript')!r} asr_ms={tr.get('latency_ms')} "
          f"answer_status={(k.get('answer') or {}).get('status')} final={k.get('final_safety_level')} action={k.get('safety_action')} "
          f"unverified={len(k.get('unverified_claims') or [])} cost=${cost:.4f}")
    print("answer:", (k.get("answer") or {}).get("text"))
    print(f"calls={calls} total=${total:.4f}")


if __name__ == "__main__":
    main()
