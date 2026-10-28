'use strict';
const test = require('node:test');
const assert = require('node:assert');
const d = require('../src/demo');

const okFetch = (body, status = 200) => async (url, init) => { okFetch.last = { url, init }; return { ok: status < 400, status, json: async () => body }; };

test('flag', () => {
  assert.strictEqual(d.features({}).on, false);
  assert.strictEqual(d.features({ EXPO_PUBLIC_LYLO_DEMO: '1' }).on, true);
});

test('replay: posts case id with app key header; no server = clear message', async () => {
  const r = await d.replay('truck', { baseUrl: 'https://x/', appKey: 'k', fetchImpl: okFetch({ a: 1 }) });
  assert.ok(r.ok);
  assert.strictEqual(okFetch.last.url, 'https://x/api/v1/demo/replay');
  assert.deepStrictEqual(JSON.parse(okFetch.last.init.body), { case: 'truck' });
  assert.strictEqual(okFetch.last.init.headers['X-LYLO-App-Key'], 'k');
  assert.strictEqual((await d.replay('truck', { baseUrl: null })).error, d.MSG.noServer);
  assert.strictEqual((await d.replay('truck', { baseUrl: 'https://x', fetchImpl: okFetch({}, 429) })).error, d.MSG.busy);
  assert.strictEqual((await d.replay('truck', { baseUrl: 'https://x', fetchImpl: async () => { throw new Error('net'); } })).error, d.MSG.offline);
});

test('replayView: real receipt numbers only when Muse ran', () => {
  const ev = require('../../server/evidence/detective_cold_engine_truck_like.json').response;
  const v = d.replayView({ ...ev, demo: { title: 't', source: 's' } });
  assert.strictEqual(v.museOk, true);
  assert.strictEqual(v.receipt.model, 'muse-spark-1.3');
  assert.strictEqual(v.receipt.seconds, 7.4);
  assert.strictEqual(v.receipt.cited, 15);
  assert.strictEqual(v.receipt.ledger, 19);
  assert.strictEqual(v.causes.length, 3);
  assert.strictEqual(v.level, 'SAFE_TO_DRIVE');
  const off = d.replayView({ safety: { level: 'EMERGENCY_STOP_IMMEDIATELY' }, detective: { muse_status: 'off (LYLO_HACK_MUSE is not 1)', rule_safety_level: 'EMERGENCY_STOP_IMMEDIATELY' } });
  assert.strictEqual(off.receipt, null);
  assert.deepStrictEqual(off.causes, []);
});

test('proofView: both verdicts, winner, simulated label', () => {
  const v = d.proofView({ proof: { label: 'Simulated AI answer for this test (no AI model was called)', simulated: true, ai_verdict: 'SAFE_TO_DRIVE',
    rules_verdict: 'EMERGENCY_STOP_IMMEDIATELY', final_verdict: 'EMERGENCY_STOP_IMMEDIATELY', winner: 'rules', safety_action: 'detective_lower_ignored' } });
  assert.strictEqual(v.winner, 'Rules');
  assert.ok(v.simulated);
  assert.match(v.label, /Simulated/);
  assert.notStrictEqual(v.aiText, v.rulesText);
});
