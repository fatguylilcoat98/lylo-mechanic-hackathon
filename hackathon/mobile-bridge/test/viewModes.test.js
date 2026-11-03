'use strict';
const test = require('node:test');
const assert = require('node:assert');
const VM = require('../src/viewModes');
const { scanToLivePayload } = require('../src/scanToLive');
const { DEMO_SCANS } = require('../../../baseline/mobile/src/data/demoScans');
const mem = (init = {}) => { const m = { ...init }; return { m, getItem: async (k) => m[k] ?? null, setItem: async (k, v) => { m[k] = v; } }; };

test('flag parse and loadChosen returns null until picked', async () => {
  assert.strictEqual(VM.features({}).on, false); assert.strictEqual(VM.features({ EXPO_PUBLIC_LYLO_VIEW_MODE: '1' }).on, true);
  assert.strictEqual(await VM.loadChosen(mem()), null);
  assert.strictEqual(await VM.loadChosen(mem({ 'lylo.viewMode': 'mechanic' })), 'mechanic');
  assert.strictEqual(await VM.loadChosen({ getItem: async () => { throw new Error('x'); } }), null);
});

test('mechanic view never invents values: unread PIDs say not read', () => {
  const s = DEMO_SCANS.checkengine; const k = VM.buildMechanic(VM.demoModel(s), s);
  const by = Object.fromEntries(k.pids.map((p) => [p.key, p.value]));
  assert.strictEqual(by.ltft_b1, '18 %'); assert.strictEqual(by.maf_gs, 'not read'); assert.strictEqual(by.o2_b1s1_v, 'not read');
  assert.strictEqual(k.freezeFrame, null); assert.strictEqual(k.mil.time, 'not read'); assert.strictEqual(k.mil.distance, '130 mi');
  const p = k.codes.find((c) => c.code === 'P0302');
  assert.match(p.status, /stored/); assert.match(p.status, /permanent/); assert.strictEqual(p.system, 'engine and transmission');
  assert.ok(p.tests.length && p.related.length);
});

test('simple view: same facts in plain words, terms explained once, verdict follows the level', () => {
  const s = DEMO_SCANS.checkengine; const p = VM.buildPlain({ tone: 'red', levelCode: 'DO_NOT_DRIVE', actions: ['Leave it parked.'], causes: [] }, s);
  assert.strictEqual(p.verdict.title, "Don't drive");
  assert.strictEqual(p.codes.length, 2); assert.ok(p.codes.every((c) => c.means && c.cost));
  const all = JSON.stringify(p);
  assert.ok(all.includes('misfire (a cylinder not firing right)') || all.includes('ignition coil (part that makes the spark)'));
  assert.strictEqual((all.match(/\(part that makes the spark\)/g) || []).length, 1);
  assert.strictEqual(VM.buildPlain({ tone: 'green', actions: [] }, {}).verdict.title, 'Safe to drive');
});

test('port help is generic and complete', () => {
  assert.ok(VM.PORT_HELP.steps.length === 6 && /16 little holes/.test(VM.PORT_HELP.where));
  assert.ok(VM.PORT_HELP.cantFind.some((t) => /1996/.test(t)));
  assert.deepStrictEqual(VM.SENSOR_STEPS.map((x) => x.id), ['where', 'off', 'plug', 'key', 'light', 'pair']);
  assert.deepStrictEqual(VM.NOSENSOR_STEPS.map((x) => x.id), ['dash', 'photo', 'describe', 'code']);
});

test('payload carries view only with the phone flag on', () => {
  const s = DEMO_SCANS.checkengine;
  assert.strictEqual(scanToLivePayload(s, { view: 'simple', env: {} }).view, undefined);
  assert.strictEqual(scanToLivePayload(s, { view: 'simple', env: { EXPO_PUBLIC_LYLO_VIEW_MODE: '1' } }).view, 'simple');
  assert.strictEqual(scanToLivePayload(s, { view: 'x', env: { EXPO_PUBLIC_LYLO_VIEW_MODE: '1' } }).view, undefined);
});
