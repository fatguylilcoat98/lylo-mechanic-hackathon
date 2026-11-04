/* v0.7.7 tour 12 "Meta AI at work": shown only with a REAL recorded Meta AI answer fixture. No fabricated responses here:
 * the negative cases use the existing shipped fixtures; the positive case runs only once the real capture is wired in. */
const T12 = require('../../../hackathon/mobile-bridge/src/tours/12-metaai');
const META = require('../../../hackathon/mobile-bridge/src/tourData/metaReal');
const { TOURS } = require('../../../hackathon/mobile-bridge/src/tours');
const OV = require('../../../hackathon/mobile-bridge/src/oneVerdict');

test('hidden when the fixture slot is empty', () => {
  if (META) return; // real fixture wired: covered by the next test
  expect(T12.tour).toBeNull();
  expect(TOURS.find((t) => t.id === 'metaai')).toBeUndefined();
  expect(TOURS.length).toBe(11);
});

test('rejects anything that is not a real Meta run: simulated receipt, skipped, off, missing, no date', () => {
  expect(T12.build(null)).toBeNull();
  expect(T12.build({})).toBeNull();
  expect(T12.build(require('../../../hackathon/mobile-bridge/src/tourData/proof.json'))).toBeNull(); // muse ok but model "simulated"
  expect(T12.build(require('../../../hackathon/mobile-bridge/src/tourData/prove_misfire_synthetic.json'))).toBeNull(); // skipped
  expect(T12.build(require('../../../hackathon/mobile-bridge/src/tourData/usedcar.json'))).toBeNull(); // off
});

(META ? test : test.skip)('with the real fixture: labelled recorded, shows model + time + explanation, verdict never lower', () => {
  const t = T12.tour;
  expect(t).not.toBeNull();
  expect(t.sub).toMatch(/^Recorded real Meta AI answer \(muse-spark-1\.3\) to a sample scan, saved [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
  expect(t.steps[0].deep).toContain(t.recorded.model);
  expect(t.steps[0].say).toMatch(/seconds/);
  const v = require('../../../hackathon/mobile-bridge/src/tours/common').verdictOf(t);
  expect(OV.rank(v.level)).toBeGreaterThanOrEqual(OV.rank(t.body.detective.rule_safety_level));
  expect(TOURS[TOURS.length - 1].id).toBe('metaai');
});

test('tour text matches the real fixture fields (no invented values)', () => {
  const FX = require('../../../hackathon/mobile-bridge/src/tourData/meta_real.json');
  const det = FX.detective; const t = T12.tour;
  expect(t.sub).toBe('Recorded real Meta AI answer (muse-spark-1.3) to a sample scan, saved Nov 3, 2026');
  expect(t.recorded).toEqual({ date: 'Nov 3, 2026', model: det.receipt.model, latency_ms: det.receipt.latency_ms });
  expect(det.muse_status).toBe('ok');
  expect(t.steps[0].say).toContain(`answered in ${Math.round(det.receipt.latency_ms / 100) / 10} seconds`); // 20.3
  expect(t.steps[0].deep).toContain(`Latency ${det.receipt.latency_ms} ms`);
  expect(t.steps[1].deep).toBe('Full explanation: ' + det.explanation.text);
  expect(det.explanation.text.startsWith(t.steps[1].say.replace(/\u2026$/, ''))).toBe(true);
  const causes = t.steps.find((s) => /causes/.test(s.t));
  expect(det.hypotheses).toHaveLength(2);
  det.hypotheses.forEach((h) => { expect(causes.say).toContain(h.cause.split(' - ')[0]); expect(causes.say).toContain('(' + h.confidence + ')'); });
  const lock = t.steps.find((s) => /locks a guess/.test(s.t));
  expect(lock.say).toContain(det.prediction.text);
  expect(lock.deep).toMatch(/^Proposed by: Meta AI \(model\)/); expect(det.prove.proposed_by).toBe('model');
  expect(lock.deep).toContain(det.prove.lock_sha256.slice(0, 12));
  const rules = t.steps[t.steps.length - 1];
  expect(rules.say).toMatch(/^Meta AI agreed with the safety rules\./); expect(det.safety_action).toBe('agreed');
  expect(rules.say).toMatch(/not checked yet/); expect(det.prediction.status).toBe('LOCKED');
  expect(rules.deep).toContain(`rule_safety_level ${det.rule_safety_level}, final ${det.final_safety_level}`);
  // not presented as Chris's (or any real) car
  expect(t.car).toMatch(/^Sample scan \(made-up car\)/); expect(JSON.stringify(t)).not.toMatch(/Chris|your car/i);
});

test('P04E0 meaning: EVAP purge control valve "A" stuck closed, same as the v0.7.4 code library; nothing in the tour contradicts it', () => {
  const t = T12.tour;
  const lib = require('../src/engine/diagnose').buildCodeResult('P04E0', 'stored');
  expect(lib.title).toBe('EVAP System Purge Control Valve "A" Stuck Closed');
  expect(T12.codeMeaning('P04E0')).toBe(lib.title);
  expect(t.car).toBe('Sample scan (made-up car): P04E0, EVAP System Purge Control Valve "A" Stuck Closed');
  expect(t.steps[0].deep).toContain('Code P04E0: EVAP System Purge Control Valve "A" Stuck Closed');
  const all = JSON.stringify([t.title, t.short, t.sub, t.car, t.steps]);
  expect(all).not.toMatch(/stuck open|purge.{0,30}valve.{0,10}\bB\b|leak detected|small leak|large leak|gas cap/i);
  // the "Meta AI at work" headline still never lower than the rules (P04E0 code floor raises SAFE -> INSPECT_SOON)
  const v = require('../../../hackathon/mobile-bridge/src/tours/common').verdictOf(t);
  expect(v.level).toBe('INSPECT_SOON');
});
