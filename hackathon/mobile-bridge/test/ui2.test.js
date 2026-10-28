'use strict';
const test = require('node:test');
const assert = require('node:assert');
const t = require('../src/ui2/theme');
const { buildV2 } = require('../src/ui2/model');
const truck = () => JSON.parse(JSON.stringify(require('./fixtures/truck.json').scan));

test('every v2 text/background pair meets WCAG AA (4.5:1)', () => {
  for (const [fg, bg] of t.PAIRS) assert.ok(t.contrast(t.color[fg], t.color[bg]) >= 4.5, `${fg} on ${bg}`);
});
test('evidenceKind: car data, AI/photo guess, unknown', () => {
  assert.equal(t.evidenceKind({ id: 'pid:RPM', type: 'pid' }), 'car');
  assert.equal(t.evidenceKind({ id: 'mon:x', type: 'readiness_monitor' }), 'car');
  assert.equal(t.evidenceKind({ id: 'p1', source: 'photo' }), 'guess');
  assert.equal(t.evidenceKind(undefined), 'unknown');
});
test('flag reader: only "1" turns v2 on', () => {
  assert.equal(t.uiV2On({ EXPO_PUBLIC_LYLO_UI_V2: '1' }), true);
  assert.equal(t.uiV2On({ EXPO_PUBLIC_LYLO_UI_V2: 'true' }), false);
  assert.equal(t.uiV2On({}), false);
});
test('buildV2 keeps the single verdict and types the evidence', () => {
  const m = buildV2(truck(), { screen: 'codes' });
  assert.equal(m.tone, 'yellow');
  assert.ok(m.causes.length >= 1);
  assert.ok(m.evidenceCounts.car > 0);
  assert.equal(m.safety, null);
  assert.equal(m.prediction, null);
});
test('buildV2: missing cite is Unknown, never From your car', () => {
  const s = truck(); s.serverDiagnosis.result.detective.hypotheses[0].cites.push('pid:NOT_THERE');
  const m = buildV2(s, {});
  const e = m.causes[0].evidence.find((x) => x.id === 'pid:NOT_THERE');
  assert.equal(e.kind, 'unknown');
});
test('buildV2: AI lower opinion on red level -> overruled story; prediction status sanitized', () => {
  const s = truck(); const r = s.serverDiagnosis.result;
  r.safety.level = 'DO_NOT_DRIVE'; r.detective.safety_opinion.level = 'SAFE_TO_DRIVE';
  r.detective.prediction = { text: 'x', status: 'weird' };
  const m = buildV2(s, {});
  assert.equal(m.safety.title, "Don't drive it");
  assert.equal(m.safety.overruled, true);
  assert.equal(m.prediction.status, 'pending');
});
test('buildV2 returns null without a server result (old fallback screens stay)', () => {
  assert.equal(buildV2({}, {}), null);
});
