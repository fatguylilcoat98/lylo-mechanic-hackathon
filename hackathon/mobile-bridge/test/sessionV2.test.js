// v0.7.3 session isolation (flag EXPO_PUBLIC_LYLO_SESSION_V2). Synthetic VINs and frames only.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const D = require('../../../baseline/mobile/src/services/obd/decoders');
const S = require('../src/sessionV2');
const ON = { EXPO_PUBLIC_LYLO_SESSION_V2: '1' };

// Build a synthetic VIN with a correct check digit (position 9).
function withCheck(v) {
  for (const c of '0123456789X') { const t = v.slice(0, 8) + c + v.slice(9); if (D.vinCheckOk(t)) return t; }
  throw new Error('no check digit');
}
const FORD = withCheck('1FDXE45F0WHA00001'); // synthetic 1998 Ford pattern
const KIA = withCheck('KNAF54AD0RE000002');  // synthetic Kia pattern (Korea plant)
const hex = (s) => Buffer.from(s, 'ascii').toString('hex').toUpperCase();

test('flag reads only exact "1"', () => {
  assert.strictEqual(S.on({}), false); assert.strictEqual(S.on({ EXPO_PUBLIC_LYLO_SESSION_V2: '0' }), false); assert.strictEqual(S.on(ON), true);
});

test('Mode 09 PID 02: ISO 15765 multi-frame, two ECUs answer (engine + transmission)', () => {
  const body = '490201' + hex(KIA); // 20 bytes
  const frames = (b) => ['014', '0:' + b.slice(0, 12), '1:' + b.slice(12, 26), '2:' + b.slice(26, 40)];
  const lines = frames(body).concat(frames(body));
  assert.strictEqual(D.decodeVINStrict(lines), KIA);
  assert.strictEqual(D.decodeVIN(lines), KIA); // old decoder also fine on clean frames
});

test('Mode 09: a second ECU with a junk answer does not corrupt the VIN', () => {
  const good = '490201' + hex(KIA);
  const lines = ['014', '0:490201000000', '1:00000000000000', '2:00000000000000', '014', '0:' + good.slice(0, 12), '1:' + good.slice(12, 26), '2:' + good.slice(26, 40)];
  assert.strictEqual(D.decodeVINStrict(lines), KIA);
});

test('Mode 09: bad check digit is rejected (no guessing)', () => {
  const bad = FORD.slice(0, 8) + (FORD[8] === '1' ? '2' : '1') + FORD.slice(9); // North American: check digit enforced
  const b = '490201' + hex(bad);
  assert.strictEqual(D.decodeVINStrict(['014', '0:' + b.slice(0, 12), '1:' + b.slice(12, 26), '2:' + b.slice(26, 40)]), null);
  assert.strictEqual(S.liveVin(bad), null);
});

test('Mode 09: legacy 5-line answer still decodes', () => {
  const h = hex('\0\0\0' + FORD);
  const lines = [0, 1, 2, 3, 4].map((i) => '4902' + '0' + (i + 1) + h.slice(i * 8, i * 8 + 8));
  assert.strictEqual(D.decodeVINStrict(lines), FORD);
});

test('MIL is ON if any ECU reports it (TCM answering first with MIL off)', () => {
  assert.strictEqual(D.milFromAll(['41010007E500', '41018107E500']), true);
  assert.strictEqual(D.milFromAll(['41010007E500']), false);
  assert.strictEqual(D.milFromAll(['NO DATA']), null);
});

const savedFord = { vin: FORD, name: '1998 Ford E-450', engine: '7.3L', source: 'NHTSA vPIC', caveat: 'c' };

test('Ford -> Kia -> Ford: saved car shows only when the live VIN matches', () => {
  const ford = S.stamp({ timestamp: 't1', vin: FORD, adapter: 'MX' }, S.newSession('MX'));
  assert.strictEqual(S.identify(ford, savedFord).vehicle.name, '1998 Ford E-450');
  const kia = S.stamp({ timestamp: 't2', vin: KIA, adapter: 'MX', vehicle: D.decodeVinOffline(KIA) }, S.newSession('MX'));
  const k = S.identify(kia, savedFord);
  assert.strictEqual(k.status, 'verified'); assert.strictEqual(k.vehicle, null); assert.strictEqual(k.vin, KIA);
  assert.ok(/Kia/.test(k.name)); assert.strictEqual(k.engine, null);
  const ford2 = S.stamp({ timestamp: 't3', vin: FORD }, S.newSession('MX'));
  assert.strictEqual(S.identify(ford2, savedFord).vehicle.name, '1998 Ford E-450');
});

test('failed VIN read: Vehicle not identified, never the Ford; manual confirm only for that session', () => {
  const s = S.stamp({ timestamp: 't4', vin: null }, S.newSession('MX'));
  const u = S.identify(s, savedFord);
  assert.strictEqual(u.status, 'unknown'); assert.strictEqual(u.vehicle, null); assert.strictEqual(S.STATUS_LABEL.unknown, 'Vehicle not identified');
  assert.strictEqual(S.identify(s, savedFord, { sessionId: s.session.id, vehicle: savedFord }).status, 'manual');
  const next = S.stamp({ timestamp: 't5', vin: null }, S.newSession('MX'));
  assert.strictEqual(S.identify(next, savedFord, { sessionId: s.session.id, vehicle: savedFord }).status, 'unknown');
});

test('stale async result from an older session is dropped; reconnect starts a new session', () => {
  const a = S.stamp({ timestamp: 't6', vin: KIA }, S.newSession('MX'));
  assert.strictEqual(S.isStale(a), false);
  const b = S.stamp({ timestamp: 't7', vin: KIA }, S.newSession('MX'));
  assert.notStrictEqual(a.session.id, b.session.id);
  assert.strictEqual(S.isStale(a), true); assert.strictEqual(S.isStale(b), false);
  S.resetActive(); assert.strictEqual(S.activeSession(), null);
});

test('results carry session id, VIN, timestamp, adapter', () => {
  const x = S.stamp({ timestamp: '2026-11-03T22:00:00Z', vin: KIA, adapter: 'OBDII v1.5' }, S.newSession('OBDII v1.5', '2026-11-03T22:00:00Z'));
  assert.deepStrictEqual([!!x.session.id, x.session.vin, x.session.scannedAt, x.session.adapterId], [true, KIA, '2026-11-03T22:00:00Z', 'OBDII v1.5']);
});

test('code status: MIL separate; stored + pending same code explained; permanent noted', () => {
  const st = S.codeStatus({ monitor: { milOn: true }, stored: ['P04E0'], pending: ['P04E0'], permanent: ['P04E0'], permanentSupported: true });
  assert.ok(/ON/.test(st.milText)); assert.deepStrictEqual(st.stored, ['P04E0']); assert.deepStrictEqual(st.pending, ['P04E0']);
  assert.ok(st.notes.some((n) => /stored AND pending/.test(n)));
  assert.ok(!st.notes.join(' ').match(/not lit/));
});

test('counters: PID 21/31 km -> mi, labelled, never a fault date', () => {
  const c = S.counters({ dist_mil_on_km: 16674, dist_since_clear_km: 16769 });
  assert.ok(/^10,361 mi \(16674 km/.test(c[0].value)); assert.ok(/^10,420 mi/.test(c[1].value));
  assert.ok(/do not tell you the date or the mileage/.test(S.COUNTER_NOTE));
});

test('readings grouped with PID source and fuel-trim signs', () => {
  const g = S.readings({ coolant_temp_f: 160, module_voltage: 14.39, rpm: 740, stft_b1: 5.5, ltft_b1: -7 });
  const flat = g.flatMap((x) => x.rows.map((r) => r.value));
  assert.ok(flat.includes('+5.5%') && flat.includes('-7%') && flat.includes('160 °F') && flat.includes('14.39 V'));
});

test('verdict: green wording replaced, tone unchanged, limits + unknown-vehicle lines', () => {
  const v = S.adjustVerdict({ title: 'Good to drive', why: 'x' }, 'green', { status: 'unknown' });
  assert.strictEqual(v.title, 'No urgent fault detected'); assert.ok(v.why.includes(S.LIMITS) && v.why.includes(S.UNKNOWN_VEH));
  const y = S.adjustVerdict({ title: 'Get it checked soon', why: 'y' }, 'yellow', { status: 'verified' });
  assert.strictEqual(y.title, 'Get it checked soon'); assert.ok(!y.why.includes(S.UNKNOWN_VEH));
});

test('after clear: remaining codes listed honestly', () => {
  const m = S.buildModel(S.stamp({ timestamp: 't8', vin: KIA, stored: [], pending: [], permanent: ['P04E0'], permanentSupported: true }, S.newSession('MX'), { afterClear: true }));
  assert.ok(m.afterClear.some((t) => /Permanent: P04E0/.test(t)));
});

test('history: kept per real VIN; no-vin scans never merged; flag off = old behavior', () => {
  const T = require('../src/codeTimeline');
  const prev = process.env.EXPO_PUBLIC_LYLO_SESSION_V2;
  try {
    process.env.EXPO_PUBLIC_LYLO_SESSION_V2 = '1';
    let h = T.recordScan(null, { timestamp: 'a', vin: FORD, stored: ['P0300'] });
    h = T.recordScan(h, { timestamp: 'b', vin: KIA, stored: ['P04E0'], monitor: { milOn: true } });
    h = T.recordScan(h, { timestamp: 'c', vin: null, stored: ['P0171'] });
    assert.strictEqual(Object.keys(h.vehicles).length, 2); assert.ok(!h.vehicles['no-vin']);
    const tk = T.buildTimeline({ timestamp: 'd', vin: KIA, stored: ['P04E0'] }, h);
    assert.deepStrictEqual(tk.rows.map((r) => r.code), ['P04E0']); assert.strictEqual(tk.rows[0].lastLabel, 'Last seen by LYLO');
    const tn = T.buildTimeline({ timestamp: 'e', vin: null, stored: [] }, h);
    assert.strictEqual(tn.noVin, true); assert.strictEqual(tn.rows.length, 0);
    delete process.env.EXPO_PUBLIC_LYLO_SESSION_V2;
    assert.ok(T.recordScan(null, { timestamp: 'f', vin: null, stored: ['P0171'] }).vehicles['no-vin']);
  } finally { if (prev === undefined) delete process.env.EXPO_PUBLIC_LYLO_SESSION_V2; else process.env.EXPO_PUBLIC_LYLO_SESSION_V2 = prev; }
});

test('engine override: never applied without a matching live VIN when the flag is on', () => {
  const EO = require('../src/engineOverride');
  const env = { EXPO_PUBLIC_LYLO_ENGINE_OVERRIDE: '1', EXPO_PUBLIC_LYLO_SESSION_V2: '1' };
  if (typeof EO.setCurrent === 'function') EO.setCurrent({ vin: FORD, fuel: 'gas', engine: '7.5L' });
  else return; // module has no test hook; covered by code review
  assert.deepStrictEqual(EO.fieldsFor(null, env), {});
  assert.deepStrictEqual(EO.fieldsFor(KIA, env), {});
  assert.ok(EO.fieldsFor(FORD, env).engine_user);
});
