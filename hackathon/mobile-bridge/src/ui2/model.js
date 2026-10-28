/*
 * UI v2 view-model. Presentation only: wraps the existing buildResults() (same verdict,
 * same actions, same never-lower safety level) and adds what the v2 screen draws:
 * causes with typed evidence, the safety-override story, an optional prediction, and replay.
 * Pure, tested in Node.
 */
'use strict';

const { buildResults } = require('../resultsView');
const { itemLabel } = require('../detectiveView');
const { evidenceKind } = require('./theme');

const ORDER = ['SAFE_TO_DRIVE', 'INSPECT_SOON', 'DRIVE_SHORT_DISTANCE_ONLY', 'DO_NOT_DRIVE', 'TOW_RECOMMENDED', 'EMERGENCY_STOP_IMMEDIATELY'];
const rank = (lv) => ORDER.indexOf(lv);
const CONF = { high: 'Most likely', medium: 'Possible', low: 'Less likely' };

function safetyStory(r, det) {
  const level = r.safety.level;
  if (rank(level) < rank('DO_NOT_DRIVE')) return null;
  const ai = det.safety_opinion && det.safety_opinion.level;
  const overruled = det.safety_action === 'detective_lower_ignored' || (ai && rank(ai) >= 0 && rank(ai) < rank(level));
  return {
    title: level === 'EMERGENCY_STOP_IMMEDIATELY' ? 'Pull over now' : level === 'TOW_RECOMMENDED' ? "Don't drive it. Get a tow." : "Don't drive it",
    level,
    overruled: !!overruled,
    note: overruled ? 'The AI suggested it was less serious. The safety rules overruled it. AI can raise a warning, never lower it.'
      : det.safety_action === 'raised_by_detective' ? 'Meta AI raised this warning, based on the readings it cites.' : 'Set by the safety rules from your car\'s readings.',
    triggers: (Array.isArray(r.safety.triggering_conditions) ? r.safety.triggering_conditions : []).slice(0, 3),
  };
}

/** Optional: det.prediction = { text, status: 'pending'|'held'|'failed', measured? } (upcoming photo+live-data proof). */
function prediction(det) {
  const p = det && det.prediction;
  if (!p || !p.text) return null;
  const status = ['held', 'failed'].includes(p.status) ? p.status : 'pending';
  return { text: String(p.text), status, measured: p.measured ? String(p.measured) : null };
}

function buildV2(scan, opts = {}) {
  const m = buildResults(scan, opts);
  if (!m) return null;
  const r = scan.serverDiagnosis.result;
  const det = r.detective || {};
  const byId = {};
  (Array.isArray(det.ledger) ? det.ledger : []).forEach((it) => { if (it && it.id) byId[it.id] = it; });
  const museOk = det.muse_status === 'ok';
  const causes = museOk ? (Array.isArray(det.hypotheses) ? det.hypotheses : []).map((h, i) => ({
    key: 'c' + i,
    rank: Number.isInteger(h.rank) ? h.rank : i + 1,
    title: m.seeWhy.causes[i] ? m.seeWhy.causes[i].title : String(h.cause || ''),
    likely: CONF[h.confidence] || 'Possible',
    nextCheck: h.next_check ? String(h.next_check) : null,
    evidence: (Array.isArray(h.cites) ? h.cites : []).map((id) => {
      const it = byId[id];
      return { id, kind: evidenceKind(it), label: it ? itemLabel(it) : 'Not in this scan' };
    }),
  })) : [];
  const counts = { car: 0, guess: 0, unknown: 0 };
  causes.forEach((c) => c.evidence.forEach((e) => { counts[e.kind] += 1; }));
  return { ...m, causes, evidenceCounts: counts, safety: safetyStory(r, det), prediction: prediction(det), replay: scan.demoLabel ? String(scan.demoLabel) : null };
}

module.exports = { buildV2 };
