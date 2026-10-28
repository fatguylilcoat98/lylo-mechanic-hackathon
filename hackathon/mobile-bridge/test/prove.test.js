'use strict';
const test = require('node:test');
const assert = require('node:assert');
const p = require('../src/prove');

const okFetch = (body, status = 200) => async (url, init) => { okFetch.last = { url, init }; return { ok: status < 400, status, json: async () => body }; };

test('flag off by default', () => {
  assert.strictEqual(p.features({}).on, false);
  assert.strictEqual(p.features({ EXPO_PUBLIC_LYLO_PROVE: '1' }).on, true);
});

test('samplesSince: only readings after the lock, bad values dropped', () => {
  const s = p.samplesSince([{ atMs: 900, pid: 'RPM', value: 1 }, { atMs: 1500, pid: 'MISFIRE_COUNT_CYL3', value: 12 },
    { atMs: 2000, pid: 'RPM', value: NaN }, { atMs: 3000, dtc: 'p0303' }, null], 1000);
  assert.deepStrictEqual(s, [{ dt: 0.5, pid: 'MISFIRE_COUNT_CYL3', value: 12 }, { dt: 2, dtc: 'P0303' }]);
});

test('check/replay post to the prove routes', async () => {
  await p.check('abc', [{ dt: 1, pid: 'RPM', value: 700 }], { baseUrl: 'https://x', fetchImpl: okFetch({}) });
  assert.strictEqual(okFetch.last.url, 'https://x/api/v1/prove/check');
  assert.deepStrictEqual(JSON.parse(okFetch.last.init.body).session_id, 'abc');
  await p.replay('prove_misfire_synthetic', { baseUrl: 'https://x', fetchImpl: okFetch({}) });
  assert.strictEqual(okFetch.last.url, 'https://x/api/v1/prove/replay');
});

test('predictionView never upgrades: unknown or self-set status -> LOCKED', () => {
  assert.strictEqual(p.predictionView({ prediction: { text: 't', status: 'PROVEN' } }).status, 'LOCKED');
  assert.strictEqual(p.predictionView({ prediction: { text: 't', status: 'HELD', measured: 'x' } }).status, 'HELD');
  assert.strictEqual(p.predictionView({}), null);
});

test('replay badge cannot be hidden', () => {
  const s = p.asScan({ replay: { badge: 'REPLAY', label: 'SYNTHETIC misfire', synthetic: true }, detective: {} });
  assert.match(s.demoLabel, /^REPLAY · SYNTHETIC/);
  const s2 = p.asScan({ replay: { label: '' }, detective: { prediction_replay: true } });
  assert.match(s2.demoLabel, /^REPLAY · /);
  const s3 = p.asScan({ detective: { prediction_replay: true } });
  assert.match(s3.demoLabel, /^REPLAY · recorded session/);
  assert.strictEqual(p.asScan({ detective: {} }).demoLabel, null);
});
