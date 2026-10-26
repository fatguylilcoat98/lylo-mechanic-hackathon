const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/photoHelper');
const { isCircuitCode, WIRING_ACTION } = require('../src/friendlyLabels');
const { buildResults } = require('../src/resultsView');
const live = (j) => require(`../../server/evidence/photo_helper/live_${j}.json`);

test('six simple jobs with plain photo instructions; risky jobs grouped to a pro', () => {
  assert.deepStrictEqual(P.JOBS.map((j) => j.id), ['engine_air_filter', 'cabin_air_filter', 'battery', 'wiper_blades', 'bulb', 'tires']);
  for (const j of P.JOBS) assert.match(j.photo, /picture/);
  assert.match(P.PRO_JOBS.title, /Brakes.*fuel.*airbags.*hybrid/i);
  assert.strictEqual(P.GET_A_PRO, 'Get a pro for this one.');
});

test('layoutMarks clamps and scales', () => {
  const l = P.layoutMarks([{ n: 1, text: '1. Battery', x: 2, y: -1, radius: 5 }, { n: 2, text: '2. x', x: 'bad', y: 0.5 }], 400, 300);
  assert.strictEqual(l.length, 1);
  assert.deepStrictEqual([l[0].cx, l[0].cy, l[0].r], [400, 0, 60]); // radius capped at 0.15 of width
  assert.ok(l[0].badgeX <= 384 && l[0].badgeY >= 16);
});

test('layoutMarks: overlapping circles shrink apart, badges never overlap each other', () => {
  const marks = [
    { n: 1, text: '1. Battery', x: 0.5, y: 0.5, radius: 0.15 },
    { n: 2, text: '2. Positive (+) terminal', x: 0.56, y: 0.5, radius: 0.1 },
    { n: 3, text: '3. Negative (\u2212) terminal', x: 0.5, y: 0.56, radius: 0.1 },
  ];
  const l = P.layoutMarks(marks, 1000, 750);
  for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
    const a = l[i]; const b = l[j];
    const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
    assert.ok(d + 0.01 >= a.r + b.r || a.r === 20 || b.r === 20, 'circles shrink to not overlap (or hit the minimum)');
    assert.ok(Math.hypot(a.badgeX - b.badgeX, a.badgeY - b.badgeY) >= 34, 'badges apart');
  }
  for (const m of l) assert.ok(m.badgeX >= 16 && m.badgeX <= 984 && m.badgeY >= 16 && m.badgeY <= 734);
});

test('live results (synthetic photos) -> view model; disclaimer always', () => {
  const vm = P.viewModel(live('engine_air_filter'), 'engine_air_filter');
  assert.ok(vm.found && vm.marks.length >= 1 && vm.steps.length >= 3);
  assert.strictEqual(vm.disclaimer, 'This is not a guarantee. It gives you an idea of where to look.');
  assert.match(vm.mechanic.receipt, /muse-spark/);
  const nf = P.viewModel(live('cabin_air_filter'), 'cabin_air_filter');
  assert.strictEqual(nf.found, false);
  assert.strictEqual(nf.message, "I can't see it in this photo. Try a closer picture or check your owner's manual.");
  assert.deepStrictEqual([nf.marks, nf.steps], [[], []]);
  const b = P.viewModel(live('battery'), 'battery');
  assert.match(b.warnings[0], /negative.*first/i);
  assert.match(P.viewModel({ helper_status: 'error: offline' }, 'battery').warnings[0], /metal tool/);
});

test('refused, engine cover, offline', () => {
  assert.strictEqual(P.viewModel({ helper_status: 'refused', marks: [{ n: 1 }] }, 'battery').message, 'Get a pro for this one.');
  const c = P.viewModel({ helper_status: 'engine_cover', found: false, marks: [{ n: 1, text: '1. Pull up here', x: 0.4, y: 0.3 }] }, 'engine_air_filter');
  assert.match(c.message, /plastic cover over the engine/);
  assert.strictEqual(c.marks.length, 1);
  assert.strictEqual(c.steps.length, 0);
  assert.match(P.viewModel({ helper_status: 'error: offline', offline: true }, 'tires').message, /needs the internet/);
});

test('requestHelper never throws and sends the app key', async () => {
  global.FormData = class { constructor() { this.p = []; } append(k, v) { this.p.push([k, v]); } };
  let seen;
  const ok = await P.requestHelper({ baseUrl: 'https://x/', appKey: 'k', job: 'bulb', photo: { uri: 'file:///a.jpg' },
    fetchImpl: async (u, o) => { seen = [u, o]; return { status: 200, json: async () => ({ helper_status: 'ok', found: true }) }; } });
  assert.strictEqual(ok.helper_status, 'ok');
  assert.strictEqual(seen[0], 'https://x/api/v1/photo/helper');
  assert.strictEqual(seen[1].headers['X-LYLO-App-Key'], 'k');
  const off = await P.requestHelper({ baseUrl: 'https://x', job: 'bulb', photo: { uri: 'u' }, fetchImpl: async () => { throw new Error('net'); } });
  assert.strictEqual(off.offline, true);
  assert.strictEqual((await P.requestHelper({ baseUrl: '', job: 'bulb', photo: {} })).offline, true);
  const e = await P.requestHelper({ baseUrl: 'https://x', job: 'bulb', photo: { uri: 'u' }, fetchImpl: async () => ({ status: 429, json: async () => ({ error: 'Rate limit' }) }) });
  assert.match(e.helper_status, /429/);
});

test('wiring before parts for circuit codes', () => {
  assert.ok(isCircuitCode('P0135') && isCircuitCode('P0031') && !isCircuitCode('P0420') && !isCircuitCode('P0171'));
  assert.ok(isCircuitCode('P2A00', 'O2 Sensor Circuit Range/Performance'));
  const scan = JSON.parse(JSON.stringify(require('./fixtures/truck.json').scan));
  scan.serverDiagnosis.result.safety.level = 'INSPECT_SOON';
  const m = buildResults(scan, { codes: [{ code: 'P0135', title: 'O2 Sensor Heater Circuit Malfunction (Bank 1 Sensor 1)', priceText: { shop: '$100 – $300' } }], screen: 'codes' });
  assert.ok(m.actions.includes(WIRING_ACTION));
  assert.match(WIRING_ACTION, /Often it's the wire or plug, not the sensor/);
  assert.doesNotMatch(JSON.stringify(m.actions), /P0135|Heater Circuit Malfunction/);
});
