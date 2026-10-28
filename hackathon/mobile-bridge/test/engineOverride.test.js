// v0.4.8 "Not my engine?" (owner-set engine). Synthetic data only.
const test = require('node:test');
const assert = require('node:assert');
global.FormData = class { constructor() { this.f = []; } append(k, v) { this.f.push([k, v]); } get(k) { const x = this.f.find((e) => e[0] === k); return x ? x[1] : null; } };
const EO = require('../src/engineOverride');
const { scanToLivePayload } = require('../src/scanToLive');
const N = require('../src/noAdapter');
const V = require('../src/vin');
const D = require('../src/dashVoice');
const H = require('../src/photoHelper');

const VIN = '1HGCM82633A004352'; // NHTSA's published sample VIN (synthetic stand-in)
const ON = { EXPO_PUBLIC_LYLO_ENGINE_OVERRIDE: '1' };
const SCAN = { vin: VIN, vehicle: { year: 1998, make: 'Ford' }, dtcs: [], pids: {}, monitor: null, protocol: '6', adapter: 'x' };
const mem = () => { const m = {}; return { m, getItem: async (k) => (k in m ? m[k] : null), setItem: async (k, v) => { m[k] = v; }, removeItem: async (k) => { delete m[k]; } }; };
const withEnv = async (env, fn) => { const old = process.env.EXPO_PUBLIC_LYLO_ENGINE_OVERRIDE; if (env) process.env.EXPO_PUBLIC_LYLO_ENGINE_OVERRIDE = '1'; else delete process.env.EXPO_PUBLIC_LYLO_ENGINE_OVERRIDE; try { return await fn(); } finally { if (old === undefined) delete process.env.EXPO_PUBLIC_LYLO_ENGINE_OVERRIDE; else process.env.EXPO_PUBLIC_LYLO_ENGINE_OVERRIDE = old; } };
const capture = (body) => { const seen = []; const f = async (url, opts) => { seen.push({ url, opts }); return { ok: true, status: 200, json: async () => body }; }; f.seen = seen; return f; };

test('flag: off by default, on only for "1"', () => {
  assert.strictEqual(EO.features({}).on, false);
  assert.strictEqual(EO.features({ EXPO_PUBLIC_LYLO_ENGINE_OVERRIDE: 'true' }).on, false);
  assert.strictEqual(EO.features(ON).on, true);
});

test('makeOverride / label: cleaned, capped, readable', () => {
  assert.strictEqual(EO.makeOverride('', '  ', VIN), null);
  const o = EO.makeOverride('gas', ' 6.8L  V10 <Triton> ', VIN);
  assert.strictEqual(o.engine, '6.8L V10 Triton');
  assert.strictEqual(o.fuel, 'gas');
  assert.strictEqual(EO.label(o), '6.8L V10 Triton (Gas)');
  assert.strictEqual(EO.label(EO.makeOverride('diesel', '', VIN)), 'Diesel');
  assert.strictEqual(EO.label(EO.makeOverride('', '7.3 Diesel', VIN)), '7.3 Diesel');
  assert.strictEqual(EO.makeOverride('rocket', 'x'.repeat(200), VIN).engine.length, EO.MAX_ENGINE);
});

test('save/load round trip next to the VIN data', async () => {
  const st = mem();
  const o = EO.makeOverride('gas', '6.8L V10 Triton', VIN);
  await EO.save(st, o);
  assert.ok(st.m[EO.KEY]);
  EO.setCurrent(null);
  assert.deepStrictEqual(await EO.load(st), o);
  await EO.save(st, null);
  assert.strictEqual(st.m[EO.KEY], undefined);
  assert.strictEqual(await EO.load(st), null);
});

test('flag off: scan payload byte-identical even with a saved override', async () => {
  EO.setCurrent(null);
  const before = JSON.stringify(scanToLivePayload(SCAN, {}));
  EO.setCurrent(EO.makeOverride('gas', '6.8L V10 Triton', VIN));
  await withEnv(false, async () => { assert.strictEqual(JSON.stringify(scanToLivePayload(SCAN, {})), before); });
  assert.deepStrictEqual(EO.fieldsFor(VIN, {}), {});
});

test('flag on: scan payload carries the owner engine, marked user-set', async () => {
  EO.setCurrent(EO.makeOverride('gas', '6.8L V10 Triton', VIN));
  const vp = scanToLivePayload(SCAN, { env: ON }).vehicle_profile;
  assert.strictEqual(vp.engine_user, '6.8L V10 Triton');
  assert.strictEqual(vp.fuel_user, 'gas');
  assert.strictEqual(vp.engine_source, 'user');
  // a different car's VIN never gets this owner's engine
  assert.deepStrictEqual(EO.fieldsFor('2T1BURHE0JC000000', ON), {});
});

test('no-adapter, dash, voice and photo helper requests send it (flag on) and not (flag off)', async () => {
  EO.setCurrent(EO.makeOverride('gas', '6.8L V10 Triton', VIN));
  const veh = { vin: VIN, year: 1998, make: 'Ford', model: 'E-450' };
  const photo = { uri: 'file:///x.jpg' };
  const audio = { uri: 'file:///q.aac' };
  for (const on of [false, true]) {
    await withEnv(on, async () => {
      const f = capture({ final_safety_level: 'SAFE_TO_DRIVE' });
      await N.requestCheck({ baseUrl: 'https://s', fetchImpl: f, text: 'noise', vehicle: veh });
      await D.requestDash({ baseUrl: 'https://s', fetchImpl: f, photo, scan: SCAN });
      await D.requestVoice({ baseUrl: 'https://s', fetchImpl: f, audio, scan: SCAN });
      await H.requestHelper({ baseUrl: 'https://s', fetchImpl: f, job: 'battery', photo, vin: VIN });
      assert.strictEqual(f.seen.length, 4);
      const [na, dash, voice, helper] = f.seen.map((x) => x.opts.body);
      assert.strictEqual(na.get('engine_user'), on ? '6.8L V10 Triton' : null);
      assert.strictEqual(na.get('engine_source'), on ? 'user' : null);
      assert.strictEqual(helper.get('fuel_user'), on ? 'gas' : null);
      for (const form of [dash, voice]) {
        const vp = JSON.parse(form.get('scan')).vehicle_profile;
        assert.strictEqual(vp.engine_user, on ? '6.8L V10 Triton' : undefined);
      }
    });
  }
});

test('decodeVin keeps the server engine hint only when the server sends one', async () => {
  const veh = { year: 1998, make: 'Ford', model: 'E-450', engine: '10.3L 6-cyl Diesel' };
  const plain = await V.decodeVin(VIN, { baseUrl: 'https://s', fetchImpl: capture({ vin_status: 'ok', vehicle: veh }) });
  assert.strictEqual('engineHint' in plain, false);
  const hinted = await V.decodeVin(VIN, { baseUrl: 'https://s', fetchImpl: capture({ vin_status: 'ok', vehicle: veh, engine_check_hint: 'may be wrong for this VIN' }) });
  assert.strictEqual(hinted.engineHint, 'may be wrong for this VIN');
});
