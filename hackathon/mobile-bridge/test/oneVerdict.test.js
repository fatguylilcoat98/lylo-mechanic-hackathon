/* v0.7.5 one verdict, fail-closed (flag EXPO_PUBLIC_LYLO_ONE_VERDICT=1). Synthetic / replay fixtures only, no network. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const OV = require('../src/oneVerdict');
const VM = require('../src/viewModes');
const { buildV2 } = require('../src/ui2/model');
const { buildResults } = require('../src/resultsView');
const { asScan } = require('../src/prove');
const { DEMO_SCANS } = require('../../../baseline/mobile/src/data/demoScans');

const ON = { EXPO_PUBLIC_LYLO_ONE_VERDICT: '1' };
const OFF = {};
const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/v075', n + '.json'), 'utf8'));
const SERVER = ['truck', 'usedcar', 'overheat'];
const PROVE = ['prove_misfire_synthetic', 'prove_lean_fail_synthetic'];
const ALL_TITLES = Object.entries(OV.TITLES).map(([lv, t]) => [lv, t.title]);
const RAW = /SAFE_TO_DRIVE|INSPECT_SOON|DRIVE_SHORT_DISTANCE_ONLY|DO_NOT_DRIVE|kept_rule_level|detective_lower_ignored|LYLO_HACK_MUSE/;

// Every level any part of the screen model can put in front of the person.
function levelsShown(m, plain, mech, scan) {
  const out = [m.levelCode];
  OV.factsFromScan(scan).codes.forEach((c) => out.push(OV.codeLevel(c.code, c.status)));
  const text = JSON.stringify({ plain: plain && { ...plain, verdict: null }, actions: m.actions, why: m.verdict && m.verdict.why });
  ALL_TITLES.forEach(([lv, t]) => { if (text.includes(t)) out.push(lv); });
  if (/short distance|short way/i.test(text)) out.push('DRIVE_SHORT_DISTANCE_ONLY');
  if (/Leave it parked|towed/i.test(text)) out.push('DO_NOT_DRIVE');
  return out;
}
function assertHeadline(name, m, scan) {
  const plain = VM.buildPlain(m, scan, ON);
  const mech = VM.buildMechanic(m, scan);
  const shown = levelsShown(m, plain, mech, scan);
  const worst = OV.maxLevel(...shown);
  assert.ok(OV.rank(m.levelCode) >= OV.rank(worst), `${name}: headline ${m.levelCode} lower than ${worst} on screen`);
  assert.strictEqual(plain.verdict.title, OV.TITLES[m.levelCode].title, `${name}: Simple title matches the one table`);
  assert.strictEqual(mech.levelCode, m.levelCode, `${name}: Mechanic level is the same verdict`);
  return { plain, mech };
}

test('flag must be exactly "1"', () => {
  assert.strictEqual(OV.on(ON), true);
  ['', '0', 'true', '1 ', 'yes'].forEach((v) => assert.strictEqual(OV.on({ EXPO_PUBLIC_LYLO_ONE_VERDICT: v }), false));
  assert.strictEqual(OV.on(OFF), false);
});

test('headline starts at the rule level and only goes up', () => {
  assert.strictEqual(OV.decide('DO_NOT_DRIVE', { codes: [{ code: 'P0171', status: 'stored' }] }).level, 'DO_NOT_DRIVE');
  assert.strictEqual(OV.decide('SAFE_TO_DRIVE', {}).level, 'SAFE_TO_DRIVE');
  assert.strictEqual(OV.decide('bogus', {}).level, 'INSPECT_SOON', 'unknown rule level fails closed');
  assert.strictEqual(OV.decide('SAFE_TO_DRIVE', { codes: [{ code: 'P1ZZZ'.replace('ZZZ', '9A9'), status: 'pending' }] }).level, 'INSPECT_SOON', 'unknown code -> at least check soon');
  ['stored', 'pending', 'permanent'].forEach((st) => assert.ok(OV.rank(OV.decide('SAFE_TO_DRIVE', { codes: [{ code: 'P0171', status: st }] }).level) >= 1));
  assert.strictEqual(OV.decide('SAFE_TO_DRIVE', { codes: [{ code: 'P0302', status: 'pending' }] }).level, 'DRIVE_SHORT_DISTANCE_ONLY', 'orange exists');
  assert.strictEqual(OV.decide('SAFE_TO_DRIVE', { recentlyCleared: true }).level, 'INSPECT_SOON');
  assert.strictEqual(OV.decide('SAFE_TO_DRIVE', { incomplete: ['Catalyst'] }).level, 'INSPECT_SOON');
  assert.strictEqual(OV.decide('SAFE_TO_DRIVE', { coolantF: 79, trim: 33.6 }).level, 'INSPECT_SOON', 'cold engine + trim > 10%');
  assert.strictEqual(OV.decide('SAFE_TO_DRIVE', { coolantF: 190, trim: 4 }).level, 'SAFE_TO_DRIVE');
});

test('one title table: orange reads "Drive only short trips", no two levels share a title', () => {
  assert.strictEqual(OV.TITLES.DRIVE_SHORT_DISTANCE_ONLY.title, 'Drive only short trips');
  const t = Object.values(OV.TITLES).map((x) => x.title);
  assert.strictEqual(new Set(t).size, t.length);
});

test('saved demos (phone): headline never lower than anything on screen, Simple and Mechanic', () => {
  for (const [k, scan] of Object.entries(DEMO_SCANS)) {
    const m = VM.demoModel(scan, ON);
    assertHeadline('saved ' + k, m, scan);
  }
  assert.notStrictEqual(VM.demoModel(DEMO_SCANS.usedcar, ON).tone, 'green', 'used car with a pending code + cleared is never green');
  assert.strictEqual(VM.demoModel(DEMO_SCANS.checkengine, ON).levelCode, 'DRIVE_SHORT_DISTANCE_ONLY');
});

test('server demos + locked-guess proof replays: headline = server rule level, only raised', () => {
  for (const n of [...SERVER, ...PROVE]) {
    const body = fx(n);
    const sc = PROVE.includes(n) ? asScan(body) : { serverDiagnosis: { source: 'server', result: body } };
    const m = buildV2(sc, { screen: n === 'usedcar' ? 'usedcar' : 'codes', env: ON });
    assert.ok(OV.rank(m.levelCode) >= OV.rank(body.safety.level), n + ': never below the server');
    const { plain } = assertHeadline(n, m, OV.scanFromResult(body));
    assert.ok(!RAW.test(JSON.stringify({ ...plain, levelCode: null })), n + ': no raw codes in Simple text');
    if ((body.detective || {}).muse_status !== 'ok') assert.strictEqual(m.poweredBy, null, n + ': no "Powered by Meta AI" when AI did not run');
    if (OV.factsFromResult(body).codes.length) assert.ok(!/didn't find any problems/.test(m.verdict.why), n + ': no "no problems" with a code listed');
  }
});

test('truck: cold engine + high trim is not "Good to drive", and the reading says recheck warm', () => {
  const body = fx('truck');
  const m = buildV2({ serverDiagnosis: { source: 'server', result: body } }, { screen: 'codes', env: ON });
  assert.strictEqual(m.levelCode, 'INSPECT_SOON');
  const p = VM.buildPlain(m, OV.scanFromResult(body), ON);
  assert.ok(p.readings.some((r) => /still cold, so this reading is not reliable yet/.test(r)));
});

test('stubbed LIVE scan (not a demo): pending misfire on a SAFE server result is raised; Simple codes sorted worst first', () => {
  const live = { safety: { level: 'SAFE_TO_DRIVE', triggering_conditions: [] }, session_id: 'STUB',
    detective: { muse_status: 'off', ledger: [
      { id: 'dtc:P0171', type: 'dtc', code: 'P0171', status: 'stored' },
      { id: 'dtc:P0303', type: 'dtc', code: 'P0303', status: 'pending' },
      { id: 'pid:ENGINE_COOLANT_TEMP', name: 'ENGINE_COOLANT_TEMP', value: 190, unit: '°F' }] } };
  const m = buildV2({ serverDiagnosis: { source: 'server', result: live } }, { screen: 'codes', env: ON });
  assert.strictEqual(m.levelCode, 'DRIVE_SHORT_DISTANCE_ONLY');
  const scan = OV.scanFromResult(live);
  const { plain } = assertHeadline('live stub', m, scan);
  assert.deepStrictEqual(plain.codes.map((c) => c.code), ['P0303', 'P0171']);
  assert.strictEqual(m.poweredBy, null);
});

test('flag off: unchanged (old demoModel, old titles, Powered by Meta AI kept)', () => {
  const m = VM.demoModel(DEMO_SCANS.usedcar, OFF);
  assert.strictEqual(m.tone, 'green'); // documents the old fail-open behavior, flag off only
  const r = buildResults({ serverDiagnosis: { source: 'server', result: fx('truck') } }, { env: OFF });
  assert.strictEqual(r.levelCode, 'SAFE_TO_DRIVE');
  assert.strictEqual(r.poweredBy, 'Powered by Meta AI');
  assert.strictEqual(VM.buildPlain(VM.demoModel(DEMO_SCANS.checkengine, OFF), DEMO_SCANS.checkengine, OFF).verdict.title, 'Get it checked soon');
});
