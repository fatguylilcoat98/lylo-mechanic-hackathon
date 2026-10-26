"""Run a few LIVE Muse Detective calls and save the outputs to evidence/.

Spends real Meta credit (muse-spark-1.3, ~1-2 cents a call). Paced; stops on
the first 429 or error. Needs hackathon/server/.env with the key (gitignored).
Usage (from hackathon/server): .venv/bin/python scripts/live_detective_demo.py [max_calls]
"""
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
os.environ["LYLO_HACK_MUSE"] = "1"
from lylo_hack.app import create_app, load_env_file  # noqa: E402
from lylo_hack.ledger import mask_vin  # noqa: E402

BRIDGE = os.path.join(HERE, "..", "mobile-bridge")
PRICE_IN, PRICE_OUT = 1.25 / 1e6, 4.25 / 1e6  # muse-spark-1.3 standard, dev.meta.ai pricing page


def demo(name):
    js = ("const {scanToLivePayload}=require('./src/scanToLive');"
          "const {DEMO_SCANS}=require('../../baseline/mobile/src/data/demoScans');"
          f"process.stdout.write(JSON.stringify(scanToLivePayload(DEMO_SCANS['{name}'])));")
    return json.loads(subprocess.run(["node", "-e", js], cwd=BRIDGE, capture_output=True, text=True, check=True).stdout)


CLEARED_CLEAN = {  # synthetic: a "clean" used car whose codes were just wiped
    "vehicle_profile": {"year": 2016, "make": "Mazda", "model": "CX-5", "odometer": 87000},
    "raw_dtcs": [],
    "raw_pids": [
        {"name": "DIST_SINCE_CODES_CLEARED", "pid_code": "31", "raw_value": 6, "unit": "km"},
        {"name": "WARMUPS_SINCE_CLEAR", "pid_code": "30", "raw_value": 1, "unit": ""},
        {"name": "TIME_SINCE_CODES_CLEARED", "pid_code": "4E", "raw_value": 12, "unit": "min"},
        {"name": "ENGINE_COOLANT_TEMP", "pid_code": "05", "raw_value": 195, "unit": "°F"},
        {"name": "ENGINE_RPM", "pid_code": "0C", "raw_value": 700, "unit": "rpm"},
        {"name": "BATTERY_VOLTAGE", "pid_code": "42", "raw_value": 14.2, "unit": "V"}],
    "readiness_monitors": [{"name": "Catalyst", "status": "incomplete"}, {"name": "Evaporative system (EVAP)", "status": "incomplete"},
                           {"name": "Oxygen sensor", "status": "incomplete"}, {"name": "Misfire", "status": "complete"}],
    "codes_cleared_before_scan": True,
    "codes_cleared_evidence": ["Only 6 km driven since codes were cleared (under 80).", "Only 1 warm-up since codes were cleared (under 10).",
                               "Only 12 engine minutes since codes were cleared (under 60)."],
}


def main():
    max_calls = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    keys = load_env_file()
    print("env keys loaded:", sorted(keys))
    c = create_app().test_client()
    out_dir = os.path.join(HERE, "evidence")
    os.makedirs(out_dir, exist_ok=True)
    total = 0.0
    scenarios = [("usedcar", demo("usedcar")), ("checkengine", demo("checkengine")), ("cleared_clean", CLEARED_CLEAN)][:max_calls]
    for i, (name, payload) in enumerate(scenarios):
        if i:
            time.sleep(8)
        r = c.post("/api/v1/live/live", json=payload)
        j = r.get_json()
        d = j.get("detective", {})
        rc = d.get("receipt", {})
        u = rc.get("usage") or {}
        cost = (u.get("prompt_tokens", 0) * PRICE_IN) + (u.get("completion_tokens", 0) * PRICE_OUT)
        total += cost
        vp = payload.get("vehicle_profile", {})
        if vp.get("vin"):
            vp["vin"] = mask_vin(vp["vin"])
        for hv in ((j.get("hackathon") or {}).get("vehicle_received") or {}, j.get("vehicle") or {}):
            if hv.get("vin"):
                hv["vin"] = mask_vin(hv["vin"])
        rec = {"scenario": name, "http_status": r.status_code, "estimated_cost_usd": round(cost, 5),
               "request": payload, "response": j}
        with open(os.path.join(out_dir, f"detective_{name}.json"), "w") as f:
            json.dump(rec, f, indent=2, ensure_ascii=False)
        print(f"{name}: http {r.status_code} status={d.get('muse_status')} rule={d.get('rule_safety_level')} final={d.get('final_safety_level')} "
              f"action={d.get('safety_action')} model={rc.get('model')} latency_ms={rc.get('latency_ms')} usage={u} cost=${cost:.4f}")
        if d.get("muse_status") != "ok":
            print("stopping: muse_status not ok")
            break
    print(f"total estimated cost ${total:.4f}")


if __name__ == "__main__":
    main()
