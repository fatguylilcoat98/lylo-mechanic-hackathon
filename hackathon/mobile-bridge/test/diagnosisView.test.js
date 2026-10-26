'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { diagnosisView } = require('../src/diagnosisView');

test('absent serverDiagnosis renders nothing', () => {
  assert.strictEqual(diagnosisView({ codes: {} }), null);
  assert.strictEqual(diagnosisView(null), null);
});
test('server result shows level and server source', () => {
  const v = diagnosisView({ serverDiagnosis: { source: 'server', result: { safety: { level: 'EMERGENCY_STOP_IMMEDIATELY' } } } });
  assert.strictEqual(v.tone, 'red');
  assert.match(v.levelLabel, /Stop now/);
  assert.match(v.sourceLabel, /server/i);
  assert.strictEqual(v.reason, null);
});
test('unknown server level still shown, not invented', () => {
  const v = diagnosisView({ serverDiagnosis: { source: 'server', result: { safety: { level: 'NEW_LEVEL' } } } });
  assert.strictEqual(v.levelLabel, 'new level');
  assert.strictEqual(v.tone, 'info');
});
test('offline fallback shows on-phone source and reason', () => {
  const v = diagnosisView({ serverDiagnosis: { source: 'offline', result: [], error: 'Server said 400: no codes' } });
  assert.match(v.sourceLabel, /On-phone/);
  assert.strictEqual(v.reason, 'Server said 400: no codes');
  assert.strictEqual(v.levelCode, null);
});
test('every backend safety level is mapped', () => {
  const dir = path.join(__dirname, '../../../baseline/backend/safety');
  const text = fs.readdirSync(dir).filter((f) => f.endsWith('.py')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const { LEVELS } = require('../src/diagnosisView');
  const found = ['SAFE_TO_DRIVE', 'INSPECT_SOON', 'DRIVE_SHORT_DISTANCE_ONLY', 'DO_NOT_DRIVE', 'TOW_RECOMMENDED', 'EMERGENCY_STOP_IMMEDIATELY'].filter((l) => text.includes(l));
  assert.strictEqual(found.length, 6);
  for (const l of found) assert.ok(LEVELS[l], l);
});
test('ServerDiagnosisCard returns null before rendering when view is null', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/ServerDiagnosisCard.js'), 'utf8');
  assert.match(src, /if \(!v\) return null;/);
});
