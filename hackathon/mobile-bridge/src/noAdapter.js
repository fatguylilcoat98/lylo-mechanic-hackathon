/*
 * LYLO Mechanic hackathon (v0.4.5): "No adapter? Start here" — everything that works without an OBD adapter.
 * Pure CommonJS (no React Native), tested in Node.
 *
 * Flag (build time): EXPO_PUBLIC_LYLO_NO_ADAPTER=1 shows the Home entry and screen. Unset = Home is as before.
 * The offline parts (safety rules on your words, typed-code meanings, price links) need no server.
 * "Check with Meta AI" needs EXPO_PUBLIC_LYLO_SERVER_URL and the server flag LYLO_HACK_NO_ADAPTER=1.
 *
 * Safety: the same fixed rules as the server (hackathon/server/lylo_hack/symptoms.py) run on the phone first;
 * the server reply can only RAISE the level shown, never lower it. With no sensor data we never say "safe to drive".
 */
'use strict';

const { ORDER, higher, errorFor, MSG: DV_MSG } = require('./dashVoice');
const { LEVELS } = require('./diagnosisView');

const CHECK_TIMEOUT_MS = 50000;
const BASE_LEVEL = 'INSPECT_SOON';
const NO_SENSOR_NOTE = 'No adapter: there is no live sensor data, so this is based only on what you told us (and any photo or code you added). Confidence is lower than a scan with an OBD adapter.';
const CODE_RE = /^[PCBU][0-3][0-9A-F]{3}$/;

// Keep in sync with symptoms.py RULES (same ids, floors, and test sentences).
const RULES = [
  ['fire', /\b(fire|flames?|on fire)\b/i, 'EMERGENCY_STOP_IMMEDIATELY', 'Fire or flames: stop, turn the engine off, get everyone out and away.'],
  ['smoke', /\bsmok(e|es|ing|y)\b/i, 'DO_NOT_DRIVE', 'Smoke reported.'],
  ['steam', /\b(steam|steaming)\b/i, 'DO_NOT_DRIVE', 'Steam from the engine: possible overheating.'],
  ['burning_smell', /\bburn(ing|t)?\b.{0,20}\bsmell|\bsmell.{0,20}\bburn(ing|t)?\b/i, 'DO_NOT_DRIVE', 'Burning smell.'],
  ['fuel_smell', /\b(gas|fuel|gasoline)\b.{0,15}\b(smell|leak)|\bsmell.{0,15}\b(gas|fuel)\b/i, 'DO_NOT_DRIVE', 'Fuel smell or leak: fire risk.'],
  ['brake_grind', /\bgrind\w*.{0,25}\bbrak\w*|\bbrak\w*.{0,25}\bgrind\w*/i, 'DO_NOT_DRIVE', 'Grinding brakes.'],
  ['brake_soft', /\bbrak\w*.{0,30}\b(soft|spongy|to the floor|sinks?|fail\w*|not work\w*|won.?t stop)\b|\bpedal.{0,20}\b(floor|spongy|soft)\b/i, 'DO_NOT_DRIVE', 'Brakes soft, sinking or failing.'],
  ['brake_light', /\b(red\s+)?brake\s+(warning\s+)?light\b/i, 'DO_NOT_DRIVE', 'Brake warning light.'],
  ['oil_light', /\boil\s+(pressure\s+)?(warning\s+)?light\b|\boil\s+can\s+light\b/i, 'DO_NOT_DRIVE', 'Oil pressure light: possible loss of oil pressure.'],
  ['overheat', /\boverheat\w*|\b(temp|temperature)\b.{0,25}\b(high|hot|red|light)\b|\bgauge.{0,20}\b(hot|red|h\b)|\bcoolant\s+(warning\s+)?light\b/i, 'DO_NOT_DRIVE', 'Overheating or hot temperature gauge/light.'],
  ['steering', /\bsteering\b.{0,25}\b(lock\w*|stuck|hard|heavy|loose|failed|gone)\b/i, 'DO_NOT_DRIVE', 'Steering problem.'],
  ['flashing_cel', /\b(flash\w*|blink\w*)\b.{0,25}\b(check\s+engine|engine\s+light|cel)\b|\b(check\s+engine|engine\s+light|cel)\b.{0,25}\b(flash\w*|blink\w*)\b/i, 'DO_NOT_DRIVE', 'Flashing check-engine light: a bad misfire can damage the engine.'],
  ['wheel_wobble', /\b(wheel|tire)\b.{0,25}\b(wobbl\w*|loose|falling off)\b/i, 'DO_NOT_DRIVE', 'Wheel or tire loose or wobbling.'],
  ['check_engine', /\bcheck\s+engine\b|\bengine\s+light\b|\bcel\b/i, 'INSPECT_SOON', 'Check-engine light on.'],
];
const NEG = /\b(no|not|never|without|isn.?t|aren.?t|don.?t|doesn.?t)\s+(any\s+|a\s+)?$/i;

function flagOn(v) { return String(v || '').trim() === '1'; }

function features(env) {
  let on; let url;
  if (env) { on = env.EXPO_PUBLIC_LYLO_NO_ADAPTER; url = env.EXPO_PUBLIC_LYLO_SERVER_URL; } else {
    try { on = process.env.EXPO_PUBLIC_LYLO_NO_ADAPTER; } catch (e) { on = undefined; }
    try { url = process.env.EXPO_PUBLIC_LYLO_SERVER_URL; } catch (e) { url = undefined; }
  }
  return { on: flagOn(on), server: flagOn(on) && !!String(url || '').trim() };
}

/** Fixed safety rules on the owner's words (offline). */
function matchRules(text) {
  const t = String(text || '').slice(0, 1000);
  let hits = [];
  RULES.forEach(([id, rx, floor, reason]) => {
    const g = new RegExp(rx.source, 'gi');
    let m;
    while ((m = g.exec(t))) {
      const before = t.slice(Math.max(0, m.index - 20), m.index);
      if (!NEG.test(before)) { hits.push({ id, floor, reason }); break; }
      if (m[0].length === 0) g.lastIndex += 1;
    }
  });
  if (hits.some((h) => h.id === 'flashing_cel')) hits = hits.filter((h) => h.id !== 'check_engine');
  return hits;
}

function localLevel(text) {
  return matchRules(text).reduce((lv, h) => higher(lv, h.floor), BASE_LEVEL);
}

function parseCodes(raw) {
  const good = []; const bad = [];
  String(raw || '').split(/[\s,;]+/).forEach((v) => {
    const c = v.trim().toUpperCase();
    if (!c) return;
    if (CODE_RE.test(c)) { if (good.indexOf(c) < 0) good.push(c); } else bad.push(c);
  });
  return { good: good.slice(0, 10), bad: bad.slice(0, 10) };
}

/** Offline code library urgency ('DO NOT DRIVE' etc.) -> a floor. Never below INSPECT_SOON without sensor data. */
function codeFloor(urgency) {
  const u = String((urgency && urgency.level) || urgency || '').toUpperCase();
  return u === 'DO NOT DRIVE' ? 'DO_NOT_DRIVE' : BASE_LEVEL;
}

const label = (lv) => (LEVELS[lv] ? LEVELS[lv].label : String(lv || '').replace(/_/g, ' ').toLowerCase());

/** POST /api/v1/noadapter/check (multipart: text, codes, year/make/model, optional audio, photo_evidence). */
async function requestCheck({ baseUrl, appKey, fetchImpl, text, codes, vehicle, audio, photoEvidence, timeoutMs = CHECK_TIMEOUT_MS }) {
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!baseUrl || !f) return { ok: false, error: MSG.offline, offline: true };
  const form = new FormData();
  if (text) form.append('text', String(text).slice(0, 1000));
  if (codes && codes.length) form.append('codes', codes.join(','));
  const v = vehicle || {};
  ['year', 'make', 'model'].forEach((k) => { if (v[k]) form.append(k, String(v[k])); });
  if (Array.isArray(photoEvidence) && photoEvidence.length) form.append('photo_evidence', JSON.stringify(photoEvidence));
  if (audio) form.append('audio', { uri: audio.uri, type: audio.type || 'audio/aac', name: audio.name || 'symptoms.aac' });
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => { rej(new Error('timeout')); if (ctrl) ctrl.abort(); }, timeoutMs); });
  try {
    const r = await Promise.race([f(baseUrl.replace(/\/$/, '') + '/api/v1/noadapter/check', {
      method: 'POST', body: form, headers: appKey ? { 'X-LYLO-App-Key': appKey } : {}, signal: ctrl ? ctrl.signal : undefined,
    }), timeout]);
    let body = null;
    try { body = await r.json(); } catch (e) { body = null; }
    if (!r.ok || !body || typeof body !== 'object') return { ok: false, status: r.status, error: errorFor(r.status || 0, body), body };
    return { ok: true, status: r.status, body };
  } catch (e) {
    const to = e && e.message === 'timeout';
    return { ok: false, error: to ? MSG.timeout : MSG.offline, timeout: to };
  } finally { clearTimeout(timer); }
}

/** Server reply -> card. The level shown is never lower than the phone's own rule level. */
function checkView(res, localLv) {
  const base = localLv || BASE_LEVEL;
  if (!res || !res.ok) return { ok: false, message: (res && res.error) || MSG.offline, level: base };
  const b = res.body;
  const level = higher(base, b.final_safety_level);
  const a = b.answer || null;
  const verified = !!(a && a.text && a.status === 'verified');
  const rec = b.receipt || {};
  return {
    ok: true,
    level,
    levelText: label(level),
    transcript: b.transcript || null,
    reasons: (Array.isArray(b.symptom_matches) ? b.symptom_matches : []).map((h) => h.reason).filter(Boolean),
    answer: verified ? a.text : null,
    withheldText: verified ? null : (String(b.answer_status || '').startsWith('skipped') ? null
      : 'Meta AI could not back up an answer with what you told us, so it is not shown.'),
    followUps: (Array.isArray(b.follow_up_checks) ? b.follow_up_checks : []).filter((x) => x && x.text).map((x) => x.text),
    unverified: Array.isArray(b.unverified_claims) ? b.unverified_claims.length : 0,
    confidenceNote: b.confidence_note || NO_SENSOR_NOTE,
    invalidCodes: Array.isArray(b.invalid_codes) ? b.invalid_codes : [],
    receipt: rec.model ? `${rec.model} \u00B7 ${(Number(rec.latency_ms || 0) / 1000).toFixed(1)} s \u00B7 audio not stored` : null,
  };
}

const MSG = {
  offline: 'Could not reach the LYLO server. The safety check above is from LYLO\'s built-in rules and still stands.',
  timeout: 'Meta AI took too long to answer. The safety check above still stands. Try again in a minute.',
  empty: 'Tell us what is happening, or type a trouble code.',
  micDenied: DV_MSG.micDenied,
  noMic: DV_MSG.noMic,
};

// OBDLink facts checked on obdlink.com on 2026-10-28 (pages returned HTTP 200). No prices, no affiliate links.
const OBDLINK = {
  title: 'Want a deeper check? Add an OBDLink adapter',
  worksWithout: 'LYLO works without an adapter. Everything on this screen is free to use without one.',
  gets: [
    'Live sensor data from your engine (temperatures, fuel trims and more)',
    'Spots codes that were recently cleared (useful when buying a used car)',
    'A more confident diagnosis, because it is based on readings, not just a description',
  ],
  models: [
    { name: 'OBDLink CX', kind: 'Bluetooth LE', facts: 'Bluetooth 5.1 BLE. Pairs in the app with iPhone and Android.', url: 'https://www.obdlink.com/products/obdlink-cx/' },
    { name: 'OBDLink MX+', kind: 'Bluetooth', facts: 'Works with iPhone, iPad and Android. Reads and clears the check-engine light. Works with 1996+ cars and light trucks sold in the US.', url: 'https://www.obdlink.com/products/obdlink-mxp/' },
    { name: 'OBDLink EX', kind: 'Wired (USB)', facts: 'USB cable for Android and Windows. Made for FORScan and Ford vehicles.', url: 'https://www.obdlink.com/products/obdlink-ex/' },
  ],
  appNote: 'The LYLO app connects to OBDLink CX and MX+ over Bluetooth. A wired adapter is not supported by this app yet.',
  disclaimer: 'Information from obdlink.com. LYLO is not paid for this suggestion. Check the OBDLink site for current prices and which phones it supports.',
  allUrl: 'https://www.obdlink.com/products/',
};

module.exports = { ORDER, BASE_LEVEL, NO_SENSOR_NOTE, RULES, MSG, OBDLINK, CHECK_TIMEOUT_MS, features, matchRules, codeFloor, localLevel, parseCodes, requestCheck, checkView, label };
