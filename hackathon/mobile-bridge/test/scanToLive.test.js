'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { scanToLivePayload, deriveCodesCleared, PID_MAP } = require('../src/scanToLive');
const { DEMO_SCANS } = require('../../../baseline/mobile/src/data/demoScans');
const { PID_DEFS } = require('../../../baseline/mobile/src/services/obd/decoders');

const ROOT = path.join(__dirname, '..', '..', '..');
function pythonPidRanges() {
  const src = fs.readFileSync(path.join(ROOT, 'baseline/backend/normalization/normalizer.py'), 'utf8');
  const block = src.split('PID_RANGES = {')[1].split('}')[0];
  return new Set([...block.matchAll(/"([A-Z0-9_]+)"\s*:/g)].map((m) => m[1]));
}
function pythonPassthrough() {
  const src = fs.readFileSync(path.join(ROOT, 'hackathon/server/lylo_hack/validation.py'), 'utf8');
  const block = src.split('PASSTHROUGH_PIDS = {')[1].split('}')[0];
  return new Set([...block.matchAll(/"([A-Z0-9_]+)"/g)].map((m) => m[1]));
}

test('every mapped PID name exists in the backend (a wrong name would silently hide safety data)', () => {
  const ranged = pythonPidRanges();
  const pass = pythonPassthrough();
  assert.ok(ranged.has('ENGINE_COOLANT_TEMP'), 'parsed PID_RANGES');
  for (const [key, def] of Object.entries(PID_MAP)) {
    assert.ok(ranged.has(def.name) || pass.has(def.name), `${key} -> ${def.name} is not a backend PID name`);
  }
  // Safety-relevant readings must be ranged, not pass-through.
  for (const k of ['coolant_temp_f', 'rpm', 'module_voltage', 'stft_b1', 'ltft_b1']) {
    assert.ok(ranged.has(PID_MAP[k].name), `${k} must map to a ranged PID`);
  }
});

test('every PID the phone reads has a mapping', () => {
  for (const def of Object.values(PID_DEFS)) assert.ok(PID_MAP[def.key], `no mapping for ${def.key}`);
});

test('coolant reading uses the exact name, pid code and °F', () => {
  const p = scanToLivePayload({ pids: { coolant_temp_f: 260 } });
  assert.deepStrictEqual(p.raw_pids, [{ name: 'ENGINE_COOLANT_TEMP', pid_code: '05', raw_value: 260, unit: '°F' }]);
});

test('unknown keys and NaN are dropped, not renamed', () => {
  const p = scanToLivePayload({ pids: { coolant_temp: 127, rpm: NaN, ltft_b1: 5 } });
  assert.deepStrictEqual(p.raw_pids.map((x) => x.name), ['LONG_TERM_FUEL_TRIM_B1']);
});

test('used-car demo: codes-cleared derived, permanent code kept, VIN passed', () => {
  const p = scanToLivePayload(DEMO_SCANS.usedcar, { vehicle: { model: 'Accord', odometer: 187000 } });
  assert.strictEqual(p.codes_cleared_before_scan, true);
  assert.ok(p.codes_cleared_evidence.length >= 3);
  assert.deepStrictEqual(p.raw_dtcs, [{ code: 'P0420', status: 'pending' }, { code: 'P0171', status: 'permanent' }]);
  assert.strictEqual(p.vehicle_profile.vin, '1HGCM82633A004352');
  assert.strictEqual(p.vehicle_profile.model, 'Accord');
  assert.strictEqual(p.vehicle_profile.odometer, 187000);
  assert.strictEqual(p.readiness_monitors.filter((m) => m.status === 'incomplete').length, 3);
});

test('check-engine demo: no codes-cleared, pending/permanent de-duped against stored', () => {
  const p = scanToLivePayload(DEMO_SCANS.checkengine);
  assert.strictEqual(p.codes_cleared_before_scan, false);
  assert.deepStrictEqual(p.raw_dtcs, [{ code: 'P0302', status: 'active' }, { code: 'P0171', status: 'active' }]);
});

test('codes-cleared stays false when counters are missing', () => {
  assert.deepStrictEqual(deriveCodesCleared({ pids: {} }), { cleared: false, evidence: [] });
});

test('bad codes and bad vehicle values are not sent', () => {
  const p = scanToLivePayload({ stored: ['P03', 'XYZ12', 'p0301'], vin: 'SHORT', vehicle: { year: '2003' } },
    { vehicle: { odometer: -5, model: '  ' } });
  assert.deepStrictEqual(p.raw_dtcs, [{ code: 'P0301', status: 'active' }]);
  assert.deepStrictEqual(p.vehicle_profile, {});
});
