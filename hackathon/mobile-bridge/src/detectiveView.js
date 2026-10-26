/*
 * LYLO Mechanic hackathon build (Oct 26, 2026 onward).
 * Pure view-model for the Muse Detective block (result.detective), tested in Node.
 * Returns null unless the server result has a detective block with muse_status 'ok',
 * so screens render nothing new when Muse is off, failed, or the scan was offline.
 */
'use strict';

const CONF = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };

function str(v) { return v === null || v === undefined ? '' : String(v); }

function itemLabel(it) {
  if (!it || typeof it !== 'object') return 'Unknown evidence';
  switch (it.type) {
    case 'dtc': return `Code ${it.code} (${it.status})`;
    case 'pid':
    case 'codes_cleared_counter': return `${it.name} = ${it.value}${it.unit ? ' ' + it.unit : ''}`;
    case 'readiness_monitor': return `${it.name} monitor: ${it.status}`;
    case 'codes_cleared': return 'Codes were cleared before this scan';
    case 'codes_cleared_evidence': return str(it.text);
    case 'freeze_frame': return `Freeze frame ${it.name}: ${it.value}`;
    case 'vehicle': return `Vehicle ${it.name}: ${it.value}`;
    case 'rule_safety': return `Rule engine safety level: ${str(it.level).replace(/_/g, ' ').toLowerCase()}`;
    case 'rule_hypothesis': return `Rule engine cause: ${str(it.cause)}`;
    default:
      if (it.source === 'photo') {
        const color = it.color && it.color !== 'not_applicable' && it.color !== 'unclear' ? it.color + ' ' : '';
        return `Photo (lower trust): ${color}${str(it.name).replace(/_/g, ' ')} (${it.confidence || 'low'} confidence)`;
      }
      return str(it.id);
  }
}

function evidenceFor(cites, byId) {
  return (Array.isArray(cites) ? cites : []).map((id) => (byId[id]
    ? { id, label: itemLabel(byId[id]), found: true }
    : { id, label: `${id}: not found in this scan's evidence`, found: false }));
}

function claimText(c) {
  if (!c) return '';
  if (typeof c === 'string') return c;
  return str(c.text || c.cause || c.reason || '');
}

function detectiveView(scan) {
  const sd = scan && scan.serverDiagnosis;
  if (!sd || sd.source !== 'server' || !sd.result) return null;
  const d = sd.result.detective;
  if (!d || typeof d !== 'object' || d.muse_status !== 'ok') return null;
  const byId = {};
  (Array.isArray(d.ledger) ? d.ledger : []).forEach((it) => { if (it && it.id) byId[it.id] = it; });

  const hypotheses = (Array.isArray(d.hypotheses) ? d.hypotheses : []).map((h, i) => ({
    key: `h${i}`,
    rank: Number.isInteger(h.rank) ? h.rank : i + 1,
    cause: str(h.cause),
    confidence: h.confidence || 'low',
    confidenceLabel: CONF[h.confidence] || 'Confidence not given',
    reasoning: str(h.reasoning),
    nextCheck: str(h.next_check),
    evidence: evidenceFor(h.cites, byId),
  }));

  const cw = d.cleared_codes_warning;
  const clearedWarning = cw && str(cw.text).trim() && d.recently_cleared
    ? { text: str(cw.text), evidence: evidenceFor(cw.cites, byId) } : null;
  const ex = d.explanation;
  const explanation = ex && str(ex.text).trim() ? { text: str(ex.text), evidence: evidenceFor(ex.cites, byId) } : null;

  const unverified = (Array.isArray(d.unverified_claims) ? d.unverified_claims : []).map((u, i) => ({
    key: `u${i}`,
    kind: str(u.kind).replace(/_/g, ' '),
    text: claimText(u.claim),
    missingIds: Array.isArray(u.missing_ids) ? u.missing_ids : [],
    label: 'Unverified: cites evidence this scan does not have',
  }));

  let safetyNote = null;
  if (d.safety_action === 'raised_by_detective') {
    const { LEVELS } = require('./diagnosisView');
    const name = (lv) => (LEVELS[lv] ? LEVELS[lv].label : str(lv).replace(/_/g, ' ')).toLowerCase();
    safetyNote = `The AI detective raised the safety level from "${name(d.rule_safety_level)}" to "${name(d.final_safety_level)}", based on the readings it cites.`;
  } else if (d.safety_action === 'detective_lower_ignored') {
    safetyNote = 'The detective suggested a lower level; ignored. AI can raise safety, never lower it.';
  }

  if (d.cold_engine_note) safetyNote = (safetyNote ? safetyNote + ' ' : '') + str(d.cold_engine_note);

  const r = d.receipt || {};
  const parts = [];
  if (r.model) parts.push(str(r.model));
  if (typeof r.latency_ms === 'number') parts.push(`${(r.latency_ms / 1000).toFixed(1)} s`);
  if (r.prompt_sha256_16) parts.push(`prompt ${str(r.prompt_sha256_16).slice(0, 8)}`);
  if (Array.isArray(r.cited_ledger_ids)) parts.push(`${r.cited_ledger_ids.length} evidence items cited`);
  const receipt = parts.length ? `Receipt: ${parts.join(' · ')}` : null;

  return { hypotheses, clearedWarning, explanation, unverified, safetyNote, receipt };
}

module.exports = { detectiveView, itemLabel };
