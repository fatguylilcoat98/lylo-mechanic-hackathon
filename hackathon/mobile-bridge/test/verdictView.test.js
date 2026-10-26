const test = require('node:test');
const assert = require('node:assert');
const { reconcileVerdict, codesNote } = require('../src/verdictView');

const GREEN = { level: 'green', label: 'LOOKS GOOD', summary: 'The engine computer shows no problems.' };
const RED = { level: 'red', label: 'CONCERNS FOUND', summary: 'x' };
const srv = (level) => ({ serverDiagnosis: { source: 'server', result: { safety: { level } } } });

test('no serverDiagnosis: baseline verdict unchanged (same object)', () => {
  assert.strictEqual(reconcileVerdict(GREEN, {}), GREEN);
  assert.strictEqual(codesNote({}, 0, false), null);
});

test('offline fallback: unchanged', () => {
  const s = { serverDiagnosis: { source: 'offline', result: null, error: 'timeout' } };
  assert.strictEqual(reconcileVerdict(GREEN, s), GREEN);
  assert.strictEqual(codesNote(s, 0, false), null);
});

test('Chris truck case: green baseline + INSPECT_SOON server -> one amber verdict, no LOOKS GOOD', () => {
  const v = reconcileVerdict(GREEN, srv('INSPECT_SOON'));
  assert.strictEqual(v.level, 'yellow');
  assert.strictEqual(v.label, 'GET IT INSPECTED SOON');
  assert.match(v.summary, /No trouble codes, but the LYLO server flagged readings/);
  assert.doesNotMatch(v.label + v.summary, /LOOKS GOOD|shows no problems/);
  assert.match(codesNote(srv('INSPECT_SOON'), 0, false).text, /No trouble codes, but the LYLO server/);
});

test('server SAFE_TO_DRIVE: baseline kept', () => {
  assert.strictEqual(reconcileVerdict(GREEN, srv('SAFE_TO_DRIVE')), GREEN);
  assert.strictEqual(codesNote(srv('SAFE_TO_DRIVE'), 0, false), null);
});

test('never lowers a stricter baseline verdict', () => {
  assert.strictEqual(reconcileVerdict(RED, srv('INSPECT_SOON')), RED);
});

test('red server level raises to red', () => {
  const v = reconcileVerdict(GREEN, srv('DO_NOT_DRIVE'));
  assert.strictEqual(v.level, 'red');
  assert.strictEqual(v.label, 'DO NOT DRIVE');
  assert.strictEqual(codesNote(srv('DO_NOT_DRIVE'), 2, true).tone, 'red');
});

test('unknown server level is ignored', () => {
  assert.strictEqual(reconcileVerdict(GREEN, srv('WHATEVER')), GREEN);
});
