// v0.5.2: EXPO_PUBLIC_LYLO_DTC_EXTRA (curated P0037/P2241 + generic titles). Flag off = old library.
const test = require('node:test');
const assert = require('node:assert');

function fresh(flag) {
  for (const k of Object.keys(require.cache)) if (/src[\\/](data|engine)[\\/]/.test(k)) delete require.cache[k];
  if (flag) process.env.EXPO_PUBLIC_LYLO_DTC_EXTRA = '1'; else delete process.env.EXPO_PUBLIC_LYLO_DTC_EXTRA;
  return require('../engine/diagnose');
}

test('flag off: P0037 unknown, same as before', () => {
  const d = fresh(false);
  const r = d.buildCodeResult('P0037');
  assert.strictEqual(r.known, false);
  assert.strictEqual(r.title, "Code not in LYLO's library yet");
  assert.strictEqual(r.officialTitle, null);
});

test('flag on: corrected P0037 / P2241 wording', () => {
  const d = fresh(true);
  assert.strictEqual(d.buildCodeResult('P0037').title, 'HO2S Heater Control Circuit Low (Bank 1 Sensor 2)');
  assert.strictEqual(d.buildCodeResult('p2241').title, 'O2 Sensor Positive Current Control Circuit Low (Bank 2 Sensor 1)');
  assert.strictEqual(d.buildCodeResult('P0037').known, true);
});

test('flag on: generic titles for P/B/C/U, unknown codes degrade gracefully', () => {
  const d = fresh(true);
  for (const c of ['U0100', 'C0035', 'B0001', 'P2096', 'P0455']) {
    const r = d.buildCodeResult(c);
    assert.ok(r.title && !/not in LYLO/.test(r.title), c);
  }
  const u = d.buildCodeResult('U0100');
  assert.strictEqual(u.known, false);
  assert.match(u.plain, /standard meaning is "Lost Communication With ECM\/PCM A"/);
  const z = d.buildCodeResult('P0ZZZ');
  assert.strictEqual(z.title, "Code not in LYLO's library yet");
  assert.ok(z.check.length > 0);
  fresh(false);
});

test('titles file: > 9000 codes, valid shape, MIT notice present', () => {
  const j = require('../data/dtcTitles.json');
  const keys = Object.keys(j.titles);
  assert.ok(keys.length > 9000);
  assert.ok(keys.every((k) => /^[PBCU][0-9A-F]{4}$/.test(k)));
  assert.ok(require('fs').readFileSync(require('path').join(__dirname, '../data/DTC_TITLES_LICENSE.txt'), 'utf8').startsWith('MIT License'));
});
