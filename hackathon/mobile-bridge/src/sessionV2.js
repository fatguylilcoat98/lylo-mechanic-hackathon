/*
 * LYLO Mechanic v0.7.3: scan-session isolation (flag EXPO_PUBLIC_LYLO_SESSION_V2=1). Pure CommonJS.
 * Flag off = every helper here is a no-op and callers keep their old behavior.
 * - Each scan gets a session id, adapter id and timestamp; only the newest session is "active".
 * - The saved vehicle ('lylo.vehicle') is shown ONLY when its VIN equals the VIN read live from the car.
 * - Vehicle-reported facts (codes, MIL, counters) stay separate from LYLO's own history and from AI text.
 */
'use strict';

const { validateVin } = require('./vin');

function on(env) {
  let v;
  if (env) v = env.EXPO_PUBLIC_LYLO_SESSION_V2;
  else { try { v = process.env.EXPO_PUBLIC_LYLO_SESSION_V2; } catch (e) { v = undefined; } }
  return String(v === undefined || v === null ? '' : v) === '1'; // exact '1' only (Vera C1 pattern)
}

let active = null; // { id, startedAt, adapterId }
let counter = 0;
function newSession(adapterId, nowIso) {
  counter += 1;
  const at = nowIso || new Date().toISOString();
  active = { id: 's' + Date.parse(at).toString(36) + '-' + counter, startedAt: at, adapterId: adapterId || 'unknown' };
  return active;
}
function activeSession() { return active; }
function resetActive() { active = null; }

/** Live VIN check: 17 chars, legal letters; check digit enforced for North American VINs (1-5 first char). */
function liveVin(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== 17 || /[IOQ]/.test(s)) return null;
  if (/^[1-5]/.test(s)) { const v = validateVin(s); return v.ok ? v.vin : null; }
  return s;
}

/** Stamp a finished scan with its session. Returns a new object. */
function stamp(scan, session, opts = {}) {
  if (!scan) return scan;
  const s = session || active || newSession(scan.adapter);
  const vin = liveVin(scan.vin);
  return { ...scan, vin: vin, vinRaw: scan.vin || null,
    session: { id: s.id, startedAt: s.startedAt, adapterId: s.adapterId || scan.adapter || 'unknown', vin: vin, scannedAt: scan.timestamp || s.startedAt, afterClear: !!opts.afterClear } };
}

/** True when this scan belongs to an older session than the active one (drop it). */
function isStale(scan) {
  if (!scan || !scan.session || !active) return false;
  return scan.session.id !== active.id;
}

/**
 * Vehicle identity for THIS scan. Never falls back to another car.
 * status: 'verified' (live VIN read and decoded/saved for same VIN), 'manual' (owner confirmed this VIN
 * for this session), 'unknown' (no usable live VIN).
 */
function identify(scan, saved, manual) {
  const vin = scan ? liveVin(scan.vin) : null;
  const mine = (v) => (v && vin && String(v.vin || '').toUpperCase() === vin ? v : null);
  if (vin) {
    const v = mine(saved);
    const off = scan.vehicle && scan.vehicle.vin === vin ? scan.vehicle : null; // offline WMI/year decode only
    return { status: 'verified', vin, vehicle: v,
      name: v ? v.name : (off && (off.year || off.make) ? [off.year, off.make].filter(Boolean).join(' ') : null),
      engine: v && v.engine ? v.engine : null, source: v ? v.source : (off ? 'VIN pattern (year and maker only)' : null) };
  }
  if (manual && manual.sessionId && scan && scan.session && manual.sessionId === scan.session.id && manual.vehicle) {
    return { status: 'manual', vin: manual.vehicle.vin || null, vehicle: manual.vehicle, name: manual.vehicle.name || null, engine: null, source: 'Confirmed by you for this scan' };
  }
  return { status: 'unknown', vin: null, vehicle: null, name: null, engine: null, source: null };
}

const STATUS_LABEL = { verified: 'Verified from the car (VIN read live)', manual: 'Entered by you for this scan', unknown: 'Vehicle not identified' };

/** MIL + code status, each from its own OBD source. */
function codeStatus(scan) {
  const sc = scan || {};
  const mil = sc.monitor ? !!sc.monitor.milOn : null;
  const list = (k) => (Array.isArray(sc[k]) ? sc[k] : []);
  return {
    mil, milText: mil === null ? 'Check-engine light: not reported (Mode 01 PID 01 did not answer)'
      : 'Check-engine light: ' + (mil ? 'ON' : 'OFF') + ' (read from the car, Mode 01 PID 01)',
    stored: list('stored'), pending: list('pending'), permanent: list('permanent'), permanentSupported: !!sc.permanentSupported,
    notes: [
      'Stored (confirmed) codes (Mode 03): faults the car confirmed. These are what turn the light on.',
      'Pending codes (Mode 07): the car saw a fault in the current or last drive cycle. The same code can be stored AND pending at once; that just means it is still failing.',
      sc.permanentSupported ? 'Permanent codes (Mode 0A): cannot be erased by a scan tool. They clear themselves after the car re-tests and passes.' : 'Permanent codes (Mode 0A): not supported by this car.',
    ],
  };
}

const KM_TO_MI = 0.621371;
/** The two distance counters, labelled as what they are (never a fault date or fault mileage). */
function counters(pids) {
  const p = pids || {};
  const row = (pid, label, km) => ({ pid, label, value: typeof km === 'number' ? `${Math.round(km * KM_TO_MI).toLocaleString('en-US')} mi (${km} km reported by the car)` : 'Not reported by this car' });
  return [
    row('01 21', 'Distance driven while the check-engine light was on', p.dist_mil_on_km),
    row('01 31', 'Distance since trouble codes were last cleared', p.dist_since_clear_km),
  ];
}
const COUNTER_NOTE = 'These are running counters from the car. They do not tell you the date or the mileage when a code first set.';

const GROUPS = [
  ['Engine', [['rpm', 'Engine speed', ' rpm', '01 0C'], ['engine_load', 'Calculated load', '%', '01 04'], ['throttle', 'Throttle position', '%', '01 11'], ['run_time_s', 'Time since start', ' s', '01 1F']]],
  ['Temperature', [['coolant_temp_f', 'Coolant', ' °F', '01 05'], ['intake_temp_f', 'Intake air', ' °F', '01 0F']]],
  ['Fuel', [['stft_b1', 'Short-term fuel trim, bank 1 (+ = adding fuel)', '%', '01 06'], ['ltft_b1', 'Long-term fuel trim, bank 1 (+ = adding fuel)', '%', '01 07'], ['fuel_level', 'Fuel level', '%', '01 2F']]],
  ['Electrical', [['module_voltage', 'Control module voltage', ' V', '01 42']]],
  ['Motion', [['speed_mph', 'Vehicle speed', ' mph', '01 0D']]],
];
function readings(pids) {
  const p = pids || {};
  const sign = (k, v) => (/^(stft|ltft)/.test(k) && v > 0 ? '+' + v : String(v));
  return GROUPS.map(([group, rows]) => ({ group, rows: rows.filter(([k]) => typeof p[k] === 'number').map(([k, label, unit, pid]) => ({ label, value: sign(k, p[k]) + unit, pid })) }))
    .filter((g) => g.rows.length);
}

const LIMITS = 'This is an OBD computer check only. It cannot see brakes, tires, steering, leaks or rust, and it is not a safety inspection.';
const UNKNOWN_VEH = 'Vehicle not identified, so nothing here is specific to a make or model.';
/** Same tone and level; only the green wording changes, plus the limits line. */
function adjustVerdict(verdict, tone, idv) {
  if (!verdict) return verdict;
  const out = { ...verdict };
  if (tone === 'green') { out.title = 'No urgent fault detected'; out.why = 'The car\'s computer did not report anything urgent right now.'; }
  out.why = [out.why, LIMITS, idv && idv.status === 'unknown' ? UNKNOWN_VEH : null].filter(Boolean).join(' ');
  return out;
}

const CLEAR_REMAINS = (st) => {
  const left = [];
  if (st.stored.length) left.push(`Still stored: ${st.stored.join(', ')} (the fault is still there)`);
  if (st.pending.length) left.push(`Pending: ${st.pending.join(', ')}`);
  if (st.permanent.length) left.push(`Permanent: ${st.permanent.join(', ')} (no scan tool can erase these; they clear after the car re-tests and passes)`);
  return left.length ? left : ['No codes came back on this rescan. Readiness self-tests were reset and need several drives to finish.'];
};

function buildModel(scan, saved, manual) {
  if (!scan) return null;
  const idv = identify(scan, saved, manual);
  const st = codeStatus(scan);
  return {
    idv, statusLabel: STATUS_LABEL[idv.status],
    session: scan.session || null,
    codes: st,
    counters: counters(scan.pids), counterNote: COUNTER_NOTE,
    readings: readings(scan.pids),
    raw: scan.pids || {},
    afterClear: scan.session && scan.session.afterClear ? CLEAR_REMAINS(st) : null,
  };
}

module.exports = { on, newSession, activeSession, resetActive, liveVin, stamp, isStale, identify, STATUS_LABEL, codeStatus, counters, COUNTER_NOTE, readings, adjustVerdict, LIMITS, UNKNOWN_VEH, buildModel, CLEAR_REMAINS };
