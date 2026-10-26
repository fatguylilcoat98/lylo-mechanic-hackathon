'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { CODES, BY_CODE } = require('../data/dtcCodes');
const { buildCodeResult, analyzeCodes, searchCodes } = require('../engine/diagnose');
const { assessUsedCar } = require('../engine/usedCarCheck');
const { estimate } = require('../engine/pricing');
const { DEMO_SCANS } = require('../data/demoScans');

test('Code library: 100+ generic P-codes, all fields valid', () => {
  assert.ok(CODES.length >= 100, 'have ' + CODES.length);
  const seen = new Set();
  for (const c of CODES) {
    assert.match(c.code, /^P[0-3][0-9A-F]{3}$/);
    assert.ok(!seen.has(c.code), 'dup ' + c.code); seen.add(c.code);
    assert.ok(['easy', 'moderate', 'pro'].includes(c.diff), c.code);
    assert.ok(['ok', 'soon', 'stop'].includes(c.urg), c.code);
    assert.ok(c.t && c.plain && c.fix && c.causes.length && c.check.length, c.code);
    assert.ok(c.parts[0] <= c.parts[1] && c.hrs[0] <= c.hrs[1], c.code);
  }
  for (const must of ['P0420', 'P0171', 'P0300', 'P0301', 'P0442', 'P0455', 'P0128', 'P0101', 'P0011', 'P0700']) assert.ok(BY_CODE[must], must);
});

test('Price estimate = parts + labor x rate, labelled as estimate', () => {
  const e = estimate({ parts: [100, 200], hrs: [1, 2], diff: 'moderate' });
  assert.deepStrictEqual(e.shop, [250, 680]); // 100*1.3+1*120=250 ; 200*1.6+2*180=680
  assert.deepStrictEqual(e.diy, [100, 200]);
  const r = buildCodeResult('p0420');
  assert.strictEqual(r.known, true);
  assert.match(r.estimateNote, /estimate, not a quote/i);
  assert.match(r.shopScript, /P0420/);
  assert.ok(r.redFlags.length >= 2);
});

test('Unknown and manufacturer codes are handled', () => {
  assert.strictEqual(buildCodeResult('P1456').known, false);
  assert.match(buildCodeResult('P1456').title, /Manufacturer/);
  assert.strictEqual(buildCodeResult('C0035').known, false);
});

test('Search finds codes by number and words', () => {
  assert.strictEqual(searchCodes('P0420')[0].code, 'P0420');
  assert.ok(searchCodes('gas cap').length >= 3);
});

test('Used-car demo: recently cleared codes are flagged red', () => {
  const a = assessUsedCar(DEMO_SCANS.usedcar);
  assert.strictEqual(a.verdict.level, 'red');
  assert.strictEqual(a.recentlyCleared, 'likely');
  assert.ok(a.findings.some((f) => /RECENTLY CLEARED/.test(f.title)));
  assert.strictEqual(a.counters.miSinceClear, 12);
  assert.deepStrictEqual(a.codes.map((c) => c.code).sort(), ['P0171', 'P0420']);
});

test('Check-engine demo: MIL + driven with MIL', () => {
  const a = assessUsedCar(DEMO_SCANS.checkengine);
  assert.strictEqual(a.verdict.level, 'red');
  assert.strictEqual(a.recentlyCleared, 'no');
  assert.ok(a.findings.some((f) => /Check-engine light is ON/.test(f.title)));
  assert.ok(a.findings.some((f) => /130 miles with the check-engine/.test(f.title)));
  const codes = analyzeCodes(DEMO_SCANS.checkengine);
  assert.strictEqual(codes.length, 2); // P0302 de-duplicated across stored/pending/permanent
  assert.deepStrictEqual(codes.find((c) => c.code === 'P0302').alsoKinds, ['stored', 'pending', 'permanent']);
});

test('Clean car looks good', () => {
  const clean = { ...DEMO_SCANS.checkengine, stored: [], pending: [], permanent: [], monitor: { ...DEMO_SCANS.checkengine.monitor, milOn: false, dtcCount: 0 }, pids: { dist_since_clear_km: 9000, warmups_since_clear: 255, dist_mil_on_km: 0, module_voltage: 14.2, rpm: 700 } };
  const a = assessUsedCar(clean);
  assert.strictEqual(a.verdict.level, 'green');
});
