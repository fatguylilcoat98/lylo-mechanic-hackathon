# LYLO Mechanic

**LYLO stands for Love Your Loved Ones.** It's an Android app that reads a car's computer (or, with no adapter, what you tell it) and says in plain words what's going on and whether it's safe to drive. It shows its evidence for every claim.

Built for the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026). Everything new is listed file by file in [NEW_WORK.md](NEW_WORK.md).

## Why
Chris (the builder) borrowed $2,000 for a used car. It looked and drove fine. Two weeks later the check-engine light came on (P0300, misfire). He replaced the coil pack and cleared the code, and two days later it was back. Three weeks after that the transmission failed, stuck in reverse. The seller had a shop and most likely cleared the codes before the sale. Chris had no proof. LYLO is meant to give buyers and drivers that proof.

## What it does
**With an OBD adapter** (OBDLink CX and MX+ supported):
- Scans codes, live readings and the emissions self-tests ("readiness monitors").
- **Used-Car Check:** flags recently cleared codes, using miles since clear, warm-ups since clear, engine time since clear and unfinished monitors.
- **Safety level** from fixed rules, in six steps from "Safe to drive" up to "Stop now".
- **Muse Detective** (Meta Muse Spark): ranked likely causes, each citing the scan facts it uses. Simple view for drivers, Mechanic view for the evidence.
- **Snap the dash** (warning lights from a photo) and **Ask out loud** (a spoken question, answered from the scan).

**Without an adapter:**
- Describe the problem (typed or spoken) or type a trouble code. The same safety rules run on the phone first. The app says up front that it's less accurate without live sensor data.
- **VIN lookup** (typed or photo) through NHTSA's free database, with **recalls for your model** (by year, make and model, not your exact VIN).
- **Photo Helper:** take a photo and LYLO circles the part (for example the air filter) on your own photo.
- **Price help:** LYLO's own DIY, shop and dealer estimate ranges; buttons that open AutoZone, O'Reilly, Advance, NAPA and RockAuto searches; **Find nearest store** (opens Google Maps; LYLO asks for no location permission); **Watch how** (a YouTube search for videos for your model).
- **Try a demo scan:** no car needed (see below).
- First-run setup: do you have an adapter, Simple or Mechanic view, your vehicle.

## How safety works (the core design)
1. **Rules decide safety.** A fixed, tested rule engine sets the level from sensor data, codes and the owner's words. Example: coolant at 260 °F → Emergency stop.
2. **Muse Detective only proposes.** It gets a typed **Evidence Ledger** (each fact has an id like `pid:ENGINE_COOLANT_TEMP` or `rule:safety`). Every claim must cite ledger ids. Claims citing ids that aren't in the ledger are withheld as unverified.
3. **The AI can never lower the safety level.** `merge_safety` keeps the rule level if the AI proposes something lower (`detective_lower_ignored`). The AI can only raise it, and only with verified citations.
4. **Fail-closed.** If the AI times out, errors or returns a bad shape, the rule result is returned unchanged. The app also works offline with on-phone rules.
5. **Receipts.** Every AI call records the model, latency, token usage, a prompt hash, and the ledger ids it cited.

Proof in the app: **Try a demo scan → AI vs rules**. No recorded run exists where Muse proposed a lower level, so this uses a **clearly labeled simulated AI answer** ("Simulated AI answer for this test"): the AI says Safe to drive, the rules say Emergency stop, and the app shows that the rules won. Test: `hackathon/server/tests/test_demo.py`.

## Meta models used
| Model | Used for | Code |
|---|---|---|
| `muse-spark-1.3` | Muse Detective (causes, explanations), dash photo, VIN photo, Photo Helper, spoken-question answers | `hackathon/server/lylo_hack/muse.py`, `detective.py`, `vision.py`, `helper.py`, `voice.py` |
| `muse-voice-transcribe-1.0` | Speech-to-text for Ask out loud / Say it instead | `muse.py`, `voice.py` |

Recorded runs with receipts are in [`hackathon/server/evidence/`](hackathon/server/evidence/). For example, `detective_cold_engine_truck_like.json` records a live `muse-spark-1.3` call that took 7.4 s, cited 15 of 19 ledger items and agreed with the rules (Safe to drive, with a cold-engine recheck note).

## Privacy
- LYLO never saves your photos or recordings. They are sent to Meta's model API to be read, then dropped (`stored: false` / `audio_stored: false` in the replies).
- No login or account is needed.
- The app key in the APK is a public rate-limit key, not a secret; the server stores only its SHA-256 digest. Model API keys stay on the server.

## Try it with no car
1. Install the Android test APK (link in [docs/HACKATHON_LOG.md](docs/HACKATHON_LOG.md), latest entry). It's a debug-signed test build: allow "install unknown apps".
2. Open it and tap **Try a demo scan** on Home.
3. Pick a scan:
   - **Chris's truck** (his real readings: cold engine, fuel trim 27.3 %)
   - **Used car with cleared codes** (a built-in demo car)
   - **Overheating at 260 °F** (a made-up test scan)

   Each runs on the LYLO server through the same pipeline as a real scan, and shows the receipt when Muse ran.
4. Tap **AI vs rules: who wins?**

Or run the server yourself (no Meta key needed; Muse stays off and rules still answer):
```bash
cd hackathon/server && pip install -r requirements.txt
LYLO_HACK_REQUIRE_APP_KEY=0 LYLO_HACK_DEMO=1 LYLO_HACK_PORT=5088 python -m lylo_hack.app
curl -s -X POST localhost:5088/api/v1/demo/proof | python -m json.tool
curl -s -X POST localhost:5088/api/v1/demo/replay -H 'Content-Type: application/json' -d '{"case":"overheat"}'
```

## Run the tests
```bash
cd hackathon/server && python -m unittest discover -s tests -q          # server, all AI calls mocked
cd hackathon/mobile-bridge && npm test                                   # phone logic (Node)
cd baseline/mobile && npm ci && npm test                                 # pre-existing engine + parser tests
cd baseline/mobile && npx jest                                           # UI render tests (ui-tests/)
```

## Verify what's new
- The tag `baseline-pre-hackathon` (867eece) is all the code written before the hackathon.
- [NEW_WORK.md](NEW_WORK.md) lists every hackathon file and logs every change to `baseline/`, one file per row.
- `scripts/check-baseline-integrity.sh` fails if any `baseline/` change is missing from that log.
- [docs/HACKATHON_LOG.md](docs/HACKATHON_LOG.md) is the dated build log, including live test costs and timings.

## Limits (honest)
- **Not a mechanic.** It's a scan, not an inspection. Causes are suggestions with confidence levels.
- **Real-phone testing is partial.** The v0.4.4+ screens (dash photo, voice, no adapter, Watch how, nearest store, setup, demo) pass render tests but have not all been tried on a real phone.
- **AI speed varies.** Live answers took 7 s to 34 s in our runs, so the app shows "Still working" on slow calls.
- **No recorded lower AI answer.** In every recorded run the AI agreed with the rules or raised the level. The AI-vs-rules proof uses a labeled simulated answer.
- **Recalls are by model, not by VIN.** Check your exact VIN at nhtsa.gov/recalls.
- **Searches and estimates only.** Store buttons and Watch how open searches: LYLO doesn't check fitment, stock or video quality. Prices are LYLO estimates, not quotes.
- **Muse Detective needs the server.** Offline, only the on-phone rules run.
- **Android only.** There is no iOS build.

