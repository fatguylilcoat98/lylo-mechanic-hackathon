// v0.7.3 Vera acceptance: identity/history isolation + clear-codes policy. Synthetic data only.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const D = require('../../../baseline/mobile/src/services/obd/decoders');
const S = require('../src/sessionV2');
const T = require('../src/codeTimeline');
const CP = require('../src/clearPolicy');

function withCheck(v) { for (const c of '0123456789X') { const t = v.slice(0, 8) + c + v.slice(9); if (D.vinCheckOk(t)) return t; } throw new Error('x'); }
const FORD = withCheck('1FDXE45F0WHA00001');
const KIA = withCheck('KNAF54AD0RE000002');
const fordSaved = { vin: FORD, name: '1998 Ford E-450', engine: '7.3L', source: 'NHTSA' };

function withFlag(fn) { const o = process.env.EXPO_PUBLIC_LYLO_SESSION_V2; process.env.EXPO_PUBLIC_LYLO_SESSION_V2 = '1'; try { fn(); } finally { if (o === undefined) delete process.env.EXPO_PUBLIC_LYLO_SESSION_V2; else process.env.EXPO_PUBLIC_LYLO_SESSION_V2 = o; } }

test('ISOLATION: a Kia scan never shows the Ford identity or Ford history', () => withFlag(() => {
  let h = T.recordScan(null, { vin: FORD, stored: ['P0171'], timestamp: '2026-11-01T10:00:00Z' }, '2026-11-01T10:00:00Z');
  const kia = S.stamp({ vin: KIA, stored: ['P04E0'], pending: ['P04E0'], timestamp: '2026-11-03T22:00:00Z', adapter: 'MX' }, S.newSession('MX'));
  const m = S.buildModel(kia, fordSaved, null);
  assert.strictEqual(m.idv.vin, KIA); assert.strictEqual(m.idv.vehicle, null); assert.notStrictEqual(m.idv.name, fordSaved.name);
  const tl = T.buildTimeline(kia, h, new Date('2026-11-03T22:00:00Z'));
  assert.ok(!JSON.stringify(tl).includes('P0171'), 'Ford code leaked into Kia timeline');
  assert.ok(JSON.stringify(h.vehicles[T.vehicleKey({ vin: FORD })]).includes('P0171'), 'Ford history preserved');
  h = T.recordScan(h, kia, '2026-11-03T22:00:00Z');
  assert.ok(!JSON.stringify(h.vehicles[T.vehicleKey({ vin: FORD })]).includes('P04E0'), 'Kia code leaked into Ford history');
}));

test('ISOLATION: unknown VIN starts a clean session with no prior vehicle or history attached', () => withFlag(() => {
  let h = T.recordScan(null, { vin: FORD, stored: ['P0171'], timestamp: '2026-11-01T10:00:00Z' }, '2026-11-01T10:00:00Z');
  const prev = S.stamp({ vin: FORD, stored: [] }, S.newSession('MX'));
  const unk = S.stamp({ vin: null, stored: ['P04E0'], timestamp: '2026-11-03T22:05:00Z' }, S.newSession('MX'));
  assert.notStrictEqual(unk.session.id, prev.session.id);
  assert.strictEqual(S.isStale(prev), true);
  const m = S.buildModel(unk, fordSaved, null);
  assert.strictEqual(m.idv.status, 'unknown'); assert.strictEqual(m.idv.vehicle, null); assert.strictEqual(m.idv.name, null);
  // a manual confirm made in the earlier session does not carry over
  assert.strictEqual(S.buildModel(unk, fordSaved, { sessionId: prev.session.id, vehicle: fordSaved }).idv.status, 'unknown');
  const tl = T.buildTimeline(unk, h, new Date());
  assert.ok(!JSON.stringify(tl).includes('P0171')); assert.strictEqual(tl.noVin, true);
  const h2 = T.recordScan(h, unk, '2026-11-03T22:05:00Z');
  assert.deepStrictEqual(h2.vehicles['no-vin'], undefined, 'unknown-VIN scan must not be written to history');
  assert.ok(!JSON.stringify(h2.vehicles[T.vehicleKey({ vin: FORD })]).includes('P04E0'));
}));

test('CLEAR: P04E0 is the generic EVAP purge-valve code, emissions level, not safety; clear is offered', () => {
  const c = CP.classify('P04E0');
  assert.strictEqual(c.level, 'emissions'); assert.match(c.info.title, /Purge Control Valve/);
  const kia = { vin: KIA, stored: ['P04E0'], pending: ['P04E0'], permanent: ['P04E0'], monitor: { milOn: true } };
  assert.strictEqual(CP.canOffer(kia).ok, true);
});

test('CLEAR: not offered while any safety-level code is active (stored, pending or permanent) or server red', () => {
  for (const [kind, code] of [['stored', 'C0035'], ['pending', 'P0302'], ['permanent', 'P0217'], ['stored', 'B0001'], ['pending', 'P0521']]) {
    const r = CP.canOffer({ [kind]: [code, 'P04E0'] });
    assert.strictEqual(r.ok, false, code); assert.match(r.reason, new RegExp(code));
    assert.strictEqual(CP.step('idle', 'tap', { [kind]: [code] }).state, 'blocked');
  }
  assert.strictEqual(CP.canOffer({ stored: [], serverDiagnosis: { result: { safety: { level: 'red' } } } }).ok, false);
});

test('CLEAR: explicit two-step confirm; warning covers readiness reset and not-a-fix', () => {
  const scan = { stored: ['P04E0'] };
  const a = CP.step('idle', 'tap', scan); assert.strictEqual(a.state, 'warned');
  assert.match(a.show.body, /does NOT fix/); assert.match(a.show.body, /readiness monitors/);
  assert.strictEqual(CP.step('idle', 'confirm', scan).state, 'idle', 'cannot skip the warning');
  assert.strictEqual(CP.step('warned', 'confirm', scan).state, 'idle', 'cannot skip the final confirm');
  const b = CP.step('warned', 'ack', scan); assert.strictEqual(b.state, 'final');
  assert.strictEqual(CP.step('final', 'confirm', scan).state, 'confirmed');
  assert.strictEqual(CP.step('final', 'cancel', scan).state, 'idle');
});

test('CLEAR: before/after record keeps when, why, VIN, session and codes before', () => withFlag(() => {
  const s = S.stamp({ vin: KIA, stored: ['P04E0'], pending: ['P04E0'], monitor: { milOn: true } }, S.newSession('MX'));
  const r = CP.clearRecord(s, 'After a repair', '2026-11-03T23:00:00Z');
  assert.strictEqual(r.at, '2026-11-03T23:00:00Z'); assert.strictEqual(r.vin, KIA); assert.strictEqual(r.sessionId, s.session.id);
  assert.strictEqual(r.milBefore, true); assert.strictEqual(r.before.length, 2);
  const after = S.buildModel(S.stamp({ vin: KIA, stored: [], pending: [], permanent: ['P04E0'], permanentSupported: true }, S.newSession('MX'), { afterClear: true }), null, null);
  assert.ok(after.afterClear.some((x) => /Permanent: P04E0/.test(x)));
}));

test('flag: exact "1" only (" 1" and "true" are off)', () => {
  assert.strictEqual(S.on({ EXPO_PUBLIC_LYLO_SESSION_V2: ' 1' }), false);
  assert.strictEqual(S.on({ EXPO_PUBLIC_LYLO_SESSION_V2: 'true' }), false);
  assert.strictEqual(require('../../../baseline/mobile/src/services/obd/obdScan').sessionOn({ env: { EXPO_PUBLIC_LYLO_SESSION_V2: '1 ' } }), false);
});
