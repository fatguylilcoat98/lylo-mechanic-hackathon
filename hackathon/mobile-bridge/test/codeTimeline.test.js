// v0.7 code timeline (pure). Synthetic data only.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const T = require('../src/codeTimeline');

const scanA = { timestamp: '2026-09-01T10:00:00Z', vin: '1FAKEVIN000000001', monitor: { milOn: true }, stored: ['P0171'], pending: ['P0420'], permanent: ['P0171'], pids: { dist_mil_on_km: 100, time_mil_on_min: 75 } };
const scanB = { timestamp: '2026-10-15T10:00:00Z', vin: '1FAKEVIN000000001', monitor: { milOn: false }, stored: [], pending: ['P0420'], permanent: [], pids: {} };

test('flag reads only exact "1"', () => {
  assert.strictEqual(T.features({}).on, false);
  assert.strictEqual(T.features({ EXPO_PUBLIC_LYLO_CODE_TIMELINE: '0' }).on, false);
  assert.strictEqual(T.features({ EXPO_PUBLIC_LYLO_CODE_TIMELINE: '1' }).on, true);
});

test('record: first/last seen and counts; same scan twice counted once; raw VIN not a key', () => {
  let h = T.recordScan(null, scanA, scanA.timestamp);
  h = T.recordScan(h, scanA, scanA.timestamp);
  h = T.recordScan(h, scanB, scanB.timestamp);
  const vk = Object.keys(h.vehicles)[0];
  assert.ok(!/FAKEVIN/.test(JSON.stringify(Object.keys(h.vehicles))));
  const c = h.vehicles[vk].codes;
  assert.strictEqual(c.P0420.count, 2);
  assert.strictEqual(c.P0420.firstSeen, scanA.timestamp);
  assert.strictEqual(c.P0420.lastSeen, scanB.timestamp);
  assert.strictEqual(c.P0171.count, 1);
  assert.deepStrictEqual(c.P0171.kinds.sort(), ['permanent', 'stored_lit']);
  assert.strictEqual(h.vehicles[vk].scans, 2);
});

test('view: honest note, plain labels, unsupported counters say so, old code kept', () => {
  let h = T.recordScan(null, scanA, scanA.timestamp);
  h = T.recordScan(h, scanB, scanB.timestamp);
  const v = T.buildTimeline(scanB, h);
  assert.match(v.note, /doesn't record dates/);
  assert.match(v.note, /when LYLO saw/);
  const p420 = v.rows.find((r) => r.code === 'P0420');
  assert.deepStrictEqual(p420.labels, ['Pending, not lit yet']);
  const p171 = v.rows.find((r) => r.code === 'P0171');
  assert.strictEqual(p171.inThisScan, false);
  assert.ok(p171.labels.includes('Permanent, survives a clear'));
  assert.ok(v.counters.every((c) => c.value === T.NOT_REPORTED && !c.reported));
  const va = T.buildTimeline(scanA, T.recordScan(null, scanA));
  assert.strictEqual(va.counters[0].value, '62 mi');
  assert.strictEqual(va.counters[1].value, '1 hr 15 min');
});

test('demo scan: synthetic history and freeze frame, labelled', () => {
  const v = T.buildTimeline({ demoLabel: 'Demo', adapter: 'DEMO (no adapter)', stored: ['P0171'], pending: [], permanent: [] }, null, '2026-11-02T00:00:00Z');
  assert.strictEqual(v.demo, true);
  assert.match(v.demoLabel, /Demo example/);
  assert.strictEqual(v.freeze.code, 'P0171');
  assert.ok(v.rows.length >= 3);
  assert.ok(v.counters.every((c) => c.reported));
});

test('storage: load/save never throws', async () => {
  const bad = { getItem: async () => { throw new Error('x'); }, setItem: async () => { throw new Error('x'); } };
  assert.deepStrictEqual(await T.loadHistory(bad), { v: 1, vehicles: {} });
  assert.strictEqual(await T.saveHistory(bad, {}), false);
  const mem = {}; const ok = { getItem: async (k) => mem[k] || null, setItem: async (k, v) => { mem[k] = v; } };
  await T.saveHistory(ok, T.recordScan(null, scanA));
  assert.strictEqual(Object.keys(mem)[0], 'lylo.codeTimeline');
  assert.strictEqual(Object.keys((await T.loadHistory(ok)).vehicles).length, 1);
});
