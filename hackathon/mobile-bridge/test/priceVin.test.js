const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const P = require('../src/priceLinks');
const V = require('../src/vin');
const { buildResults } = require('../src/resultsView');
const { analyzeCodes } = require('../../../baseline/mobile/src/engine/diagnose');

const CIVIC = { name: '2015 Honda Civic', year: 2015, make: 'Honda', model: 'Civic', engine: '1.8L 4-cyl Gasoline', caveat: V.CAVEAT, source: 'NHTSA vPIC VIN decoder' };
const SAMPLE_VIN = '1HGCM82633A004352'; // NHTSA's published sample VIN

test('price links: five stores, public search URLs only, no tracking or affiliate tags', () => {
  const p = P.forJob('engine_air_filter', CIVIC);
  assert.deepStrictEqual(p.buttons.map((b) => b.store), ['AutoZone', "O'Reilly", 'Advance Auto Parts', 'NAPA', 'RockAuto (online)']);
  for (const b of p.buttons) {
    assert.match(b.url, /^https:\/\/(www|shop)\.[a-z]+\.com\//);
    assert.doesNotMatch(b.url, /utm_|aff|ref=|partner|tag=|clickid/i);
  }
  assert.ok(p.buttons[0].url.endsWith('searchText=2015%20Honda%20Civic%20engine%20air%20filter'));
  assert.strictEqual(p.buttons[4].url, 'https://www.rockauto.com/en/catalog/honda,2015,civic');
  assert.strictEqual(p.estimate, "Estimate: not in LYLO's price data");
});

test('price links without a vehicle: no RockAuto (needs y/m/m), asks for the VIN', () => {
  const p = P.forJob('wipers', null);
  assert.strictEqual(p.buttons.length, 4);
  assert.match(p.note, /Add your VIN/);
});

test('battery estimate comes from baseline repair_costs.json, labeled Estimate', () => {
  const rc = require(path.join(__dirname, '../../../baseline/backend/data/pricing/repair_costs.json')).weak_battery;
  assert.deepStrictEqual(P.REPAIR_COSTS.weak_battery, { parts: [rc.diy_parts_low, rc.diy_parts_high],
    shop: [rc.shop_parts_low + rc.shop_labor_low, rc.shop_parts_high + rc.shop_labor_high] });
  assert.strictEqual(P.forJob('battery', CIVIC).estimate, 'Estimate: $80–$200 for the part, $110–$280 at a shop');
});

test('part names only when the fix names a part to buy', () => {
  assert.strictEqual(P.partFromFix('Replace crankshaft position sensor'), 'crankshaft position sensor');
  assert.strictEqual(P.partFromFix('Replace MAP sensor or fix vacuum leak'), 'MAP sensor');
  assert.strictEqual(P.partFromFix('Find and fix vacuum leak (smoke test)'), null);
  assert.strictEqual(P.partFromFix('Professional diagnosis'), null);
  assert.strictEqual(P.partFromCause('Faulty MAP sensor'), 'MAP sensor');
  assert.strictEqual(P.partFromCause('Wiring or connector'), null);
  const [c] = analyzeCodes({ stored: ['P0335'] });
  const p = P.forCode(c, CIVIC);
  assert.strictEqual(p.query, '2015 Honda Civic crankshaft position sensor');
  assert.match(p.estimate, /^Estimate: \$/);
});

test('VIN check digit: valid accepted, one wrong character rejected, I/O/Q rejected, never fixed', () => {
  assert.deepStrictEqual(V.validateVin(' 1hgcm82633a004352 ').ok, true);
  assert.strictEqual(V.validateVin('1HGCM82633A004353').ok, false);
  assert.match(V.validateVin('1HGCM8263OA004352').reason, /I, O or Q/);
  assert.match(V.validateVin('1HGCM8263').reason, /17 characters/);
  assert.strictEqual(V.maskVin(SAMPLE_VIN), '1HG**************');
});

function fakeFetch(json, status = 200) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return { status, json: async () => json }; };
  f.calls = calls;
  return f;
}

test('decodeVin: ok -> summary with factory-engine caveat and labeled recalls', async () => {
  const f = fakeFetch({ vin_status: 'ok', vehicle: { year: 2003, make: 'Honda', model: 'Accord', engine: '3.0L 6-cyl Gasoline', source: 'NHTSA vPIC VIN decoder' },
    recalls: { status: 'ok', count: 2, components: ['Air Bags', 'Electrical System'], source: 'NHTSA recalls by year/make/model (not checked against this exact VIN)', check_url: 'https://www.nhtsa.gov/recalls' } });
  const r = await V.decodeVin(SAMPLE_VIN, { baseUrl: 'https://x', appKey: 'k', fetchImpl: f });
  assert.strictEqual(f.calls[0].url, 'https://x/api/v1/vin/decode');
  const s = V.vehicleSummary(r);
  assert.strictEqual(s.name, '2003 Honda Accord');
  assert.strictEqual(s.caveat, 'assumes the factory engine (not swapped)');
  assert.match(s.recalls.text, /^2 recalls for your model \(2003 Honda Accord\)/);
  assert.match(s.recalls.source, /NHTSA/);
});

test('decodeVin: invalid never hits the network; server down fails open', async () => {
  const f = fakeFetch({});
  assert.strictEqual((await V.decodeVin('1HGCM82633A004353', { baseUrl: 'https://x', fetchImpl: f })).status, 'invalid');
  assert.strictEqual(f.calls.length, 0);
  const down = async () => { throw new Error('net'); };
  const r = await V.decodeVin(SAMPLE_VIN, { baseUrl: 'https://x', fetchImpl: down });
  assert.strictEqual(r.status, 'offline');
  assert.strictEqual(V.vehicleSummary(r), null);
});

test('readVinPhoto: accepts only a VIN that passes the check digit', async () => {
  class FD { append() {} }
  const good = await V.readVinPhoto({ uri: 'x' }, { baseUrl: 'https://x', fetchImpl: fakeFetch({ vin_status: 'read', vin: SAMPLE_VIN }), FormDataImpl: FD });
  assert.deepStrictEqual([good.status, good.vin], ['read', SAMPLE_VIN]);
  const bad = await V.readVinPhoto({ uri: 'x' }, { baseUrl: 'https://x', fetchImpl: fakeFetch({ vin_status: 'read', vin: '1HGCM82633A004353' }), FormDataImpl: FD });
  assert.strictEqual(bad.status, 'not_read');
  assert.match(bad.message, /Type it in instead/);
});

test('results: vehicle name + price buttons in Simple view, no trouble codes in them', () => {
  const scan = JSON.parse(JSON.stringify(require('./fixtures/truck.json').scan));
  const codes = analyzeCodes({ stored: ['P0335'] });
  const m = buildResults(scan, { codes, screen: 'codes', vehicle: CIVIC });
  assert.strictEqual(m.vehicle.name, '2015 Honda Civic');
  assert.match(m.vehicle.caveat, /factory engine/);
  assert.ok(m.prices.length >= 1);
  for (const p of m.prices) assert.doesNotMatch(JSON.stringify([p.title, p.estimate]), /\b[PBCU][0-9A-F]{4}\b/);
  assert.strictEqual(m.mechanic.vehicle.name, '2015 Honda Civic');
  const none = buildResults(JSON.parse(JSON.stringify(require('./fixtures/truck.json').scan)), { codes, screen: 'codes' });
  assert.strictEqual(none.vehicle, null);
});
