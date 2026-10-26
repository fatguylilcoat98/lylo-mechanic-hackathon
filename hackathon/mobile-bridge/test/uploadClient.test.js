'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { diagnoseScan } = require('../src/uploadClient');
const { DEMO_SCANS } = require('../../../baseline/mobile/src/data/demoScans');

const okFetch = (body, status = 200) => async (url, init) => {
  okFetch.last = { url, init };
  return { ok: status < 400, status, json: async () => body };
};

test('server success returns server result and posts to /api/v1/live/live', async () => {
  const f = okFetch({ safety: { level: 'INSPECT_SOON' } });
  const r = await diagnoseScan(DEMO_SCANS.checkengine, { baseUrl: 'http://x/', fetchImpl: f });
  assert.strictEqual(r.source, 'server');
  assert.strictEqual(okFetch.last.url, 'http://x/api/v1/live/live');
  assert.strictEqual(JSON.parse(okFetch.last.init.body).raw_dtcs[0].code, 'P0302');
});

test('no server configured uses the on-phone engine', async () => {
  const r = await diagnoseScan(DEMO_SCANS.checkengine, {});
  assert.strictEqual(r.source, 'offline');
  assert.ok(Array.isArray(r.result) && r.result.length >= 2);
});

test('network error falls back offline', async () => {
  const r = await diagnoseScan(DEMO_SCANS.usedcar, { baseUrl: 'http://x', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.strictEqual(r.source, 'offline');
  assert.match(r.error, /unreachable/);
});

test('slow server times out and falls back offline', async () => {
  const hang = () => new Promise(() => {});
  const t0 = Date.now();
  const r = await diagnoseScan(DEMO_SCANS.usedcar, { baseUrl: 'http://x', fetchImpl: hang, timeoutMs: 50 });
  assert.strictEqual(r.source, 'offline');
  assert.match(r.error, /longer than 50 ms/);
  assert.ok(Date.now() - t0 < 2000);
});

test('400 from server falls back offline and keeps the reasons', async () => {
  const r = await diagnoseScan(DEMO_SCANS.usedcar, { baseUrl: 'http://x', fetchImpl: okFetch({ error: 'Invalid', errors: ['bad name'] }, 400) });
  assert.strictEqual(r.source, 'offline');
  assert.strictEqual(r.status, 400);
  assert.match(r.error, /bad name/);
});

test('reply without a safety level is not trusted', async () => {
  const r = await diagnoseScan(DEMO_SCANS.usedcar, { baseUrl: 'http://x', fetchImpl: okFetch({ hypotheses: [] }) });
  assert.strictEqual(r.source, 'offline');
});

test('app key is sent as X-LYLO-App-Key only when configured', async () => {
  let seen;
  const f = async (url, init) => { seen = init.headers; return { ok: true, status: 200, json: async () => ({ safety: { level: 'SAFE_TO_DRIVE' } }) }; };
  await diagnoseScan(DEMO_SCANS.usedcar, { baseUrl: 'http://x', fetchImpl: f, appKey: 'k123' });
  assert.strictEqual(seen['X-LYLO-App-Key'], 'k123');
  await diagnoseScan(DEMO_SCANS.usedcar, { baseUrl: 'http://x', fetchImpl: f });
  assert.ok(!('X-LYLO-App-Key' in seen));
});

for (const code of [401, 429, 503]) {
  test(`${code} from server falls back offline`, async () => {
    const r = await diagnoseScan(DEMO_SCANS.usedcar, { baseUrl: 'http://x', fetchImpl: okFetch({ error: 'nope', errors: [] }, code) });
    assert.strictEqual(r.source, 'offline');
    assert.strictEqual(r.status, code);
    assert.ok(r.result);
  });
}
