const test = require('node:test');
const assert = require('node:assert');
const { buildResults, shareText, hasServerResult, COLD_ACTION } = require('../src/resultsView');
const { friendly, formatValue, labelFor, LABELS } = require('../src/friendlyLabels');
const { loadViewMode, saveViewMode, VIEW_MODE_KEY, DEFAULT_MODE, MODE_LABELS } = require('../src/viewMode');
const { analyzeCodes } = require('../../../baseline/mobile/src/engine/diagnose');

const clone = (o) => JSON.parse(JSON.stringify(o));
const truck = () => clone(require('./fixtures/truck.json').scan);
const used = () => clone(require('./fixtures/usedcar_cleared.json').scan);
const withLevel = (s, lv) => { s.serverDiagnosis.result.safety.level = lv; return s; };
const BANNED = /detective|pipeline|ledger|hypothes|SHORT_TERM|LONG_TERM|ENGINE_|_B1/i;

test('friendly labels: no PID names, everyday units', () => {
  assert.strictEqual(labelFor('SHORT_TERM_FUEL_TRIM_B1'), 'Fuel adjustment');
  assert.strictEqual(formatValue('SHORT_TERM_FUEL_TRIM_B1', 27.3, '%'), '+27%');
  assert.strictEqual(formatValue('LONG_TERM_FUEL_TRIM_B1', -4.6, '%'), '-5%');
  assert.strictEqual(formatValue('ENGINE_COOLANT_TEMP', 79, '°F'), '79 °F');
  assert.strictEqual(formatValue('ENGINE_COOLANT_TEMP', 100, '°C'), '212 °F');
  assert.strictEqual(formatValue('DIST_SINCE_CODES_CLEARED', 100, 'km'), '62 mi');
  assert.strictEqual(formatValue('TIME_SINCE_CODES_CLEARED', 90, 'min'), '1.5 hours');
  assert.strictEqual(formatValue('X', null, ''), '—');
  for (const v of Object.values(LABELS)) assert.doesNotMatch(v, /_/);
  assert.deepStrictEqual(friendly({ id: 'pid:ENGINE_RPM', name: 'ENGINE_RPM', value: 984, unit: 'rpm' }), { label: 'Engine speed', value: '984 rpm' });
  assert.strictEqual(friendly({ id: 'rule:safety' }), null);
  assert.strictEqual(labelFor('SOME_NEW_PID'), 'Some new pid');
});

test('no server result -> null (baseline screens stay)', () => {
  assert.strictEqual(buildResults({}), null);
  assert.strictEqual(buildResults({ serverDiagnosis: { source: 'offline', result: null } }), null);
  assert.strictEqual(hasServerResult(withLevel(truck(), 'BOGUS')), false);
});

test('verdict colors and titles', () => {
  const want = { SAFE_TO_DRIVE: ['green', 'Good to drive'], INSPECT_SOON: ['yellow', 'Get it checked soon'],
    DRIVE_SHORT_DISTANCE_ONLY: ['orange', 'Drive only short trips'], DO_NOT_DRIVE: ['red', "Don't drive it"],
    TOW_RECOMMENDED: ['red', "Don't drive it"], EMERGENCY_STOP_IMMEDIATELY: ['red', "Don't drive it"] };
  for (const [lv, [tone, title]] of Object.entries(want)) {
    const m = buildResults(withLevel(truck(), lv), { screen: 'codes' });
    assert.strictEqual(m.tone, tone, lv);
    assert.strictEqual(m.verdict.title, title);
    assert.ok(m.verdict.title.split(' ').length >= 2 && m.verdict.title.split(' ').length <= 5);
  }
});

test('truck: one yellow verdict, plain why, cold recheck, 1-3 actions, no jargon in simple view', () => {
  const s = truck();
  const m = buildResults(s, { codes: analyzeCodes(s), screen: 'usedcar' });
  assert.strictEqual(m.verdict.title, 'Get it checked soon');
  assert.ok(m.actions.includes(COLD_ACTION));
  assert.ok(m.actions.length >= 1 && m.actions.length <= 3);
  assert.doesNotMatch(m.verdict.why, /%|\d/);
  const simpleText = JSON.stringify({ v: m.verdict, a: m.actions, w: m.seeWhy, c: m.clearedWarning });
  assert.doesNotMatch(simpleText, BANNED);
  assert.ok(m.seeWhy.causes[0].evidence.includes('Fuel adjustment: +27%'));
  assert.strictEqual(m.poweredBy, 'Powered by Meta AI');
  assert.match(m.receipt, /^muse-spark-1\.3 · 7\.1 s · prompt /);
  assert.strictEqual(m.clearedWarning, null);
});

test('used car with erased codes: big warning, grounded cost only', () => {
  const s = used();
  const codes = analyzeCodes(s);
  const m = buildResults(s, { codes, screen: 'usedcar' });
  assert.strictEqual(m.clearedWarning, "Someone recently erased this car's warning codes. Be careful buying it.");
  const priced = m.actions.filter((a) => /\$/.test(a));
  for (const a of priced) assert.ok(codes.some((c) => a.includes(c.priceText.shop)), a);
  assert.strictEqual(buildResults(s, { codes, screen: 'codes' }).clearedWarning, null);
});

test('no cost is invented without repair data', () => {
  const m = buildResults(truck(), { codes: [], screen: 'codes' });
  for (const a of m.actions) assert.doesNotMatch(a, /\$/);
});

test('share text carries the same single verdict', () => {
  const m = buildResults(truck(), { screen: 'codes' });
  const t = shareText(m);
  assert.match(t, /Get it checked soon/);
  assert.doesNotMatch(t, /LOOKS GOOD|Good to drive/);
});

test('mechanic model: raw PIDs, hypotheses with confidence, same level', () => {
  const m = buildResults(truck(), { screen: 'codes' });
  assert.strictEqual(m.mechanic.levelCode, 'INSPECT_SOON');
  assert.ok(m.mechanic.pids.some((p) => p.name === 'SHORT_TERM_FUEL_TRIM_B1' && p.value === 27.3));
  assert.ok(m.mechanic.hypotheses.length >= 3 && m.mechanic.hypotheses[0].confidenceLabel);
  assert.match(m.mechanic.safetyNote, /from "safe to drive" to "get it inspected soon"/);
});

test('view mode: default simple, persists under the new key only', async () => {
  const mem = {}; const writes = [];
  const store = { getItem: async (k) => (k in mem ? mem[k] : null), setItem: async (k, v) => { writes.push(k); mem[k] = v; } };
  assert.strictEqual(DEFAULT_MODE, 'simple');
  assert.deepStrictEqual(MODE_LABELS, { simple: 'Simple view', mechanic: 'Mechanic view' });
  assert.strictEqual(await loadViewMode(store), 'simple');
  assert.strictEqual(await saveViewMode(store, 'mechanic'), true);
  assert.strictEqual(await loadViewMode(store), 'mechanic');
  assert.strictEqual(await saveViewMode(store, 'weird'), false);
  assert.deepStrictEqual(writes, [VIEW_MODE_KEY]);
  assert.strictEqual(VIEW_MODE_KEY, 'lylo.viewMode');
  mem[VIEW_MODE_KEY] = 'garbage';
  assert.strictEqual(await loadViewMode(store), 'simple');
  assert.strictEqual(await loadViewMode({ getItem: async () => { throw new Error('x'); } }), 'simple');
  assert.strictEqual(await loadViewMode(null), 'simple');
});
