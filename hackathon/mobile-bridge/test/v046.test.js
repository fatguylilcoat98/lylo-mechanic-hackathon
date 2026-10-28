'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { youtubeUrl, NEARBY, priceLinks } = require('../src/priceLinks');
const setup = require('../src/setup');

const car = { year: 2003, make: 'Honda', model: 'Accord' };

test('youtubeUrl: plain search URL, no key', () => {
  const u = youtubeUrl('2003 Honda Accord  crankshaft position sensor');
  assert.strictEqual(u, 'https://www.youtube.com/results?search_query=2003%20Honda%20Accord%20crankshaft%20position%20sensor');
  assert.ok(!/key=/i.test(u));
  assert.strictEqual(youtubeUrl(''), null);
});

test('priceLinks: watch button uses the remembered vehicle + part', () => {
  const p = priceLinks('engine air filter', car);
  assert.match(p.watch.url, /search_query=2003%20Honda%20Accord%20engine%20air%20filter$/);
  assert.match(p.watch.text, /videos for your 2003 Honda Accord/);
  const q = priceLinks('engine air filter', null);
  assert.match(q.watch.url, /search_query=engine%20air%20filter$/);
  assert.match(q.watch.note, /Add your VIN to get videos for your model/);
  assert.match(q.watch.note, /not checked by LYLO/);
  assert.match(p.watch.note, /not checked by LYLO/);
  assert.ok(!/exact car/.test(JSON.stringify([p, q])), 'never claims exact-car videos');
  assert.ok(p.buttons.length >= 4, 'existing store buttons kept');
});

test('nearest store: Google Maps searches, no location in URL', () => {
  assert.deepStrictEqual(NEARBY.map((n) => n.name), ['AutoZone', "O'Reilly", 'NAPA']);
  for (const n of NEARBY) {
    assert.match(n.url, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=.+near%20me$/);
    assert.ok(!/ll=|lat|@/.test(n.url));
  }
  assert.strictEqual(priceLinks('tires', car).nearby, NEARBY);
});

function mem() { const m = {}; return { m, getItem: async (k) => (k in m ? m[k] : null), setItem: async (k, v) => { m[k] = v; } }; }

test('setup: shown once, answers saved under existing keys', async () => {
  const s = mem();
  assert.strictEqual(await setup.isSetupDone(s), false);
  await setup.saveAnswers(s, { hasAdapter: false, viewMode: 'mechanic', vehicle: setup.manualVehicle('2015', 'ford', 'F-150') });
  assert.strictEqual(await setup.isSetupDone(s), true);
  assert.strictEqual(s.m['lylo.viewMode'], 'mechanic');
  assert.strictEqual(JSON.parse(s.m['lylo.vehicle']).name, '2015 Ford F-150');
  assert.strictEqual(s.m['lylo.hasAdapter'], 'no');
  assert.strictEqual(setup.nextRoute(false, true), 'NoAdapter');
  assert.strictEqual(setup.nextRoute(true, true), 'Home');
  assert.strictEqual(setup.nextRoute(false, false), 'Home');
});

test('setup: skip marks done without overwriting anything', async () => {
  const s = mem(); s.m['lylo.viewMode'] = 'simple';
  await setup.skip(s);
  assert.strictEqual(await setup.isSetupDone(s), true);
  assert.strictEqual(s.m['lylo.viewMode'], 'simple');
  assert.ok(!('lylo.vehicle' in s.m));
});

test('setup: manual vehicle validation', () => {
  assert.strictEqual(setup.manualVehicle('15', 'Ford', 'F-150'), null);
  assert.strictEqual(setup.manualVehicle('2015', '', 'F-150'), null);
  const v = setup.manualVehicle('2015', 'ford', 'f-150');
  assert.strictEqual(v.recalls, null);
  assert.match(v.source, /typed/);
});

test('forCodeDetail: Watch how even when the fix names no part', () => {
  const { forCodeDetail } = require('../src/priceLinks');
  const p = forCodeDetail({ code: 'P0171', title: 'System too lean (bank 1)', fix: 'Find and fix the vacuum leak' }, car);
  assert.deepStrictEqual(p.buttons, []);
  assert.match(p.watch.url, /search_query=2003%20Honda%20Accord%20P0171%20System%20too%20lean/);
  const q = forCodeDetail({ code: 'P0335', title: 'Crank sensor', fix: 'Replace the crankshaft position sensor' }, car);
  assert.ok(q.buttons.length >= 4);
  assert.match(q.watch.url, /crankshaft%20position%20sensor/);
});
