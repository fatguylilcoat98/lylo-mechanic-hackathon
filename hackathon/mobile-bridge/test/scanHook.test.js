'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { afterScan, configuredUrl } = require('../src/scanHook');

const scan = { codes: { stored: ['P0301'], pending: [], permanent: [] }, pids: { coolant_temp_f: 200 }, vin: 'SYNTHETICVIN00001' };

test('flag unset: returns the identical scan object, no fetch', async () => {
  let called = false;
  const out = await afterScan(scan, { env: {}, fetchImpl: () => { called = true; } });
  assert.strictEqual(out, scan);
  assert.strictEqual(called, false);
});

test('flag blank/whitespace counts as unset', async () => {
  assert.strictEqual(configuredUrl({ EXPO_PUBLIC_LYLO_SERVER_URL: '  ' }), null);
  assert.strictEqual(await afterScan(scan, { env: { EXPO_PUBLIC_LYLO_SERVER_URL: '' } }), scan);
});

test('flag set + server ok: attaches server diagnosis, original scan not mutated', async () => {
  const fetchImpl = async (url) => {
    assert.strictEqual(url, 'http://127.0.0.1:5088/api/v1/live/live');
    return { ok: true, status: 200, json: async () => ({ safety: { level: 'CAUTION' } }) };
  };
  const out = await afterScan(scan, { env: { EXPO_PUBLIC_LYLO_SERVER_URL: 'http://127.0.0.1:5088/' }, fetchImpl });
  assert.strictEqual(out.serverDiagnosis.source, 'server');
  assert.strictEqual(out.serverDiagnosis.result.safety.level, 'CAUTION');
  assert.strictEqual(scan.serverDiagnosis, undefined);
});

test('flag set + server down: offline fallback, never throws', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  const out = await afterScan(scan, { baseUrl: 'http://127.0.0.1:1', fetchImpl, offlineEngine: () => ['local'] });
  assert.strictEqual(out.serverDiagnosis.source, 'offline');
  assert.deepStrictEqual(out.serverDiagnosis.result, ['local']);
});

test('hook swallows unexpected errors', async () => {
  const out = await afterScan(scan, { baseUrl: 'http://x', fetchImpl: async () => { throw new Error('x'); }, offlineEngine: () => { throw new Error('boom'); } });
  assert.strictEqual(out.serverDiagnosis.source, 'offline');
  assert.match(out.serverDiagnosis.error, /hook error/);
});
