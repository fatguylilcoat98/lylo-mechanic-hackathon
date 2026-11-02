/*
 * LYLO Mechanic v0.6: Crash Guard logic (pure CommonJS, tested in Node). Flag EXPO_PUBLIC_LYLO_CRASH_GUARD=1.
 * OFF by default and OFF every new drive: the driver turns it on. NOT a replacement for 911, OnStar or any
 * emergency service. It can miss crashes and can fire when there was none.
 *
 * Trigger A (phone accelerometer, expo-sensors, readings in g):
 *   1. impact: |a| >= IMPACT_G (4.0 g) in one reading, and
 *   2. NOT a phone drop: no free-fall (|a| < FREEFALL_G 0.35 g) lasting >= FREEFALL_MS (120 ms) in the 1.5 s before it, and
 *   3. stillness after: for STILL_MS (8 s) after the impact, every reading within STILL_TOL_G (0.15 g) of 1 g
 *      (phone at rest; a phone that is picked up and handled fails this), and
 *   4. if GPS speed is available: moving >= MOVING_MPH (15 mph) in the 10 s before impact.
 * Trigger B (GPS speed, expo-location, ~1 Hz): speed falls from >= 30 mph to <= 2 mph within 2 s (>= ~0.68 g average,
 *   harder than almost any normal stop), then stays <= 2 mph for STILL_MS.
 * Both then go to the same prompt: "Are you okay?" 30 s, a second 30 s prompt, then the alert. "I'm OK" works any time.
 * All numbers are first guesses for a hackathon build, NOT validated on real crashes.
 */
'use strict';

const T = {
  IMPACT_G: 4.0, FREEFALL_G: 0.35, FREEFALL_MS: 120, PRE_WINDOW_MS: 1500, STILL_MS: 8000, STILL_TOL_G: 0.15,
  MOVING_MPH: 15, MOVING_WINDOW_MS: 10000, GPS_FROM_MPH: 30, GPS_TO_MPH: 2, GPS_DROP_MS: 2000,
  PROMPT_MS: 30000, PROMPTS: 2,
};
const NOT_911 = 'Crash Guard is NOT a replacement for 911, OnStar or any emergency service. It can miss a crash, and it can go off when there was none. If you are hurt, call 911.';
const MAX_CONTACTS = 5;

function flagOn(v) { return String(v || '').trim() === '1'; }
function features(env) {
  let v; try { v = env ? env.EXPO_PUBLIC_LYLO_CRASH_GUARD : process.env.EXPO_PUBLIC_LYLO_CRASH_GUARD; } catch (e) { v = undefined; }
  return { on: flagOn(v) };
}

const mag = (r) => Math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z);

/**
 * Detector. feedAccel({t,x,y,z}) / feedSpeed({t, mph}) return null or an event:
 *  {type:'candidate', source} at impact (not yet a crash), then {type:'crash', source, peakG} after stillness,
 *  or {type:'dismissed', reason} if the stillness check fails.
 */
function createDetector(opts) {
  const th = Object.assign({}, T, opts || {});
  const acc = []; // recent readings {t, g}
  const spd = []; // recent {t, mph}
  let cand = null; // {t, source, peakG}

  function movingBefore(t) {
    const recent = spd.filter((s) => s.t >= t - th.MOVING_WINDOW_MS && s.t <= t);
    if (!recent.length) return null; // unknown: no GPS
    return recent.some((s) => s.mph >= th.MOVING_MPH);
  }
  function freeFallBefore(t) {
    let run = 0; let start = null;
    for (const r of acc) {
      if (r.t < t - th.PRE_WINDOW_MS || r.t >= t) continue;
      if (r.g < th.FREEFALL_G) { if (start === null) start = r.t; run = r.t - start; if (run >= th.FREEFALL_MS) return true; } else start = null;
    }
    return false;
  }
  function checkStill(t, still) {
    if (!cand) return null;
    if (!still) { const c = cand; cand = null; return { type: 'dismissed', reason: 'movement after the bump', source: c.source }; }
    if (t - cand.t >= th.STILL_MS) { const c = cand; cand = null; return { type: 'crash', source: c.source, peakG: c.peakG, at: c.t }; }
    return null;
  }
  return {
    thresholds: th,
    feedAccel(r) {
      const g = mag(r);
      acc.push({ t: r.t, g });
      while (acc.length && acc[0].t < r.t - th.PRE_WINDOW_MS - 100) acc.shift();
      if (cand) {
        if (r.t - cand.t < 500) { if (cand.source === 'accel') cand.peakG = Math.max(cand.peakG, g); return null; } // ringing right after impact
        return checkStill(r.t, Math.abs(g - 1) <= th.STILL_TOL_G);
      }
      if (g >= th.IMPACT_G) {
        if (freeFallBefore(r.t)) return { type: 'dismissed', reason: 'looks like the phone was dropped', source: 'accel' };
        if (movingBefore(r.t) === false) return { type: 'dismissed', reason: 'car was not moving', source: 'accel' };
        cand = { t: r.t, source: 'accel', peakG: g };
        return { type: 'candidate', source: 'accel' };
      }
      return null;
    },
    feedSpeed(s) {
      spd.push(s);
      while (spd.length && spd[0].t < s.t - th.MOVING_WINDOW_MS - 1000) spd.shift();
      if (cand && cand.source === 'gps') return checkStill(s.t, s.mph <= th.GPS_TO_MPH);
      if (cand) return null;
      if (s.mph <= th.GPS_TO_MPH && spd.some((p) => p.t >= s.t - th.GPS_DROP_MS && p.t < s.t && p.mph >= th.GPS_FROM_MPH)) {
        cand = { t: s.t, source: 'gps', peakG: null };
        return { type: 'candidate', source: 'gps' };
      }
      return null;
    },
    pending() { return !!cand; },
    reset() { acc.length = 0; spd.length = 0; cand = null; },
  };
}

/** Prompt state: elapsed ms since the crash -> what to show. */
function promptState(elapsedMs, th) {
  const t = Object.assign({}, T, th || {});
  const total = t.PROMPT_MS * t.PROMPTS;
  if (elapsedMs >= total) return { phase: 'alert', prompt: t.PROMPTS, secondsLeft: 0 };
  const prompt = Math.floor(elapsedMs / t.PROMPT_MS) + 1;
  return { phase: 'asking', prompt, secondsLeft: Math.ceil((prompt * t.PROMPT_MS - elapsedMs) / 1000),
    text: prompt === 1 ? 'Are you okay?' : 'Last check: are you okay? We will alert your emergency contacts.' };
}

function cleanContacts(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach((c) => {
    if (!c) return;
    const name = String(c.name || '').trim().slice(0, 40);
    const email = String(c.email || '').trim().slice(0, 120);
    const phone = String(c.phone || '').replace(/[^\d+]/g, '').slice(0, 16);
    const okEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
    const okPhone = /^\+?\d{10,15}$/.test(phone);
    if (okEmail || okPhone) out.push({ name: name || 'Contact', email: okEmail ? email : '', phone: okPhone ? phone : '' });
  });
  return out.slice(0, MAX_CONTACTS);
}

const mapsUrl = (loc) => (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon)
  ? `https://maps.google.com/?q=${loc.lat.toFixed(5)},${loc.lon.toFixed(5)}` : null);

/** Fixed alert text (no free text from the phone goes into it). */
function alertMessage({ userName, loc, at, test }) {
  const who = String(userName || 'A LYLO Mechanic user').slice(0, 40);
  const when = new Date(at || Date.now()).toLocaleString('en-US', { timeZoneName: 'short' });
  const where = mapsUrl(loc);
  return [
    test ? '[TEST ONLY - no crash happened] ' : '',
    `${who}'s phone may have detected a car crash at ${when} and they did not answer "Are you okay?" for 60 seconds.`,
    where ? ` Last known location${loc.accuracyM ? ` (within about ${Math.round(loc.accuracyM)} m)` : ''}: ${where}` : ' Location was not available.',
    ' Please try to reach them. If you cannot, call 911 and give this location.',
    ' Sent by LYLO Mechanic Crash Guard. It can be wrong; it is not an emergency service.',
  ].join('');
}

module.exports = { T, NOT_911, MAX_CONTACTS, features, createDetector, promptState, cleanContacts, alertMessage, mapsUrl, mag };
