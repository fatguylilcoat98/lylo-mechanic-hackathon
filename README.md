# LYLO Mechanic

**LYLO stands for Love Your Loved Ones.** It's an Android app that reads a car's computer (or, with no adapter, what you tell it) and says in plain words what's going on and whether it's safe to drive. It shows its evidence for every claim.

Built for the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026). Everything new is listed file by file in [NEW_WORK.md](NEW_WORK.md).

**Download (Android):** [lylo-052-93eb955c2a.apk](https://zion.thegoodneighborguard.com/lylo-052-93eb955c2a.apk). v0.5.2, versionCode 15, sha256 `97f1069318f07aa3c6dfd27a55b53235aa2b6be7b9ff0a563b78eb5a2feab61e`. It's a debug-signed test build, so allow "install unknown apps".

## Why
Chris (the builder) borrowed $2,000 for a used car. It looked and drove fine. Two weeks later the check-engine light came on (P0300, misfire). He replaced the coil pack and cleared the code, and two days later it was back. Three weeks after that the transmission failed, stuck in reverse. The seller had a shop and most likely cleared the codes before the sale. Chris had no proof. LYLO is meant to give buyers and drivers that proof.

## What it does
**With an OBD adapter:** the code supports OBDLink LX and MX+ (Bluetooth Classic, Android) and CX (BLE). Tested on a real vehicle (Chris's 1998 Ford E-450): **LX** (Nov 2, full scan, see below) and **MX+** (Oct 28, v0.5.0). The **CX has not been tested on a real car.**
- Scans codes, live readings and the emissions self-tests ("readiness monitors").
- **Used-Car Check:** flags recently cleared codes, using miles since clear, warm-ups since clear, engine time since clear and unfinished monitors.
- **Safety level** from fixed rules, in six steps from "Safe to drive" up to "Stop now".
- **Muse Detective** (Meta Muse Spark): ranked likely causes, each citing the scan facts it uses. Simple view for drivers, Mechanic view for the evidence.
- **Snap the dash** (warning lights from a photo) and **Ask out loud** (a spoken question, answered from the scan).

**Without an adapter:**
- Describe the problem (typed or spoken) or type a trouble code. The phone has **9,415 generic trouble-code names offline**, from [Wal33D/dtc-database](https://github.com/Wal33D/dtc-database) (MIT license, thank you). The server can add the same titles, labeled as reference text, not evidence of which part failed.
- **Ask out loud** asks for the mic inside the app when you tap it, with an "Open settings" button if you denied it before.
- The same safety rules run on the phone first. The app says up front that it's less accurate without live sensor data.
- **VIN lookup** (typed or photo) through NHTSA's free database, with **recalls for your model** (by year, make and model, not your exact VIN).
- **Photo Helper:** take a photo and LYLO circles the part (for example the air filter) on your own photo.
- **Price help:** LYLO's own DIY, shop and dealer estimate ranges; buttons that open AutoZone, O'Reilly, Advance, NAPA and RockAuto searches; **Find nearest store** (opens Google Maps; LYLO asks for no location permission); **Watch how** (a YouTube search for videos for your model).
- **Try a demo scan:** no car needed (see below).
- First-run setup: do you have an adapter, Simple or Mechanic view, your vehicle.

## Real-car test (Nov 2, 2026)
Chris scanned his 1998 Ford E-450 (6.8L V10 gas) with an OBDLink LX. It worked end to end: VIN decoded, 2 recalls for the model, **Good to drive**, and Muse Detective (`muse-spark-1.3`) answered in about 7.1 s. What he saw led to the v0.5.2 fixes:
- The proof header showed a raw `\u00B7` code instead of a dot. Fixed, and a test now blocks that kind of escape.
- The evidence counts now say they are the evidence behind the AI's guesses.
- Clearer fuel-trim wording: the engine computer is adding extra fuel because the engine reads a little lean.
- Ask out loud: the mic permission was missing from the build. The app now asks for it in-app, and a build check fails any APK without it.
- The phone waits 45 s instead of 20 s, so a slow AI answer still returns the rules' safety result.
- Offline trouble-code names (above).

Full details: [docs/HACKATHON_LOG.md](docs/HACKATHON_LOG.md), v0.5.2 entry.

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

## Try it in 2 minutes
No car, no adapter and no Meta key needed.
1. **Android phone:** download the [v0.5.2 APK](https://zion.thegoodneighborguard.com/lylo-052-93eb955c2a.apk), allow "install unknown apps", and open it. It's a debug-signed test build.
2. Answer the 3 setup questions or skip them. Tap **Try a demo scan** and pick **Chris's truck**.
3. Flip to **Mechanic view** to see Muse Detective's causes, each citing its evidence, and the receipt (model, seconds, items cited).
4. Tap **AI vs rules: who wins?** A simulated AI answer says "safe to drive" at 260 °F. The rules say stop, and the rules win.
5. **No phone?** Run the server (below, under "Try it with no car") and `curl` the demo routes. Then run the tests (see "Run the tests").

## Try it with no car
1. Install the [v0.5.2 APK](https://zion.thegoodneighborguard.com/lylo-052-93eb955c2a.apk). It's a debug-signed test build: allow "install unknown apps".
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
- **Real-phone testing is partial.** Used on Chris's real phone, per the build log: the adapter scan with the LX (and earlier the MX+), the result and proof screens, and VIN lookup and recalls. Not yet recorded on a real phone: Ask out loud (its mic permission was missing from the build on Chris's phone; fixed in v0.5.2, not yet confirmed on a phone), dash photo, Photo Helper, Say it instead, Watch how, Find nearest store, the setup flow and Try a demo scan. Those pass render tests only.
- **Point and prove trusts the phone's readings.** The server checks the readings the phone sends as if they were measured, and it can't tell whether a reading was faked. Anyone who has a prove session id can submit readings for that session. The session lives in memory and expires, but treat the id like a password. The ledger is hash-chained and its head is anchored on the server, so an edited or cut-off history is detected.
- **AI speed varies.** Live answers took 7 s to 34 s in our runs, so the app shows "Still working" on slow calls.
- **No recorded lower AI answer.** In every recorded run the AI agreed with the rules or raised the level. The AI-vs-rules proof uses a labeled simulated answer.
- **Recalls are by model, not by VIN.** Check your exact VIN at nhtsa.gov/recalls.
- **Searches and estimates only.** Store buttons and Watch how open searches: LYLO doesn't check fitment, stock or video quality. Prices are LYLO estimates, not quotes.
- **Muse Detective needs the server.** Offline, only the on-phone rules run.
- **Android only.** There is no iOS build.

