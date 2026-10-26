/*
 * LYLO Mechanic hackathon build: one consistent verdict per screen.
 * When the LYLO server returned a safety level stricter than the baseline
 * on-phone verdict, the baseline verdict card shows the stricter level plus
 * a plain note. No serverDiagnosis (or offline fallback) = baseline unchanged.
 * Never lowers: if the baseline verdict is already as strict, it is kept.
 */
'use strict';

const { LEVELS } = require('./diagnosisView');

const BASE_RANK = { green: 0, info: 0, yellow: 1, red: 2 };
const TONE_TO_BASE = { green: 'green', amber: 'yellow', red: 'red' };
const NOTE = 'No trouble codes, but the LYLO server flagged readings worth checking. See the Safety check above.';

function serverLevel(scan) {
  const d = scan && scan.serverDiagnosis;
  if (!d || d.source !== 'server') return null;
  const lv = d.result && d.result.safety && d.result.safety.level;
  return LEVELS[lv] ? lv : null;
}

/** Used-car screen: returns the verdict to show ({level,label,summary}). */
function reconcileVerdict(verdict, scan) {
  const lv = serverLevel(scan);
  if (!lv || !verdict) return verdict;
  const base = TONE_TO_BASE[LEVELS[lv].tone];
  if (BASE_RANK[base] <= (BASE_RANK[verdict.level] || 0)) return verdict;
  const hadCodes = verdict.level !== 'green';
  return {
    ...verdict,
    level: base,
    label: LEVELS[lv].label.toUpperCase(),
    summary: (hadCodes ? 'The LYLO server rated this stricter than the on-phone check. See the Safety check above.' : NOTE)
      + ' A computer check can\'t see everything; still have the car inspected (brakes, tires, leaks, rust, accident history).',
    reconciledFrom: verdict.label,
  };
}

/** Codes screen: extra line + accent for the summary card, or null (baseline unchanged). */
function codesNote(scan, codeCount, milOn) {
  const lv = serverLevel(scan);
  if (!lv || lv === 'SAFE_TO_DRIVE') return null;
  const tone = LEVELS[lv].tone;
  const text = codeCount
    ? `Overall: ${LEVELS[lv].label.toLowerCase()} (LYLO server, see the Safety check above).`
    : (milOn ? 'No stored codes, but the check-engine light is on and ' : 'No trouble codes, but ')
      + 'the LYLO server flagged readings worth checking. See the Safety check above.';
  return { text, tone, levelLabel: LEVELS[lv].label };
}

module.exports = { reconcileVerdict, codesNote, NOTE };
