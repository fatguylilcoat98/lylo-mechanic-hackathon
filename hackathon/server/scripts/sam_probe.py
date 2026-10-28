"""One-shot, no-spend check: is sam-3.1 listed for our Meta Model API key? (GET /v1/models only.)
Prints model ids and yes/no. Never prints the key. Run on the server host: python scripts/sam_probe.py"""
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from lylo_hack import app as A, muse  # noqa: E402

A.load_env_file()
key = muse._key()
if not key:
    sys.exit("No Meta Model API key configured.")
req = urllib.request.Request(muse.BASE_URL + "/models", headers={"Authorization": "Bearer " + key})
try:
    with urllib.request.urlopen(req, timeout=15) as r:
        ids = sorted(m.get("id", "") for m in json.loads(r.read()).get("data", []))
except Exception as e:
    sys.exit("models list failed: " + str(e).replace(key, "[redacted]")[:200])
print("models:", ", ".join(ids))
print("sam-3.1 listed:", "yes" if "sam-3.1" in ids else "no")
