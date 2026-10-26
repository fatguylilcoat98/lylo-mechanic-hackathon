/*
 * LYLO Mechanic hackathon build (Oct 26, 2026 onward).
 * Converts a baseline mobile scan (baseline/mobile/src/services/obd/obdScan.js
 * runFullScan output) into the POST /api/v1/live/live payload.
 * No React Native imports, so it runs and is tested in plain Node.
 */
'use strict';

// Mobile scan key -> exact backend PID name. These names must match the
// backend's PID_RANGES exactly, or the safety classifier silently ignores
// the reading (proven Oct 26: "coolant_temp" at 260 °F gave SAFE_TO_DRIVE).
// test/scanToLive.test.js checks every name against the Python source.
const PID_MAP = {
  coolant_temp_f:       { name: 'ENGINE_COOLANT_TEMP',      pid_code: '05', unit: '°F' },
  rpm:                  { name: 'ENGINE_RPM',               pid_code: '0C', unit: 'rpm' },
  stft_b1:              { name: 'SHORT_TERM_FUEL_TRIM_B1',  pid_code: '06', unit: '%' },
  ltft_b1:              { name: 'LONG_TERM_FUEL_TRIM_B1',   pid_code: '07', unit: '%' },
  module_voltage:       { name: 'BATTERY_VOLTAGE',          pid_code: '42', unit: 'V' },
  engine_load:          { name: 'ENGINE_LOAD',              pid_code: '04', unit: '%' },
  throttle:             { name: 'THROTTLE_POSITION',        pid_code: '11', unit: '%' },
  intake_temp_f:        { name: 'INTAKE_AIR_TEMP',          pid_code: '0F', unit: '°F' },
  speed_mph:            { name: 'VEHICLE_SPEED',            pid_code: '0D', unit: 'mph' },
  // Un-ranged pass-through PIDs (backend validation allowlist PASSTHROUGH_PIDS).
  run_time_s:           { name: 'RUN_TIME_SINCE_START',     pid_code: '1F', unit: 's' },
  fuel_level:           { name: 'FUEL_LEVEL',               pid_code: '2F', unit: '%' },
  dist_mil_on_km:       { name: 'DIST_MIL_ON',              pid_code: '21', unit: 'km' },
  time_mil_on_min:      { name: 'TIME_MIL_ON',              pid_code: '4D', unit: 'min' },
  time_since_clear_min: { name: 'TIME_SINCE_CODES_CLEARED', pid_code: '4E', unit: 'min' },
  warmups_since_clear:  { name: 'WARMUPS_SINCE_CLEAR',      pid_code: '30', unit: '' },
  dist_since_clear_km:  { name: 'DIST_SINCE_CODES_CLEARED', pid_code: '31', unit: 'km' },
};

// Judgment-call thresholds for "codes were probably cleared recently".
// A full drive cycle set usually needs more than this; documented in NEW_WORK.md.
const CLEARED_THRESHOLDS = { distKm: 80, warmups: 10, minutes: 60 };

function deriveCodesCleared(scan) {
  const p = (scan && scan.pids) || {};
  const ev = [];
  if (typeof p.dist_since_clear_km === 'number' && p.dist_since_clear_km < CLEARED_THRESHOLDS.distKm) {
    ev.push(`Only ${p.dist_since_clear_km} km driven since codes were cleared (under ${CLEARED_THRESHOLDS.distKm}).`);
  }
  if (typeof p.warmups_since_clear === 'number' && p.warmups_since_clear < CLEARED_THRESHOLDS.warmups) {
    ev.push(`Only ${p.warmups_since_clear} warm-ups since codes were cleared (under ${CLEARED_THRESHOLDS.warmups}).`);
  }
  if (typeof p.time_since_clear_min === 'number' && p.time_since_clear_min < CLEARED_THRESHOLDS.minutes) {
    ev.push(`Only ${p.time_since_clear_min} engine minutes since codes were cleared (under ${CLEARED_THRESHOLDS.minutes}).`);
  }
  const stored = new Set(scan.stored || []);
  const orphan = (scan.permanent || []).filter((c) => !stored.has(c));
  if (orphan.length) {
    ev.push(`Permanent code(s) ${orphan.join(', ')} present with no matching stored code, which usually means the stored codes were erased.`);
  }
  return { cleared: ev.length > 0, evidence: ev };
}

function isRealNumber(v) { return typeof v === 'number' && Number.isFinite(v); }

/**
 * @param scan        runFullScan() output (or a DEMO_SCANS entry)
 * @param opts.vehicle optional user-entered {model, odometer (miles), engine, trim, transmission, drive_type, is_hybrid, is_ev}
 * @param opts.symptoms optional {primary_category, severity, frequency}
 */
function scanToLivePayload(scan, opts = {}) {
  if (!scan || typeof scan !== 'object') throw new Error('scanToLivePayload: scan is required');
  const dtcs = [];
  const add = (code, status, description) => {
    if (typeof code !== 'string' || !/^[PCBU][0-9A-F]{4}$/i.test(code)) return;
    dtcs.push(description ? { code: code.toUpperCase(), status, description } : { code: code.toUpperCase(), status });
  };
  const stored = scan.stored || [];
  stored.forEach((c) => add(c, 'active'));
  (scan.pending || []).filter((c) => stored.indexOf(c) === -1).forEach((c) => add(c, 'pending'));
  // Permanent codes go as their own status; the server treats them as active
  // (fault not verified repaired) instead of the misleading "history".
  (scan.permanent || []).filter((c) => stored.indexOf(c) === -1).forEach((c) => add(c, 'permanent'));

  const raw_pids = [];
  const pids = scan.pids || {};
  Object.keys(pids).forEach((k) => {
    const def = PID_MAP[k];
    if (!def || !isRealNumber(pids[k])) return; // unknown keys and NaN are dropped, never renamed
    raw_pids.push({ name: def.name, pid_code: def.pid_code, raw_value: pids[k], unit: def.unit });
  });

  const readiness_monitors = ((scan.monitor && scan.monitor.monitors) || [])
    .filter((m) => m && typeof m.name === 'string')
    .map((m) => ({ name: m.name, status: m.complete ? 'complete' : 'incomplete' }));

  const v = opts.vehicle || {};
  const decoded = scan.vehicle || {};
  const vehicle_profile = {};
  const vin = scan.vin || decoded.vin;
  if (typeof vin === 'string' && vin.length === 17) vehicle_profile.vin = vin;
  if (Number.isInteger(decoded.year)) vehicle_profile.year = decoded.year;
  if (typeof decoded.make === 'string') vehicle_profile.make = decoded.make;
  ['model', 'engine', 'trim', 'transmission', 'drive_type', 'engine_type'].forEach((f) => {
    if (typeof v[f] === 'string' && v[f].trim()) vehicle_profile[f] = v[f].trim();
  });
  if (Number.isInteger(v.odometer) && v.odometer >= 0) vehicle_profile.odometer = v.odometer;
  if (typeof v.is_hybrid === 'boolean') vehicle_profile.is_hybrid = v.is_hybrid;
  if (typeof v.is_ev === 'boolean') vehicle_profile.is_ev = v.is_ev;
  if (scan.monitor && scan.monitor.engineType === 'diesel' && !vehicle_profile.engine_type) vehicle_profile.engine_type = 'diesel';

  const cleared = deriveCodesCleared(scan);
  const payload = {
    adapter_id: typeof scan.adapter === 'string' && scan.adapter ? scan.adapter : 'unknown',
    protocol: scan.protocol ? 'ELM protocol ' + String(scan.protocol) : 'unknown',
    connection_quality: 'stable',
    read_complete: true,
    vehicle_profile,
    raw_dtcs: dtcs,
    raw_pids,
    readiness_monitors,
    codes_cleared_before_scan: cleared.cleared,
    codes_cleared_evidence: cleared.evidence,
  };
  if (opts.symptoms && typeof opts.symptoms === 'object') payload.symptoms = opts.symptoms;
  return payload;
}

module.exports = { scanToLivePayload, deriveCodesCleared, PID_MAP, CLEARED_THRESHOLDS };
