# LYLO Mechanic: 3-minute demo video script (Meta hackathon)

**🎥 CHRIS** = a shot that needs Chris on camera, or his hands, phone, car or voice.
**🖥️ SCREEN** = a screen recording that anyone can capture from the Dell, a browser or the evidence files.
Times are targets; the total is 3:00.

## Before filming (checklist)
- [ ] The roommate's car has a **real, currently active** code. Write down the code and the car's year, make and model. Don't show the plate or the VIN on camera; the app masks the VIN anyway.
- [ ] **OBDLink MX+** is paired with the Android phone (Bluetooth Classic). The app build has `react-native-bluetooth-classic`, so it must be an APK or dev build, not Expo Go. See "Needed from Chris" below.
- [ ] The phone can reach the LYLO server: the APK is built with `EXPO_PUBLIC_LYLO_SERVER_URL` set (use `--clear`). Today the server listens only on 127.0.0.1:5088 on the Dell.
- [ ] On the Dell, `/healthz` shows `muse: on, vision: on, voice: on`.
- [ ] Spare demo-safe takes are in `hackathon/server/evidence/` in case the live call is slow (label them on screen as recorded output).

## Shot list

| Time | Shot | Who | What we see / say |
|---|---|---|---|
| 0:00–0:15 | Hook | 🎥 CHRIS | Chris at the roommate's car, phone in hand: "Used-car sellers clear the check-engine light right before you show up. LYLO catches that, and it shows its evidence." |
| 0:15–0:35 | Plug in the MX+ | 🎥 CHRIS | Close-up of the OBDLink MX+ going into the OBD port (no plate in frame). Phone: LYLO connects and runs a scan. |
| 0:35–0:55 | Scan 1: code active | 🎥 CHRIS + phone screen capture | Results: the Safety check card shows the level, and the Muse Detective card shows ranked causes with confidence. Tap one cause to open its **cited evidence**: the code, the fuel trims and the rule level. Voice-over: "Every claim cites the scan data. If the AI makes something up, it's marked UNVERIFIED." |
| 0:55–1:10 | Clear the code | 🎥 CHRIS | Chris clears the codes (the MX+ app or LYLO's clear function, whichever the build has). The light goes out. "This is what a seller does." |
| 1:10–1:35 | Scan 2: cleared | 🎥 CHRIS + phone screen capture | Rescan. The code list looks clean, but the Detective shows the **red flag**: "Codes were cleared recently…" with km, warm-ups and minutes since the clear, and the readiness monitors incomplete. Tap to show the cited counters (PIDs 30/31/4E). |
| 1:35–1:55 | Photo of the dash | 🎥 CHRIS | Chris photographs the dashboard. If the real car has no lit warning lights, use the synthetic image from the evidence folder and label it "test image" on screen. The response adds `photo:*` evidence marked **lower trust**. A red oil or coolant light raises the safety level. |
| 1:55–2:15 | Voice question | 🎥 CHRIS (voice) + screen | Chris asks out loud: "Is it safe to drive this car home, and should I worry that the codes were cleared?" Show the transcript (Muse Voice Transcribe), then the answer with citations and the safety notice. Today this runs as a server call; the phone mic screen isn't built yet. If it isn't built in time, film it as 🖥️ SCREEN with curl or a small web page. |
| 2:15–2:35 | Receipts | 🖥️ SCREEN | The receipt line in the app, then the evidence JSON: model `muse-spark-1.3`, latency, token usage, prompt hash, cited ledger ids. "We can show exactly what the AI saw and said." |
| 2:35–2:50 | Safety can't be lowered | 🖥️ SCREEN | Terminal: run the overheat test (`test_overheat_emergency_when_muse_on_but_fails`) and the detective test where Muse says SAFE_TO_DRIVE (`detective_lower_ignored`). A 260 °F coolant reading stays EMERGENCY STOP whatever the AI says, and if the AI is down, the rules still answer (offline fallback). |
| 2:50–3:00 | Close | 🎥 CHRIS | "LYLO Mechanic. Evidence first, and the AI can only make it safer." Logo or title card. |

## Lines to keep accurate (don't overclaim)
- Say "Muse **suggests** likely causes", not "diagnoses". The app says it's a scan, not an inspection.
- Photo findings are "what the photo suggests". They are lower trust than sensor data.
- Costs: about 1–2 cents per Detective call, and transcription is $0.18 per hour of audio. Only quote numbers from HACKATHON_LOG.md.

## Backup material already recorded (synthetic or demo data)
- `hackathon/server/evidence/detective_usedcar.json`: recently-cleared red flag on the demo used-car scan.
- `detective_cleared_clean.json`: a "clean" scan whose codes were wiped 6 km ago.
- `vision_usedcar_dash.json`: synthetic dashboard → `photo:oil_pressure:red` etc. → DO_NOT_DRIVE.
- `voice_usedcar_question.json`: robot-voice question → "Do not drive this car home…", with citations.
- `voice_usedcar_question_run1_stale_rule_level.json`: a bug the live run exposed, then fixed. It works as a "we test with receipts" moment.

## Needed from Chris before filming
1. **APK build path for the MX+.** The app uses `react-native-bluetooth-classic`, so it needs a native build. Choose one: a local Gradle build on the Dell (`baseline/mobile/android`, needs the Android SDK and JDK) or EAS Build (needs his Expo account). Then sideload the APK.
2. **OK for a route from the phone to the server.** Either expose lylo-hack on the LAN (bind the Dell's LAN IP, phone on the same Wi-Fi) or add a public tunnel hostname (that changes the Cloudflare tunnel config, which we haven't touched). Then build the APK with that URL.
3. The roommate's permission to film the car and clear the code. Note that clearing codes resets the readiness monitors, which can fail a smog check until they finish.
4. Whether the photo and voice capture screens should be built into the app for the video, or shown as server calls.
