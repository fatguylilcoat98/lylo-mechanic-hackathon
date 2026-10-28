const test = require('node:test');
const assert = require('node:assert');
const N = require('../src/noAdapter');
const cases = require('./fixtures/symptom_cases.json');

global.FormData = class { constructor() { this.f = []; } append(k, v) { this.f.push([k, v]); } get(k) { const x = this.f.find((e) => e[0] === k); return x ? x[1] : null; } };
const reply = (status, body) => async (url, init) => { reply.last = { url, init }; return { ok: status < 400, status, json: async () => body }; };

test('flag: off unless EXPO_PUBLIC_LYLO_NO_ADAPTER=1', () => {
  assert.deepStrictEqual(N.features({}), { on: false, server: false });
  assert.deepStrictEqual(N.features({ EXPO_PUBLIC_LYLO_NO_ADAPTER: '1' }), { on: true, server: false });
  assert.deepStrictEqual(N.features({ EXPO_PUBLIC_LYLO_NO_ADAPTER: '1', EXPO_PUBLIC_LYLO_SERVER_URL: 'https://x' }), { on: true, server: true });
});

test('phone rules match the server rules (shared sentences)', () => {
  for (const [text, want] of Object.entries(cases)) assert.strictEqual(N.localLevel(text), want, text);
});

test('never safe to drive with no data', () => { assert.notStrictEqual(N.localLevel(''), 'SAFE_TO_DRIVE'); });

test('parseCodes', () => {
  assert.deepStrictEqual(N.parseCodes('p0171, P0300 xyz p0171'), { good: ['P0171', 'P0300'], bad: ['XYZ'] });
});

test('requestCheck posts text, codes, vehicle', async () => {
  const f = reply(200, { final_safety_level: 'DO_NOT_DRIVE' });
  const r = await N.requestCheck({ baseUrl: 'https://s/', appKey: 'k', fetchImpl: f, text: 'smoke', codes: ['P0300'], vehicle: { year: 2012, make: 'Honda' } });
  assert.ok(r.ok);
  assert.strictEqual(reply.last.url, 'https://s/api/v1/noadapter/check');
  assert.strictEqual(reply.last.init.body.get('codes'), 'P0300');
  assert.strictEqual(reply.last.init.body.get('make'), 'Honda');
  assert.strictEqual(reply.last.init.headers['X-LYLO-App-Key'], 'k');
});

test('no server = offline message, local rules stand', async () => {
  const r = await N.requestCheck({ baseUrl: '', text: 'x' });
  const v = N.checkView(r, 'DO_NOT_DRIVE');
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.level, 'DO_NOT_DRIVE');
});

test('checkView never lowers the phone level and hides unverified answers', () => {
  const v = N.checkView({ ok: true, body: { final_safety_level: 'SAFE_TO_DRIVE', answer: { text: 'fine', status: 'unverified_answer_withheld' }, unverified_claims: [{}] } }, 'DO_NOT_DRIVE');
  assert.strictEqual(v.level, 'DO_NOT_DRIVE');
  assert.strictEqual(v.answer, null);
  assert.ok(v.withheldText);
  assert.strictEqual(v.unverified, 1);
  assert.match(v.confidenceNote, /lower/);
});

test('checkView can raise', () => {
  const v = N.checkView({ ok: true, body: { final_safety_level: 'TOW_RECOMMENDED', answer: { text: 'tow it', status: 'verified' } } }, 'INSPECT_SOON');
  assert.strictEqual(v.level, 'TOW_RECOMMENDED');
  assert.strictEqual(v.answer, 'tow it');
});

test('server errors map to messages', async () => {
  const v = N.checkView(await N.requestCheck({ baseUrl: 'https://s', fetchImpl: reply(503, {}) }), null);
  assert.match(v.message, /turned off/);
});

test('OBDLink card: official links only, no prices, says app works without one', () => {
  const s = JSON.stringify(N.OBDLINK);
  assert.ok(!/\$|USD|price:|affiliate=|\?ref=|tag=/i.test(s.replace(/current prices/, '')));
  for (const m of N.OBDLINK.models) assert.match(m.url, /^https:\/\/www\.obdlink\.com\/products\/obdlink-[a-z]+\/$/);
  assert.deepStrictEqual(N.OBDLINK.models.map((m) => m.name), ['OBDLink CX', 'OBDLink MX+', 'OBDLink EX']);
  assert.match(N.OBDLINK.worksWithout, /without an adapter/);
});

test('codeFloor: red code = do not drive, otherwise inspect soon (never safe)', () => {
  assert.strictEqual(N.codeFloor({ level: 'DO NOT DRIVE' }), 'DO_NOT_DRIVE');
  assert.strictEqual(N.codeFloor({ level: 'SAFE TO DRIVE' }), 'INSPECT_SOON');
});
