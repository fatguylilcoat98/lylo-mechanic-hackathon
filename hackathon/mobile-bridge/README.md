# hackathon/mobile-bridge

Hackathon-built code only (Oct 26 – Nov 4, 2026). Plain CommonJS with no React Native imports, so it runs in Node tests and in the Expo app.

- `src/scanToLive.js` turns a baseline `runFullScan()` result into the `/api/v1/live/live` payload: exact backend PID names, stored/pending/permanent codes de-duplicated, codes-cleared derived from the clear counters (with the evidence listed), and VIN plus user-entered model and odometer.
- `src/uploadClient.js` (`diagnoseScan`) posts it with a hard timeout (20 s by default). If there's no server, a network error, a timeout, a 4xx/5xx, or a reply without a safety level, it falls back to the existing on-phone engine (`baseline/mobile/src/engine/diagnose.js`), and the result says `source: 'offline'` and why.

```bash
cd hackathon/mobile-bridge && npm test    # node --test, 14 tests
```

Not done yet: wiring `diagnoseScan` into the app's scan screen (that's a logged baseline change), and pointing it at the Dell.

## v0.4.4: Snap the dash + Ask out loud
`src/dashVoice.js` + `src/DashVoicePanel.js` (rendered by SimpleResults). Build flags `EXPO_PUBLIC_LYLO_DASH_PHOTO=1`, `EXPO_PUBLIC_LYLO_VOICE_ASK=1`; unset = nothing rendered or sent.

- v0.4.8: `EXPO_PUBLIC_LYLO_ENGINE_OVERRIDE=1` shows "Not my engine?" on Your car and sends the owner-set engine (server flag `LYLO_HACK_ENGINE_OVERRIDE=1`).
