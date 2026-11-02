'use strict';
const test = require('node:test');
const assert = require('node:assert');
const CG = require('../src/crashGuard');

const still = (d, t0, ms, step = 20) => { let ev = null; for (let t = t0; t <= t0 + ms; t += step) { const e = d.feedAccel({ t, x: 0, y: 0, z: 1 }); if (e) ev = e; } return ev; };

test('flag off by default', () => { assert.strictEqual(CG.features({}).on, false); assert.strictEqual(CG.features({ EXPO_PUBLIC_LYLO_CRASH_GUARD: '1' }).on, true); });

test('impact then stillness = crash', () => {
  const d = CG.createDetector();
  still(d, 0, 1000);
  assert.deepStrictEqual(d.feedAccel({ t: 1020, x: 3, y: 4, z: 1 }), { type: 'candidate', source: 'accel' });
  const ev = still(d, 1040, 9000);
  assert.strictEqual(ev.type, 'crash'); assert.ok(ev.peakG >= 4);
});

test('phone drop (free fall first) is ignored', () => {
  const d = CG.createDetector();
  still(d, 0, 500);
  for (let t = 520; t <= 800; t += 20) d.feedAccel({ t, x: 0, y: 0, z: 0.05 });
  assert.strictEqual(d.feedAccel({ t: 820, x: 5, y: 0, z: 0 }).type, 'dismissed');
  assert.strictEqual(d.pending(), false);
});

test('bump then phone handled = dismissed', () => {
  const d = CG.createDetector();
  still(d, 0, 500);
  d.feedAccel({ t: 520, x: 0, y: 0, z: 5 });
  still(d, 540, 600);
  assert.strictEqual(d.feedAccel({ t: 1200, x: 0.8, y: 0.5, z: 1 }).type, 'dismissed');
});

test('car parked (GPS says not moving) = dismissed', () => {
  const d = CG.createDetector();
  d.feedSpeed({ t: 0, mph: 0 });
  assert.strictEqual(d.feedAccel({ t: 100, x: 0, y: 0, z: 6 }).type, 'dismissed');
});

test('GPS sudden stop 40->0 in 1 s then stays stopped = crash; normal stop does not trigger', () => {
  const d = CG.createDetector();
  d.feedSpeed({ t: 0, mph: 40 });
  assert.strictEqual(d.feedSpeed({ t: 1000, mph: 0 }).type, 'candidate');
  let ev = null; for (let t = 2000; t <= 10000; t += 1000) ev = d.feedSpeed({ t, mph: 0 }) || ev;
  assert.strictEqual(ev.type, 'crash');
  const n = CG.createDetector(); let any = null;
  [40, 33, 26, 19, 12, 6, 1, 0].forEach((m, i) => { any = n.feedSpeed({ t: i * 1000, mph: m }) || any; });
  assert.strictEqual(any, null);
});

test('prompt: 30 s, second 30 s, then alert', () => {
  assert.strictEqual(CG.promptState(0).prompt, 1); assert.strictEqual(CG.promptState(0).secondsLeft, 30);
  assert.strictEqual(CG.promptState(31000).prompt, 2); assert.strictEqual(CG.promptState(59999).phase, 'asking');
  assert.strictEqual(CG.promptState(60000).phase, 'alert');
});

test('contacts cleaned and capped; message fixed text with map link and not-911 wording', () => {
  const c = CG.cleanContacts([{ name: 'Mom', phone: '(555) 123-4567' }, { email: 'bad' }, ...Array(9).fill({ email: 'a@b.co' })]);
  assert.strictEqual(c.length, 5); assert.strictEqual(c[0].phone, '5551234567');
  const m = CG.alertMessage({ userName: 'Test', loc: { lat: 38.5, lon: -121.4, accuracyM: 12 }, at: 0, test: true });
  assert.match(m, /TEST ONLY/); assert.match(m, /maps\.google\.com\/\?q=38\.50000,-121\.40000/); assert.match(m, /not an emergency service/);
  assert.match(CG.NOT_911, /NOT a replacement for 911/);
});
