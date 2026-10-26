'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { detectiveView, itemLabel } = require('../src/detectiveView');

const EVID = path.join(__dirname, '..', '..', 'server', 'evidence');
const real = (name) => JSON.parse(fs.readFileSync(path.join(EVID, `detective_${name}.json`), 'utf8')).response;
const wrap = (result, source = 'server') => ({ serverDiagnosis: { source, result } });

const LEDGER = [
  { id: 'dtc:P0171:permanent', type: 'dtc', code: 'P0171', status: 'permanent' },
  { id: 'clr:flag', type: 'codes_cleared', value: true },
  { id: 'pid:WARMUPS_SINCE_CLEAR', type: 'codes_cleared_counter', name: 'WARMUPS_SINCE_CLEAR', value: 3, unit: '' },
  { id: 'rule:safety', type: 'rule_safety', level: 'DRIVE_SHORT_DISTANCE_ONLY' },
  { id: 'photo:oil_pressure:red', type: 'photo_warning_light', source: 'photo', name: 'oil_pressure', color: 'red', confidence: 'high' },
];
const det = (over = {}) => ({
  muse_status: 'ok', ledger: LEDGER, recently_cleared: true, safety_action: 'agreed',
  rule_safety_level: 'DRIVE_SHORT_DISTANCE_ONLY',
  hypotheses: [
    { rank: 2, cause: 'MAF', confidence: 'medium', reasoning: 'r2', next_check: 'clean MAF', cites: ['dtc:P0171:permanent'] },
    { rank: 1, cause: 'Vacuum leak', confidence: 'high', reasoning: 'r1', next_check: 'smoke test', cites: ['dtc:P0171:permanent', 'pid:WARMUPS_SINCE_CLEAR'] },
  ],
  explanation: { text: 'Runs lean.', cites: ['dtc:P0171:permanent'] },
  cleared_codes_warning: { text: 'Codes were wiped 3 warm-ups ago.', cites: ['clr:flag', 'pid:WARMUPS_SINCE_CLEAR'] },
  unverified_claims: [{ kind: 'hypothesis', claim: { cause: 'Bad O2 sensor', cites: ['pid:O2_SENSOR_B1S1'] }, missing_ids: ['pid:O2_SENSOR_B1S1'] }],
  receipt: { model: 'muse-spark-1.3', latency_ms: 6512, prompt_sha256_16: 'abcdef0123456789', cited_ledger_ids: ['a', 'b'] },
  ...over,
});

test('renders nothing when detective is absent, off, failed, or offline', () => {
  assert.strictEqual(detectiveView(null), null);
  assert.strictEqual(detectiveView({}), null);
  assert.strictEqual(detectiveView(wrap({ safety: {} })), null);
  assert.strictEqual(detectiveView(wrap({ detective: det({ muse_status: 'off (LYLO_HACK_MUSE is not 1)' }) })), null);
  assert.strictEqual(detectiveView(wrap({ detective: det({ muse_status: 'error: TIMEOUT; deterministic result returned unchanged' }) })), null);
  assert.strictEqual(detectiveView(wrap({ detective: det() }, 'offline')), null);
});

test('hypotheses keep server rank order and show confidence', () => {
  const v = detectiveView(wrap({ detective: det() }));
  assert.deepStrictEqual(v.hypotheses.map((h) => h.cause), ['MAF', 'Vacuum leak']);
  assert.strictEqual(v.hypotheses[1].confidenceLabel, 'High confidence');
  assert.strictEqual(v.hypotheses[1].evidence.length, 2);
  assert.ok(v.hypotheses[1].evidence.every((e) => e.found));
  assert.match(v.hypotheses[1].evidence[0].label, /P0171 \(permanent\)/);
});

test('cleared-codes warning shown prominently only when recently cleared', () => {
  const v = detectiveView(wrap({ detective: det() }));
  assert.match(v.clearedWarning.text, /wiped/);
  assert.strictEqual(v.clearedWarning.evidence[0].label, 'Codes were cleared before this scan');
  const v2 = detectiveView(wrap({ detective: det({ recently_cleared: false }) }));
  assert.strictEqual(v2.clearedWarning, null);
});

test('unverified claims are labeled with missing ids; missing cites are flagged', () => {
  const v = detectiveView(wrap({ detective: det() }));
  assert.strictEqual(v.unverified.length, 1);
  assert.match(v.unverified[0].label, /Unverified/);
  assert.deepStrictEqual(v.unverified[0].missingIds, ['pid:O2_SENSOR_B1S1']);
  assert.strictEqual(v.unverified[0].text, 'Bad O2 sensor');
  const v2 = detectiveView(wrap({ detective: det({ hypotheses: [{ rank: 1, cause: 'x', confidence: 'low', cites: ['ghost:1'] }] }) }));
  assert.strictEqual(v2.hypotheses[0].evidence[0].found, false);
});

test('receipt line and safety notes', () => {
  const v = detectiveView(wrap({ detective: det() }));
  assert.strictEqual(v.receipt, 'Receipt: muse-spark-1.3 · 6.5 s · prompt abcdef01 · 2 evidence items cited');
  assert.strictEqual(v.safetyNote, null);
  assert.match(detectiveView(wrap({ detective: det({ safety_action: 'detective_lower_ignored' }) })).safetyNote, /never lower/);
  assert.match(detectiveView(wrap({ detective: det({ safety_action: 'raised_by_detective' }) })).safetyNote, /raised/);
});

test('photo items are labeled lower trust', () => {
  assert.match(itemLabel(LEDGER[4]), /^Photo \(lower trust\): red oil pressure/);
});

test('real Muse evidence files render without missing cites', () => {
  for (const name of ['usedcar', 'checkengine', 'cleared_clean']) {
    const v = detectiveView(wrap(real(name)));
    assert.ok(v, name);
    assert.ok(v.hypotheses.length >= 3, name);
    assert.ok(v.hypotheses.every((h) => h.evidence.length && h.evidence.every((e) => e.found)), name);
    assert.ok(v.receipt.startsWith('Receipt: muse-spark-1.3'), name);
  }
  assert.ok(detectiveView(wrap(real('usedcar'))).clearedWarning);
  assert.strictEqual(detectiveView(wrap(real('checkengine'))).clearedWarning, null);
});

test('DetectiveCard is wired into ServerDiagnosisCard and calls hooks unconditionally', () => {
  const card = fs.readFileSync(path.join(__dirname, '..', 'src', 'ServerDiagnosisCard.js'), 'utf8');
  assert.match(card, /<DetectiveCard scan=\{scan\} \/>/);
  const dc = fs.readFileSync(path.join(__dirname, '..', 'src', 'DetectiveCard.js'), 'utf8');
  assert.ok(dc.indexOf('useState') < dc.indexOf('if (!v) return null'));
});
