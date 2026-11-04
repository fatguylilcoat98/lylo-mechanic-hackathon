/*
 * LYLO Mechanic v0.7.5: one verdict, fail-closed. Flag EXPO_PUBLIC_LYLO_ONE_VERDICT=1 (exactly '1').
 * Flag off: nothing here is used and every screen is unchanged.
 *  - The headline starts at the rule/server level and can only go UP from what the screen also shows.
 *  - Any trouble code (unknown, pending, permanent, stored) -> at least INSPECT_SOON.
 *  - Library urgency orange -> DRIVE_SHORT_DISTANCE_ONLY, red -> DO_NOT_DRIVE.
 *  - Codes cleared recently or self-tests unfinished -> at least INSPECT_SOON.
 *  - Cold engine (< 150 °F) with total fuel trim beyond ±10% -> at least INSPECT_SOON ("recheck warm").
 * Stricter choices for Vera's 3 open rulings (cold trim, pending misfire, "no problems" wording) are marked RULING.
 */
'use strict';

const ORDER = ['SAFE_TO_DRIVE', 'INSPECT_SOON', 'DRIVE_SHORT_DISTANCE_ONLY', 'DO_NOT_DRIVE', 'TOW_RECOMMENDED', 'EMERGENCY_STOP_IMMEDIATELY'];
const rank = (lv) => ORDER.indexOf(lv);
const maxLevel = (...lv) => lv.filter((x) => rank(x) >= 0).reduce((a, b) => (rank(b) > rank(a) ? b : a), 'SAFE_TO_DRIVE');
const TONE = { SAFE_TO_DRIVE: 'green', INSPECT_SOON: 'yellow', DRIVE_SHORT_DISTANCE_ONLY: 'orange', DO_NOT_DRIVE: 'red', TOW_RECOMMENDED: 'red', EMERGENCY_STOP_IMMEDIATELY: 'red' };
const COLOR_LEVEL = { green: 'SAFE_TO_DRIVE', yellow: 'INSPECT_SOON', orange: 'DRIVE_SHORT_DISTANCE_ONLY', red: 'DO_NOT_DRIVE' };

/** The ONE title table (Simple, Mechanic, results, demos). */
const TITLES = {
  SAFE_TO_DRIVE: { title: 'Good to drive', why: 'We did not find anything that makes it unsafe to drive right now.' },
  INSPECT_SOON: { title: 'Get it checked soon', why: 'It is OK to drive, but have a mechanic look at it in the next few days.' },
  DRIVE_SHORT_DISTANCE_ONLY: { title: 'Drive only short trips', why: 'Only drive it a short way, straight to a repair shop.' },
  DO_NOT_DRIVE: { title: "Don't drive it", why: 'Driving it could be unsafe or cause damage. Leave it parked and get help.' },
  TOW_RECOMMENDED: { title: "Don't drive it. Get a tow.", why: 'Driving it could be unsafe or cause damage. Have it towed.' },
  EMERGENCY_STOP_IMMEDIATELY: { title: 'Pull over now', why: 'Stop as soon as it is safe and turn the engine off.' },
};
const TONE_TITLE = { green: TITLES.SAFE_TO_DRIVE, yellow: TITLES.INSPECT_SOON, orange: TITLES.DRIVE_SHORT_DISTANCE_ONLY, red: TITLES.DO_NOT_DRIVE };

function on(env) {
  let v;
  if (env) v = env.EXPO_PUBLIC_LYLO_ONE_VERDICT; else { try { v = process.env.EXPO_PUBLIC_LYLO_ONE_VERDICT; } catch (e) { v = undefined; } }
  return v === '1';
}

function lookup(code, kind) {
  try { return require('../../../baseline/mobile/src/engine/diagnose').buildCodeResult(code, kind); } catch (e) { return null; }
}

/** Level a single code puts on the screen (fail-closed: unknown -> INSPECT_SOON). */
function codeLevel(code, status) {
  const r = lookup(code, status || 'stored');
  const lib = r && r.known && r.urgency ? COLOR_LEVEL[r.urgency.color] : null;
  return maxLevel('INSPECT_SOON', lib || 'INSPECT_SOON'); // RULING (pending misfire etc.): any code -> at least INSPECT_SOON
}

/**
 * facts = { codes:[{code,status}], coolantF, trim, recentlyCleared, incomplete:[...] }
 * -> [{ level, reason }]
 */
function floors(facts) {
  const f = facts || {};
  const out = [];
  (f.codes || []).forEach((c) => out.push({ level: codeLevel(c.code, c.status), reason: `code ${c.code}` }));
  if (f.recentlyCleared) out.push({ level: 'INSPECT_SOON', reason: 'codes cleared recently' });
  if (f.incomplete && f.incomplete.length) out.push({ level: 'INSPECT_SOON', reason: 'self-tests not finished' });
  if (isColdTrim(f)) out.push({ level: 'INSPECT_SOON', reason: 'cold engine, fuel trim beyond 10%' }); // RULING: cold trim
  return out;
}
const isColdTrim = (f) => typeof f.coolantF === 'number' && f.coolantF < 150 && typeof f.trim === 'number' && Math.abs(f.trim) > 10;

function decide(ruleLevel, facts) {
  const base = rank(ruleLevel) >= 0 ? ruleLevel : 'INSPECT_SOON'; // unknown rule level -> fail closed
  const fl = floors(facts);
  const level = maxLevel(base, ...fl.map((x) => x.level));
  return { level, tone: TONE[level], raised: level !== base, reasons: fl.filter((x) => rank(x.level) > rank(base)).map((x) => x.reason), title: TITLES[level] };
}

/** Facts from a phone-format scan (demoScans.js shape). */
function factsFromScan(scan) {
  const s = scan || {};
  const codes = [];
  const seen = {};
  ['stored', 'pending', 'permanent'].forEach((k) => (Array.isArray(s[k]) ? s[k] : []).forEach((c) => {
    const code = String(c || '').toUpperCase(); if (!/^[PCBU][0-9A-F]{4}$/.test(code) || seen[code]) return; seen[code] = 1; codes.push({ code, status: k });
  }));
  const p = s.pids || {};
  const trim = (typeof p.stft_b1 === 'number' ? p.stft_b1 : 0) + (typeof p.ltft_b1 === 'number' ? p.ltft_b1 : 0);
  return { codes, coolantF: p.coolant_temp_f, trim: typeof p.ltft_b1 === 'number' || typeof p.stft_b1 === 'number' ? trim : undefined,
    recentlyCleared: typeof p.dist_since_clear_km === 'number' && p.dist_since_clear_km < 80,
    incomplete: s.monitor && Array.isArray(s.monitor.incomplete) ? s.monitor.incomplete : [] };
}

const toF = (it) => { if (!it) return undefined; const v = Number(it.value); if (Number.isNaN(v)) return undefined; return /F/i.test(String(it.unit || '')) ? v : v * 9 / 5 + 32; };

/** Facts from a server result (ledger items). */
function factsFromResult(r) {
  const det = (r && r.detective) || {};
  const ledger = Array.isArray(det.ledger) ? det.ledger : [];
  const pid = {}; ledger.forEach((i) => { if (String(i.id || '').startsWith('pid:')) pid[i.name] = i; });
  const codes = ledger.filter((i) => String(i.id || '').startsWith('dtc:') && i.code).map((i) => ({ code: String(i.code).toUpperCase(), status: i.status }));
  // r2 (Vera C2): the server uses more than one name for the same reading
  const pick = (...names) => names.map((n) => pid[n]).find(Boolean);
  const st = pick('SHORT_TERM_FUEL_TRIM_B1', 'SHORT_TERM_FUEL_TRIM_BANK_1', 'STFT_B1');
  const lt = pick('LONG_TERM_FUEL_TRIM_B1', 'LONG_TERM_FUEL_TRIM_BANK_1', 'LTFT_B1');
  const trim = st || lt ? (Number((st || {}).value) || 0) + (Number((lt || {}).value) || 0) : undefined;
  const incomplete = ledger.filter((i) => String(i.id || '').startsWith('mon:') && (i.complete === false || /incomplete|not/i.test(String(i.status || '')))).map((i) => i.name || i.id);
  return { codes, coolantF: toF(pid.ENGINE_COOLANT_TEMP), trim, recentlyCleared: !!det.recently_cleared, incomplete };
}

/** Server result -> phone-format scan, so Simple/Mechanic builders see the same facts as the headline. */
function scanFromResult(r) {
  const f = factsFromResult(r);
  const det = (r && r.detective) || {};
  const ledger = Array.isArray(det.ledger) ? det.ledger : [];
  const pid = {}; ledger.forEach((i) => { if (String(i.id || '').startsWith('pid:')) pid[i.name] = i; });
  const num = (n) => (pid[n] && !Number.isNaN(Number(pid[n].value)) ? Number(pid[n].value) : undefined);
  const scan = { stored: [], pending: [], permanent: [], pids: {}, monitor: { incomplete: f.incomplete } };
  f.codes.forEach((c) => { const k = /pend/i.test(c.status || '') ? 'pending' : /perm/i.test(c.status || '') ? 'permanent' : 'stored'; scan[k].push(c.code); });
  const P = scan.pids;
  if (f.coolantF !== undefined) P.coolant_temp_f = Math.round(f.coolantF);
  const numOf = (...ns) => ns.map(num).find((v) => v !== undefined); // r2 (Vera C2): both name forms
  const stv = numOf('SHORT_TERM_FUEL_TRIM_B1', 'SHORT_TERM_FUEL_TRIM_BANK_1', 'STFT_B1'); if (stv !== undefined) P.stft_b1 = stv;
  const ltv = numOf('LONG_TERM_FUEL_TRIM_B1', 'LONG_TERM_FUEL_TRIM_BANK_1', 'LTFT_B1'); if (ltv !== undefined) P.ltft_b1 = ltv;
  if (num('BATTERY_VOLTAGE') !== undefined) P.module_voltage = num('BATTERY_VOLTAGE');
  if (num('ENGINE_RPM') !== undefined) P.rpm = num('ENGINE_RPM');
  const d = pid.DIST_SINCE_CODES_CLEARED; if (d) P.dist_since_clear_km = /mi/i.test(String(d.unit || '')) ? Number(d.value) / 0.621371 : Number(d.value);
  return scan;
}

/** Sort codes worst first (Simple view). */
function bySeverity(codes) {
  return (codes || []).map((c, i) => ({ c, i, r: rank(codeLevel(c.code, (c.statuses || [])[0])) })).sort((a, b) => b.r - a.r || a.i - b.i).map((x) => x.c);
}

const ACTION_PLAIN = { kept_rule_level: 'Set by the safety rules', agreed: 'Meta AI agreed with the safety rules', detective_lower_ignored: 'Meta AI suggested less serious; the safety rules kept the higher level',
  raised_by_detective: 'Meta AI raised the level', no_opinion: 'Meta AI gave no safety opinion' };
const plainLevel = (lv) => (TITLES[lv] ? TITLES[lv].title : 'Not read');
const plainAction = (a) => ACTION_PLAIN[a] || 'Set by the safety rules';

/** v0.7.7: legacy code badge routed through decide() (can only raise). Returns null when the flag is off. */
function codeBadge(r, env) {
  if (!on(env) || !r || !r.urgency) return null;
  const v = decide(COLOR_LEVEL[r.urgency.color], { codes: [{ code: r.code, status: r.kind || 'stored' }] });
  return { level: v.level, tone: v.tone, text: v.title.title.toUpperCase(), message: v.title.why, raised: v.raised };
}

module.exports = { codeBadge, plainLevel, plainAction,  ORDER, rank, maxLevel, TONE, TITLES, TONE_TITLE, on, codeLevel, floors, decide, factsFromScan, factsFromResult, scanFromResult, bySeverity, isColdTrim };
