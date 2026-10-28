# LYLO demo script (v2, v0.4.7)

Replaces the old v0.3-era script, which said the phone voice screen wasn't built and the server ran only on 127.0.0.1. Both are out of date: Ask out loud is built (flag EXPO_PUBLIC_LYLO_VOICE_ASK) and the server is live at https://lylo-api.thegoodneighborguard.com.


Chris's story, voice and timing, with every claim matched to what the app does (v0.4.7, local commits, not pushed yet).

**Truck numbers = the real recorded live run only:** `hackathon/server/evidence/detective_cold_engine_truck_like.json`. It is Chris's truck readings (STFT 27.3 %, LTFT 6.3 %, coolant 79 °F, 984 rpm, no codes) sent through the live server with `muse-spark-1.3`: **7.4 s (7429 ms), 15 of 19 ledger items cited, rules SAFE_TO_DRIVE, Muse agreed**, plus the cold-engine note. Three causes: engine still cold (medium); early lean tendency, such as a small air leak or weak fuel delivery (low); no current fault (medium).
- The synthetic `test/fixtures/truck.json` (7.1 s, INSPECT_SOON) is NOT quoted anywhere.
- If you film the in-app **Try a demo scan → Chris's truck**, that is a NEW live run, so its seconds, count and wording may differ. **Read the numbers off the screen you film** and say "replayed from my truck's readings".

---

**[0:00 – 0:40] THE STORY**
"Six months ago, I didn't have a car. My boss loaned me two thousand dollars to buy a used car.

We went and looked at it. It looked great. Drove fine on the test drive. So I bought it.

Drove it for a couple weeks, check engine light comes on. P0300, misfire. I replaced the coil pack, cleared it, two days later it's back.

Then three weeks later, the transmission goes out and it's stuck in reverse.

I'm out $2,000. And the guy I bought it from had a shop. Most likely cleared the codes. I had no proof.

I built LYLO so you do have proof. LYLO stands for Love Your Loved Ones. This is LYLO Mechanic."

**[0:40 – 1:10] THE SCAN: Simple vs Mechanic view**
"Plug in an OBDLink. It scans your car and tells you in plain words what's going on and whether it's safe to drive.

Here's my truck. Simple view, for regular people: safe to drive, but the engine was cold, so recheck the readings when it's warm.

Flip to Mechanic view and Muse Detective shows you why. Short-term fuel trim 27.3 percent, long-term 6.3, coolant 79 degrees, idling at 984 rpm, no trouble codes. It ranks three causes: the engine was still cold, medium confidence. An early lean tendency, like a small air leak or weak fuel delivery, low. Or no current fault at all, medium. Every claim cites its evidence.

And here's the rule that matters: AI can only raise the safety level, never lower it. Watch: in this test, a simulated AI answer says 'safe to drive' on an engine at 260 degrees. The rules say stop now, and the rules win. If the AI fails, the app still works. Here's the receipt from my truck: muse-spark-1.3, 7.4 seconds, 15 evidence items cited."

**[1:10 – 1:35] USED-CAR CHECK + VIN + RECALLS**
"This is the Used-Car Check. This is what would have saved me.

It shows the trouble codes, and it also shows if codes were recently cleared: miles since cleared, warm-ups, engine hours. If those numbers are low and the emissions monitors aren't ready, someone probably wiped it to sell it.

Type your VIN or take a photo of it. LYLO looks it up in the government's free NHTSA database, tells you your exact vehicle, and shows recalls for your model."

**[1:35 – 2:10] PRICE + DIY + NEAREST PARTS STORE**
"If there is a problem, LYLO doesn't just tell you what's wrong. It tells you what it should cost: DIY, shop and dealer price ranges. So you walk in with a number in your head, not a guess.

And if it's simple, like an air filter (you know the oil change place wants $35 for a $10 filter), you say no. Take a picture of your engine bay. LYLO circles it on your own photo, showing where the filter is and where the clips are. Tap 'Watch how' for videos for your model.

Then tap a store button and you land on AutoZone, O'Reilly or NAPA with the part already searched, so you can check the price and whether it's in stock. Tap 'Find nearest store' and Google Maps shows the ones around you."

**[2:10 – 2:35] NO ADAPTER MODE + SNAP THE DASH + ASK OUT LOUD + SETUP**
"Don't have an adapter? Use No Adapter mode. It still works, it's just less accurate without live sensor data, and LYLO tells you that up front.

You can snap the dash: it reads the warning lights and whether the temperature gauge is hot. You can ask out loud, 'Can I drive this to work?', and it answers from your scan. LYLO never saves your photos or recordings.

When you first open it, setup asks three things: Do you have an adapter? Simple view or Mechanic view? What's your vehicle? That's it. It remembers."

**[2:35 – 3:00] CLOSE**
"I lost $2,000 because I had no proof. Three weeks later I'm stuck in reverse.

Now you plug in, scan, and in 60 seconds [TIME THIS ON THE TRUCK FIRST] in the seller's driveway you have proof.

Don't get scammed buying a car. Don't get upsold at the shop. Don't guess if it's safe to drive.

That's LYLO Mechanic. Love Your Loved Ones."

---

## What changed from v1, and why
- **Truck numbers:** these come from the real recorded live run (7.4 s, 15 of 19 cited, SAFE_TO_DRIVE, 3 causes). v1's "4 causes, 7.1 s, 11 items" and "Get it inspected soon" didn't match any real run. Also "0 mph" became "idling at 984 rpm". (Note: the brief said "12 items cited"; the evidence file has 15 `cited_ledger_ids` of 19.)
- **AI vs rules:** this beat is new and is shown in-app with a labeled **simulated** AI answer. No recorded run exists where Muse said something safer than the rules. Keep the on-screen label visible.
- **"Muse fails" became "the AI fails":** the rule covers every AI step.
- **Recalls:** "open recalls on your exact car" became "recalls for your model". NHTSA recalls are looked up by year, make and model, not by your VIN.
- **Photo Helper:** "AI picture of your engine bay" became "circles it on your own photo". LYLO marks the user's real photo; it doesn't generate one.
- **YouTube:** became "videos for your model". The Watch how button runs a YouTube search for year, make, model and the part. It's a search, so it doesn't pick one exact video.
- **Find nearest store:** it opens Google Maps, while the store buttons do the part search. v1 merged the two.
- **"Never stored":** became "LYLO never saves your photos or recordings". Photos and audio are sent to Meta AI to be read; LYLO doesn't keep them.
- **"Less accurate":** "less accurate up front" is now true, since v0.4.6 shows that note before the first check.
- **Setup:** first-run setup is new in v0.4.6. It only runs in a build with `EXPO_PUBLIC_LYLO_FIRST_RUN=1`.

## Shots to film (in this order)
1. **Plug-in shot:** the OBDLink going into the truck's port.
2. **Scan result in Simple view:** "Safe to drive" with the cold-engine recheck note (that is what the real truck run returned).
3. **Flip to Mechanic view:** the 27.3 / 6.3 / 79 °F / 984 rpm readings, the 3 causes, and the receipt line (model, seconds, evidence count). Hold on the receipt for 2 s. Read the numbers off this screen.
3b. **Try a demo scan → AI vs rules:** the yellow "Simulated AI answer for this test" label, the three verdict boxes, "Rules won". Keep the label in frame.
4. **Used-Car Check:** miles since cleared, warm-ups, engine hours, monitors.
5. **VIN:** type it or photo it. Show the decoded vehicle and the "recalls for your model" line.
6. **Price card:** the DIY, shop and dealer ranges.
7. **Photo Helper (air filter):** take the engine bay photo and show the circles on it.
8. **Watch how:** tap it and the YouTube results open.
9. **Store buttons, then Find nearest store:** an AutoZone search page, then Maps with stores nearby.
10. **No Adapter screen:** show the less-accurate note at the top.
11. **Snap the dash, then Ask out loud:** record these ahead of time, because live answers took 20–34 s today. Cut the wait in editing.
12. **Fresh install:** the 3 setup questions.
13. **Stopwatch shot:** a full scan in the driveway, timed. This sets the "60 seconds" line.

## Before filming
- Build the APK with `EXPO_PUBLIC_LYLO_FIRST_RUN=1`, `EXPO_PUBLIC_LYLO_NO_ADAPTER=1`, `EXPO_PUBLIC_LYLO_DASH_PHOTO=1` and `EXPO_PUBLIC_LYLO_VOICE_ASK=1`, plus the server URL. Otherwise setup, No Adapter, dash and voice won't appear.
- Add `EXPO_PUBLIC_LYLO_DEMO=1` for Try a demo scan. The test APK in docs/HACKATHON_LOG.md has every flag on.
- None of v0.4.6 or v0.4.7 has been tested on a real phone yet: the YouTube and Maps hand-off, and setup on a fresh install.
