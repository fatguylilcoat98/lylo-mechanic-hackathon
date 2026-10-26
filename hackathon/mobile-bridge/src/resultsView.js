/*
 * LYLO Mechanic hackathon: view-model for the redesigned results screen.
 * Pure (no React), tested in Node, also used by the HTML mockup twin.
 * One verdict only: the server's final safety level (already merged with
 * rules, photo and Meta AI; never lowered). Returns null without a server
 * result, so the baseline screens stay as the fallback.
 */
'use strict';

const { friendly, labelFor, formatValue, monitorLabel, plainProblem, stripCodes, isCircuitCode, WIRING_ACTION } = require('./friendlyLabels');
const hasCode = (t) => /\b[PBCU][0-9A-F]{4}\b/i.test(String(t || ''));
const { detectiveView } = require('./detectiveView');

const ORDER = ['SAFE_TO_DRIVE', 'INSPECT_SOON', 'DRIVE_SHORT_DISTANCE_ONLY', 'DO_NOT_DRIVE', 'TOW_RECOMMENDED', 'EMERGENCY_STOP_IMMEDIATELY'];
const VERDICTS = {
  green:  { title: 'Good to drive', icon: '\u2705' },
  yellow: { title: 'Get it checked soon', icon: '\u26A0\uFE0F' },
  orange: { title: 'Drive only short trips', icon: '\uD83D\uDFE0' },
  red:    { title: "Don't drive it", icon: '\u26D4' },
};
const TONE = { SAFE_TO_DRIVE: 'green', INSPECT_SOON: 'yellow', DRIVE_SHORT_DISTANCE_ONLY: 'orange',
  DO_NOT_DRIVE: 'red', TOW_RECOMMENDED: 'red', EMERGENCY_STOP_IMMEDIATELY: 'red' };
const COLD_F = 150;
const COLD_ACTION = 'Your engine was still cold. Scan again after a 15-minute drive to be sure.';

function serverResult(scan) {
  const d = scan && scan.serverDiagnosis;
  if (!d || d.source !== 'server' || !d.result || !d.result.safety) return null;
  return ORDER.includes(d.result.safety.level) ? d.result : null;
}

function pidMap(ledger) {
  const m = {};
  for (const i of ledger) if (String(i.id || '').startsWith('pid:')) m[i.name] = i;
  return m;
}

function tempF(item) {
  if (!item) return null;
  const v = Number(item.value);
  if (Number.isNaN(v)) return null;
  return /F/i.test(String(item.unit || '')) ? v : v * 9 / 5 + 32;
}

/**
 * @param scan scan with serverDiagnosis
 * @param opts.codes analyzeCodes(scan) results (baseline, has plain text + grounded shop prices)
 * @param opts.screen 'usedcar' | 'codes'
 * @param opts.baselineCleared baseline assessUsedCar(scan).recentlyCleared ('likely'|'possible'|'no')
 */
function buildResults(scan, opts = {}) {
  const r = serverResult(scan);
  if (!r) return null;
  const det = r.detective || {};
  const ledger = Array.isArray(det.ledger) ? det.ledger : [];
  const pids = pidMap(ledger);
  const codes = Array.isArray(opts.codes) ? opts.codes : [];
  const level = r.safety.level;
  const tone = TONE[level];
  const coolF = tempF(pids.ENGINE_COOLANT_TEMP);
  const cold = coolF !== null && coolF < COLD_F;
  const trim = (Number((pids.SHORT_TERM_FUEL_TRIM_B1 || {}).value) || 0) + (Number((pids.LONG_TERM_FUEL_TRIM_B1 || {}).value) || 0);
  const lean = trim >= 15;
  const cleared = !!det.recently_cleared || opts.baselineCleared === 'likely';

  // One plain sentence: why.
  let why;
  if (codes.length) {
    const first = codes[0].plain ? String(codes[0].plain).split(/(?<=\.)\s/)[0] : '';
    why = first && !hasCode(first) && !(codes[0].title && first.includes(codes[0].title)) ? first : `The car's computer reported ${plainProblem(codes[0].code)}.`;
  }
  else if (cleared && opts.screen === 'usedcar') why = 'Someone recently erased the warning codes, so problems may be hidden right now.';
  else if (lean && cold) why = "The engine is adding extra fuel. That's normal while it's still cold, or it can mean a hose is leaking air.";
  else if (lean) why = 'The engine is getting more air than it expects, a common and usually cheap fix like a cracked hose.';
  else if (cold && tone !== 'green') why = "Your engine was still cold, so some readings aren't reliable yet.";
  else if (tone === 'green') why = "We didn't find any problems in the engine computer.";
  else why = 'Some readings are worth a closer look by a mechanic.';

  // What to do next (max 3). Costs only from the baseline repair-price data.
  const actions = [];
  if (tone === 'red') actions.push('Leave it parked. Have it towed or call a mobile mechanic.');
  if (tone === 'orange') actions.push('Only drive it a short distance, straight to a repair shop.');
  if (cleared && opts.screen === 'usedcar') actions.push('Ask the seller why the codes were erased, or pay for a pre-purchase inspection.');
  if (codes.some((c) => isCircuitCode(c.code, c.title))) actions.push(WIRING_ACTION);
  for (const c of codes.slice(0, 2)) {
    const price = c.priceText && c.priceText.shop && !/Unknown/i.test(c.priceText.shop) ? `, usually ${c.priceText.shop} at a shop` : '';
    actions.push(`Ask a shop about ${plainProblem(c.code)}${price}.`);
  }
  if (cold) actions.push(COLD_ACTION);
  if (lean && !codes.length) actions.push('Ask a shop to check for an air leak, like a cracked or loose hose.');
  if (!actions.length) actions.push(tone === 'green' ? 'Nothing to fix right now. Keep up regular service.' : 'Have a mechanic take a look when you can.');

  // See why: causes with friendly evidence.
  const byId = {};
  for (const i of ledger) byId[i.id] = i;
  const toEvidence = (cites) => (Array.isArray(cites) ? cites : []).map((id) => friendly(byId[id])).filter(Boolean)
    .map((f) => (f.value ? `${f.label}: ${f.value}` : f.label));
  const causes = (Array.isArray(det.hypotheses) ? det.hypotheses : []).map((h) => ({
    title: stripCodes(h.cause), likely: { high: 'Most likely', medium: 'Possible', low: 'Less likely' }[h.confidence] || 'Possible',
    evidence: [...new Set(toEvidence(h.cites))],
  }));
  const readings = Object.values(pids).filter((i) => !/CLEAR|MIL_ON/.test(i.name)).map((i) => friendly(i));
  const monitors = ledger.filter((i) => String(i.id).startsWith('mon:')).map((i) => friendly(i));
  const counters = Object.values(pids).filter((i) => /CLEAR/.test(i.name)).map((i) => friendly(i));

  const rc = det.receipt || {};
  const receipt = rc.model ? [rc.model, typeof rc.latency_ms === 'number' ? (rc.latency_ms / 1000).toFixed(1) + ' s' : null,
    rc.prompt_sha256_16 ? 'prompt ' + String(rc.prompt_sha256_16).slice(0, 8) : null,
    typeof rc.ledger_size === 'number' ? rc.ledger_size + ' evidence items' : null].filter(Boolean).join(' · ') : null;

  // Mechanic view: full detail, same single verdict.
  const dv = detectiveView(scan);
  const mechanic = {
    levelCode: level,
    ruleLevel: det.rule_safety_level || r.safety.rule_level || level,
    safetyAction: det.safety_action || 'kept_rule_level',
    safetyNote: dv ? dv.safetyNote : null,
    triggers: Array.isArray(r.safety.triggering_conditions) ? r.safety.triggering_conditions : [],
    hypotheses: dv ? dv.hypotheses.map((h) => ({ ...h, evidence: h.evidence.map((e) => e.label) })) : [],
    explanation: dv && dv.explanation ? dv.explanation.text : null,
    clearedText: dv && dv.clearedWarning ? dv.clearedWarning.text : null,
    unverified: dv ? dv.unverified : [],
    pids: Object.values(pids).map((i) => ({ name: i.name, value: i.value, unit: i.unit || '' })),
    dtcs: ledger.filter((i) => String(i.id).startsWith('dtc:')).map((i) => `${i.code} (${i.status})`),
    monitors: ledger.filter((i) => String(i.id).startsWith('mon:')).map((i) => `${String(i.id).slice(4)}: ${i.status || (i.complete ? 'complete' : 'incomplete')}`),
    freezeFrame: scan.freezeFrame || null,
    receipt: dv ? dv.receipt : null,
    museStatus: det.muse_status || 'off',
    server: 'LYLO server (lylo-api) · session ' + (r.session_id || '?'),
  };

  return {
    tone, levelCode: level,
    verdict: { ...VERDICTS[tone], why },
    actions: actions.slice(0, 3),
    clearedWarning: cleared && opts.screen === 'usedcar' ? "Someone recently erased this car's warning codes. Be careful buying it." : null,
    coldNote: cold ? COLD_ACTION : null,
    seeWhy: { causes, readings, monitors, counters,
      vin: scan.vin || 'Not reported by the car', adapter: [scan.deviceName, scan.adapter].filter(Boolean).join(' · ') || 'Unknown' },
    receipt, poweredBy: 'Powered by Meta AI',
    mechanic,
  };
}

/** Plain share text that matches the screen (one verdict). */
function shareText(m) {
  if (!m) return '';
  return [`LYLO Mechanic: ${m.verdict.title}`, m.verdict.why, m.clearedWarning, 'What to do next:',
    ...m.actions.map((a) => '- ' + a), m.poweredBy].filter(Boolean).join('\n');
}

const hasServerResult = (scan) => !!serverResult(scan);

module.exports = { buildResults, shareText, hasServerResult, VERDICTS, TONE, COLD_ACTION, labelFor, formatValue, monitorLabel };
