# hackathon/server

Hackathon-built code only (Oct 26 – Nov 4, 2026).

`lylo_hack` is a small Flask app that serves `POST /api/v1/live/live` for the Android app. It reuses the pre-existing diagnostic pipeline in `baseline/backend` without editing it, and adds:

- Strict input validation. Bad input gets a 400/415 with a list of plain errors instead of the baseline's HTTP 500.
- Rejection of unknown PID names and wrong units. The baseline safety check reads PIDs by exact name, so a misspelled name used to hide an overheating engine silently.
- The vehicle fields the baseline route dropped (`vin`, `trim`, `engine_type`, `transmission`, `drive_type`); `model` and `odometer` now arrive from the phone.
- A `permanent` DTC status (Mode 0A). It's treated as active, because the car hasn't verified a repair.
- A local stub for the Layer-12 call to the-handshake.onrender.com (flag `LYLO_HACK_DISABLE_EXTERNAL_HANDSHAKE`, default on). The stub never fails open: acknowledgment stays required.
- A `hackathon` block in every reply showing conversion notes, codes-cleared evidence and the vehicle fields received.

It does not import `baseline/backend/app.py`, so no database, billing, auth or Stripe code loads.

```bash
cd hackathon/server
pip install -r requirements.txt
python -m unittest discover -s tests     # 12 tests; the JS end-to-end ones need node
LYLO_HACK_PORT=5088 python -m lylo_hack.app
```
