'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const D = require('../src/demoNoConnect');
const { TOURS } = require('../src/tours');
const ON = { EXPO_PUBLIC_LYLO_DEMO_NO_CONNECT: '1' };
const PROMPT = /connect|pair|plug|bluetooth|scan my car|scan your own car/i;

test('flag must equal exactly 1', () => {
  for (const v of [undefined, '', '0', 'true', ' 1', '1 ', 1]) assert.strictEqual(D.on({ EXPO_PUBLIC_LYLO_DEMO_NO_CONNECT: v }), false, String(v));
  assert.strictEqual(D.on(ON), true);
});

test('flag on: no tour end button opens an adapter screen or reads like a connect prompt', () => {
  for (const t of TOURS) {
    const b = D.tryIt(t, ON);
    if (!b) continue;
    assert.ok(!D.ADAPTER_ROUTES.includes(b.route), t.id);
    assert.ok(!PROMPT.test(b.label), t.id + ': ' + b.label);
  }
  assert.ok(!PROMPT.test(D.NOTE));
});

test('flag off: tour buttons unchanged', () => {
  for (const t of TOURS) assert.strictEqual(D.tryIt(t, {}), t.tryIt || null, t.id);
  assert.ok(TOURS.some((t) => t.tryIt && t.tryIt.route === 'Connect')); // the old behavior still exists
});

test('results screens: adapter actions hidden only for demo scans with flag on', () => {
  const { DEMO_SCANS } = require('../../../baseline/mobile/src/data/demoScans');
  for (const k of Object.keys(DEMO_SCANS)) {
    assert.strictEqual(D.hideAdapterActions(DEMO_SCANS[k], ON), true, k);
    assert.strictEqual(D.hideAdapterActions(DEMO_SCANS[k], {}), false, k);
  }
  const live = { codes: [] }; // live scan: no demoLabel
  assert.strictEqual(D.hideAdapterActions(live, ON), false);
  assert.strictEqual(D.hideAdapterActions(live, {}), false);
});

test('screens are wired to the gate', () => {
  const r = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
  assert.match(r('../src/TourScreens.js'), /DNC\.tryIt\(tour, env\)/);
  for (const f of ['CodesScreen.js', 'UsedCarScreen.js']) {
    const s = r('../../../baseline/mobile/src/screens/' + f);
    assert.match(s, /onScanAnother=\{SV\.on\(\) && !DNC\.hideAdapterActions\(scan\)/, f);
  }
  assert.match(r('../../../baseline/mobile/src/screens/CodesScreen.js'), /DNC\.hideAdapterActions\(scan\) \|\| \(SV\.on\(\)/);
});
