/*
 * LYLO Mechanic hackathon v0.4.7: "Try a demo scan" (no car, no adapter).
 * Sends a bundled scan id to the server, which runs it through the real pipeline
 * (rules -> Muse Detective -> never-lower merge -> receipts). Flag EXPO_PUBLIC_LYLO_DEMO=1.
 * "AI vs rules": a clearly labeled SIMULATED AI answer through the real merge code.
 */
'use strict';

const { label } = require('./noAdapter');

const CASES = [
  { id: 'truck', title: "Chris's truck: cold engine, high fuel trim", short: "Readings from Chris's own truck scan" },
  { id: 'usedcar', title: 'Used car: codes recently cleared', short: "LYLO's built-in used-car demo (not a real car)" },
  { id: 'overheat', title: 'Overheating: coolant 260 °F', short: 'Made-up test scan to show the safety rules' },
];
const TIMEOUT_MS = 45000;
const MSG = {
  noServer: 'The demo needs the LYLO server. This build has no server address.',
  offline: "Couldn't reach the LYLO server. Check your connection and try again.",
  timeout: 'The server took too long. Try again.',
  busy: 'Too many demo runs right now. Wait a minute and try again.',
  failed: 'The server could not run this demo. Try again.',
};

function features(env) {
  let on;
  if (env) on = env.EXPO_PUBLIC_LYLO_DEMO; else { try { on = process.env.EXPO_PUBLIC_LYLO_DEMO; } catch (e) { on = undefined; } }
  return { on: String(on || '').trim() === '1' };
}

async function post(path, body, { baseUrl, appKey, fetchImpl, timeoutMs = TIMEOUT_MS } = {}) {
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!baseUrl || !f) return { ok: false, error: MSG.noServer };
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), timeoutMs); });
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (appKey) headers['X-LYLO-App-Key'] = appKey;
    const r = await Promise.race([f(baseUrl.replace(/\/$/, '') + path, { method: 'POST', headers, body: JSON.stringify(body || {}) }), timeout]);
    let j = null;
    try { j = await r.json(); } catch (e) { j = null; }
    if (!r.ok || !j) return { ok: false, status: r.status, error: r.status === 429 ? MSG.busy : MSG.failed };
    return { ok: true, body: j };
  } catch (e) {
    return { ok: false, error: e && e.message === 'timeout' ? MSG.timeout : MSG.offline };
  } finally { clearTimeout(timer); }
}

const replay = (caseId, opts) => post('/api/v1/demo/replay', { case: caseId }, opts);
const proof = (opts) => post('/api/v1/demo/proof', {}, opts);

/** Server JSON -> what the screen shows. Only numbers the server returned; nothing made up. */
function replayView(j) {
  const det = (j && j.detective) || {};
  const rc = det.receipt || {};
  const op = det.safety_opinion || null;
  const level = (j && j.safety && j.safety.level) || det.final_safety_level || null;
  const museOk = det.muse_status === 'ok';
  return {
    title: (j && j.demo && j.demo.title) || '', source: (j && j.demo && j.demo.source) || '',
    level, levelText: level ? label(level) : 'Unknown',
    rulesLevel: det.rule_safety_level || null, aiLevel: op ? op.level : null,
    action: det.safety_action || null, museOk, museStatus: det.muse_status || 'unknown',
    causes: museOk ? (det.hypotheses || []).map((h) => ({ cause: h.cause, confidence: h.confidence, cites: (h.cites || []).length })) : [],
    explanation: museOk && det.explanation ? det.explanation.text : null,
    recentlyCleared: !!det.recently_cleared,
    coldNote: det.cold_engine_note || null,
    receipt: museOk ? { model: rc.model || null, seconds: typeof rc.latency_ms === 'number' ? Math.round(rc.latency_ms / 100) / 10 : null,
      cited: Array.isArray(rc.cited_ledger_ids) ? rc.cited_ledger_ids.length : null, ledger: rc.ledger_size || (det.ledger || []).length || null } : null,
    unverified: museOk ? (det.unverified_claims || []).length : 0,
  };
}

function proofView(j) {
  const p = (j && j.proof) || {};
  return {
    label: p.label || 'Simulated AI answer for this test', simulated: p.simulated === true,
    ai: p.ai_verdict, aiText: p.ai_verdict ? label(p.ai_verdict) : '?',
    rules: p.rules_verdict, rulesText: p.rules_verdict ? label(p.rules_verdict) : '?',
    final: p.final_verdict, finalText: p.final_verdict ? label(p.final_verdict) : '?',
    winner: p.winner === 'rules' ? 'Rules' : p.winner === 'ai' ? 'AI' : '?',
    action: p.safety_action, explain: p.explain || '',
  };
}

module.exports = { CASES, MSG, features, replay, proof, replayView, proofView, post };
