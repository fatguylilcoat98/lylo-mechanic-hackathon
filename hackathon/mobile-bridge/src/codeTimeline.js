/*
 * LYLO Mechanic v0.7: code timeline (flag EXPO_PUBLIC_LYLO_CODE_TIMELINE=1). Pure CommonJS.
 * Cars do NOT store dates for trouble codes. Dates here are when LYLO saw a code on THIS phone.
 * History lives only on the phone under the NEW AsyncStorage key 'lylo.codeTimeline'
 * (storage injected; nothing is sent to the server). Vehicles are keyed by a local hash of the VIN.
 */
'use strict';

const KEY = 'lylo.codeTimeline';
const MAX_VEHICLES = 10;
const MAX_CODES = 200;
const KM_TO_MI = 0.621371;
const HONEST_NOTE = "Your car doesn't record dates for trouble codes. The dates below are when LYLO saw each code on this phone.";
const KIND_LABEL = {
  stored: 'Stored code',
  stored_lit: 'Stored, check-engine light on',
  pending: 'Pending, not lit yet',
  permanent: 'Permanent, survives a clear',
};
const KIND_LABEL_V2 = { // v0.7.3: the light status comes from Mode 01 PID 01, not from the code kind
  stored: 'Stored (confirmed)', stored_lit: 'Stored (confirmed)',
  pending: 'Pending (seen this or last drive cycle)', permanent: 'Permanent (a scan tool cannot erase it)',
};
const NOT_REPORTED = 'Not reported by this car';

function flagOn(v) { return String(v || '').trim() === '1'; }
function features(env) {
  let v; try { v = env ? env.EXPO_PUBLIC_LYLO_CODE_TIMELINE : process.env.EXPO_PUBLIC_LYLO_CODE_TIMELINE; } catch (e) { v = undefined; }
  return { on: flagOn(v) };
}

function isDemo(scan) { return !!(scan && (scan.demoLabel || /^DEMO/i.test(String(scan.adapter || '')))); }

/** Local, non-reversible-enough key so the raw VIN is not used as a storage key. */
function vehicleKey(scan) {
  const vin = scan && scan.vin ? String(scan.vin).toUpperCase() : '';
  if (!vin) return 'no-vin';
  let h = 5381;
  for (let i = 0; i < vin.length; i++) h = ((h * 33) ^ vin.charCodeAt(i)) >>> 0;
  return 'v' + h.toString(36);
}

/** Codes in this scan with their plain labels. */
function codesOf(scan) {
  const out = [];
  const lit = !!(scan && scan.monitor && scan.monitor.milOn);
  const add = (code, kind) => { if (code) out.push({ code, kind }); };
  ((scan && scan.stored) || []).forEach((c) => add(c, lit ? 'stored_lit' : 'stored'));
  ((scan && scan.pending) || []).forEach((c) => add(c, 'pending'));
  ((scan && scan.permanent) || []).forEach((c) => add(c, 'permanent'));
  return out;
}

function emptyHistory() { return { v: 1, vehicles: {} }; }
function sane(h) { return h && h.v === 1 && h.vehicles && typeof h.vehicles === 'object' ? h : emptyHistory(); }

/** Pure: returns a NEW history with this scan recorded. Same scan (timestamp) twice = recorded once. */
function recordScan(history, scan, nowIso) {
  const h = JSON.parse(JSON.stringify(sane(history)));
  if (!scan) return h;
  const at = nowIso || scan.timestamp || new Date().toISOString();
  const vk = vehicleKey(scan);
  if (vk === 'no-vin' && require('./sessionV2').on()) return h; // v0.7.3: unidentified scans never enter a car's history
  const veh = h.vehicles[vk] || { scans: 0, lastScanId: null, codes: {} };
  const id = scan.timestamp || at;
  if (veh.lastScanId === id) return h;
  veh.scans += 1; veh.lastScanId = id; veh.updated = at;
  for (const { code, kind } of codesOf(scan)) {
    const c = veh.codes[code] || { firstSeen: at, lastSeen: at, count: 0, kinds: [] };
    if (c.lastSeenScan !== id) { c.count += 1; c.lastSeenScan = id; }
    c.lastSeen = at;
    if (c.kinds.indexOf(kind) === -1) c.kinds.push(kind);
    veh.codes[code] = c;
  }
  const names = Object.keys(veh.codes);
  if (names.length > MAX_CODES) {
    names.sort((a, b) => String(veh.codes[a].lastSeen).localeCompare(String(veh.codes[b].lastSeen)));
    names.slice(0, names.length - MAX_CODES).forEach((n) => delete veh.codes[n]);
  }
  h.vehicles[vk] = veh;
  const vks = Object.keys(h.vehicles);
  if (vks.length > MAX_VEHICLES) {
    vks.sort((a, b) => String(h.vehicles[a].updated).localeCompare(String(h.vehicles[b].updated)));
    vks.slice(0, vks.length - MAX_VEHICLES).forEach((k) => delete h.vehicles[k]);
  }
  return h;
}

async function loadHistory(storage) {
  try { const raw = storage ? await storage.getItem(KEY) : null; return raw ? sane(JSON.parse(raw)) : emptyHistory(); } catch (e) { return emptyHistory(); }
}
async function saveHistory(storage, h) {
  try { if (storage) await storage.setItem(KEY, JSON.stringify(h)); return true; } catch (e) { return false; }
}

const mi = (km) => (typeof km === 'number' ? Math.round(km * KM_TO_MI) : null);
function fmtMin(m) {
  if (typeof m !== 'number') return null;
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60); const r = m % 60;
  return h + ' hr' + (r ? ' ' + r + ' min' : '');
}
function fmtDate(iso) {
  const d = new Date(iso); if (isNaN(d.getTime())) return '?';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** The four counters; each is { label, value } with a plain fallback when unsupported. */
function counters(pids) {
  const p = pids || {};
  const row = (label, v) => ({ label, value: v === null ? NOT_REPORTED : v, reported: v !== null });
  return [
    row('Miles driven with the check-engine light on', mi(p.dist_mil_on_km) === null ? null : mi(p.dist_mil_on_km) + ' mi'),
    row('Engine time with the light on', fmtMin(p.time_mil_on_min)),
    row('Miles since codes were last cleared', mi(p.dist_since_clear_km) === null ? null : mi(p.dist_since_clear_km) + ' mi'),
    row('Engine time since codes were cleared', fmtMin(p.time_since_clear_min)),
  ];
}

const FF_LABELS = [
  ['rpm', 'Engine RPM', ' rpm'], ['speed_mph', 'Speed', ' mph'], ['coolant_temp_f', 'Coolant', '°F'],
  ['engine_load', 'Engine load', '%'], ['throttle', 'Throttle', '%'], ['intake_temp_f', 'Intake air', '°F'],
  ['stft_b1', 'Short-term fuel trim', '%'], ['ltft_b1', 'Long-term fuel trim', '%'],
];
function freezeView(ff) {
  if (!ff || !ff.code) return null;
  const v = ff.values || {};
  return { code: ff.code, rows: FF_LABELS.filter(([k]) => typeof v[k] === 'number').map(([k, l, u]) => ({ label: l, value: v[k] + u })) };
}

// Synthetic example for the no-sensor demo (never stored). Dates are relative to "now".
function demoHistory(now) {
  const t = now ? new Date(now).getTime() : Date.now();
  const ago = (d) => new Date(t - d * 86400000).toISOString();
  return { codes: {
    P0171: { firstSeen: ago(63), lastSeen: ago(0), count: 5, kinds: ['stored_lit', 'permanent'] },
    P0420: { firstSeen: ago(21), lastSeen: ago(0), count: 3, kinds: ['pending'] },
    P0442: { firstSeen: ago(90), lastSeen: ago(34), count: 2, kinds: ['pending'] },
  }, scans: 6 };
}
const DEMO_FREEZE = { code: 'P0171', values: { rpm: 2150, speed_mph: 48, coolant_temp_f: 194, engine_load: 41, ltft_b1: 18.8, stft_b1: 6.3 } };
const DEMO_PIDS = { dist_mil_on_km: 248, time_mil_on_min: 312, dist_since_clear_km: 1931, time_since_clear_min: 2875 };

/** View model for the card. history = whole stored history (ignored for demo scans). */
function buildTimeline(scan, history, now) {
  if (!scan) return null;
  const demo = isDemo(scan);
  const s2 = require('./sessionV2').on();
  const veh = demo ? demoHistory(now) : (s2 && vehicleKey(scan) === 'no-vin' ? { codes: {}, scans: 0 } : (sane(history).vehicles[vehicleKey(scan)] || { codes: {}, scans: 0 }));
  const nowCodes = {};
  codesOf(scan).forEach(({ code, kind }) => { (nowCodes[code] = nowCodes[code] || []).push(kind); });
  const names = Object.keys(veh.codes);
  Object.keys(nowCodes).forEach((c) => { if (names.indexOf(c) === -1) names.push(c); });
  const rows = names.map((code) => {
    const c = veh.codes[code] || { firstSeen: null, lastSeen: null, count: 0, kinds: [] };
    const kinds = nowCodes[code] || c.kinds;
    return {
      code, inThisScan: !!nowCodes[code],
      labels: kinds.map((k) => (s2 ? KIND_LABEL_V2[k] : KIND_LABEL[k]) || k),
      firstSeen: c.firstSeen ? fmtDate(c.firstSeen) : 'this scan',
      lastSeen: c.lastSeen ? fmtDate(c.lastSeen) : 'this scan',
      count: Math.max(c.count, nowCodes[code] ? 1 : 0),
      firstSeenIso: c.firstSeen,
    };
  }).sort((a, b) => (b.inThisScan - a.inThisScan) || String(a.firstSeenIso || '~').localeCompare(String(b.firstSeenIso || '~')));
  if (s2 && !demo) rows.forEach((r) => { r.firstLabel = 'First seen by LYLO'; r.lastLabel = 'Last seen by LYLO'; });
  return {
    demo, noVin: s2 && !demo && vehicleKey(scan) === 'no-vin',
    demoLabel: demo ? 'Demo example: made-up history so you can see how the timeline works.' : null,
    note: HONEST_NOTE,
    freeze: freezeView(demo ? (scan.freezeFrame || DEMO_FREEZE) : scan.freezeFrame),
    freezeNote: 'Freeze frame: what the engine was doing the moment the car stored this code.',
    counters: counters(demo ? DEMO_PIDS : scan.pids),
    rows,
    scans: veh.scans || 0,
    empty: rows.length === 0,
  };
}

module.exports = { KEY, HONEST_NOTE, KIND_LABEL, KIND_LABEL_V2, NOT_REPORTED, features, isDemo, vehicleKey, codesOf, recordScan, loadHistory, saveHistory, counters, freezeView, buildTimeline, demoHistory };
