// v0.7.1 collision AI + fault guidance (pure). Stub fetch, synthetic data.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../src/collision');
global.FormData = global.FormData || class { constructor() { this.p = []; } append(k, v) { this.p.push([k, v]); } };

test('flags: AI needs both COLLISION and COLLISION_AI', () => {
  assert.deepStrictEqual(C.features({}), { on: false, ai: false });
  assert.deepStrictEqual(C.features({ EXPO_PUBLIC_LYLO_COLLISION: '1' }), { on: true, ai: false });
  assert.deepStrictEqual(C.features({ EXPO_PUBLIC_LYLO_COLLISION_AI: '1' }), { on: false, ai: false });
  assert.deepStrictEqual(C.features({ EXPO_PUBLIC_LYLO_COLLISION: '1', EXPO_PUBLIC_LYLO_COLLISION_AI: '1' }), { on: true, ai: true });
});

test('fault guidance is fixed text with the required items', () => {
  assert.strictEqual(C.SAY.length, 6); assert.strictEqual(C.DONT_SAY.length, 6);
  assert.match(C.DONT_SAY.join(' '), /I'm sorry.*my fault/);
  assert.match(C.DONT_SAY.join(' '), /settle privately/);
  assert.match(C.SAY.join(' '), /police report number/);
  assert.match(C.FAULT_NOTE, /not legal advice/);
});

test('aiPhotos: never sends license/insurance, max 3', () => {
  const p = C.aiPhotos({ license: ['l'], insurance: ['i'], my_damage: ['a', 'a2'], other_damage: ['b'], plates: ['c'], scene: ['d'] });
  assert.deepStrictEqual(p.map((x) => x.id), ['my_damage', 'other_damage', 'plates']);
});

test('requestSummary ok / server error / offline never throw', async () => {
  let sent;
  const ok = async (url, o) => { sent = { url, o }; return { ok: true, json: async () => ({ collision_ai_status: 'ok', photos: [{ photo: 1, label: 'x', damage: 'dent' }], summary: 's', missing: ['m'] }) }; };
  const r = await C.requestSummary({ baseUrl: 'https://x.invalid/', appKey: 'k', fetchImpl: ok, photos: { my_damage: ['u1'] }, fields: { notes: 'n' } });
  assert.ok(r.ok); assert.strictEqual(r.ai.label, C.AI_LABEL);
  assert.match(sent.url, /\/api\/v1\/collision\/summary$/);
  const bad = await C.requestSummary({ baseUrl: 'https://x.invalid', fetchImpl: async () => ({ ok: false, json: async () => ({ missing: ['m'] }) }), photos: {}, fields: {} });
  assert.strictEqual(bad.ok, false);
  const off = await C.requestSummary({ baseUrl: 'https://x.invalid', fetchImpl: async () => { throw new Error('net'); }, photos: {}, fields: {} });
  assert.strictEqual(off.ok, false); assert.match(off.error, /still works/);
  assert.strictEqual((await C.requestSummary({ baseUrl: '', photos: {}, fields: {} })).ok, false);
});

test('report includes AI section only when given', () => {
  const ai = { label: C.AI_LABEL, photos: [{ photo: 1, label: 'Damage', damage: 'dent' }], summary: 'sum', missing: ['No photo of the scene'] };
  assert.doesNotMatch(C.buildReport({ at: 0, fields: {} }).body, /Meta AI/);
  const b = C.buildReport({ at: 0, fields: {}, ai }).body;
  assert.match(b, /Written by Meta AI: check it before sending/); assert.match(b, /No photo of the scene/);
});
