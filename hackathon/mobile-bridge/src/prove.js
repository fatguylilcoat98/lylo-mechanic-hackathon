/*
 * LYLO Mechanic hackathon v0.5.0: "Point and prove" client. Flag EXPO_PUBLIC_LYLO_PROVE=1 (off = nothing sent).
 * The server locks a testable prediction BEFORE the reading and its deterministic checker decides
 * HELD / FAILED. The phone never sets a status: it only forwards readings taken after the lock.
 * Replays always carry a REPLAY label that cannot be turned off (asScan).
 */
'use strict';

const { post } = require('./demo');

const REPLAY_CASES = [
  { id: 'prove_misfire_synthetic', title: 'Misfire on cylinder 3', short: 'SYNTHETIC: made-up readings, not a real car' },
  { id: 'prove_lean_fail_synthetic', title: 'A prediction that fails', short: 'SYNTHETIC: made-up readings, not a real car' },
];
const STATUS = ['LOCKED', 'HELD', 'FAILED'];
const MAX_SAMPLES = 2000;

function features(env) {
  let on;
  if (env) on = env.EXPO_PUBLIC_LYLO_PROVE; else { try { on = process.env.EXPO_PUBLIC_LYLO_PROVE; } catch (e) { on = undefined; } }
  return { on: String(on || '').trim() === '1' };
}

/** Readings since the lock -> [{dt, pid, value}] / [{dt, dtc}]. lockedAtMs = phone time when the lock came back. */
function samplesSince(readings, lockedAtMs) {
  const out = [];
  for (const r of readings || []) {
    if (!r || typeof r.atMs !== 'number' || r.atMs <= lockedAtMs) continue;
    const dt = (r.atMs - lockedAtMs) / 1000;
    if (r.dtc) out.push({ dt, dtc: String(r.dtc).toUpperCase() });
    else if (r.pid && typeof r.value === 'number' && isFinite(r.value)) out.push({ dt, pid: String(r.pid), value: r.value });
    if (out.length >= MAX_SAMPLES) break;
  }
  return out;
}

const check = (sessionId, samples, opts) => post('/api/v1/prove/check', { session_id: sessionId, samples }, opts);
const replay = (caseId, opts) => post('/api/v1/prove/replay', { case: caseId }, opts);

/** Only the server's {text, status, measured}; unknown status -> LOCKED (never upgraded on the phone). */
function predictionView(det) {
  const p = det && det.prediction;
  if (!p || !p.text) return null;
  return { text: String(p.text), status: STATUS.includes(p.status) ? p.status : 'LOCKED', measured: p.measured ? String(p.measured) : null };
}

/** Server replay JSON -> a scan for the results screen. The REPLAY label is always set for a replay. */
function asScan(j) {
  const isReplay = !!(j && (j.replay || (j.detective && j.detective.prediction_replay)));
  // ReplayBadge already prints "REPLAY ·", so the label is the description only (never empty for a replay).
  const raw = String((j && j.replay && j.replay.label) || '').replace(/^\s*REPLAY\s*[\u00B7:-]?\s*/i, '').trim();
  const label = isReplay ? (raw || 'recorded session, not live data') : null;
  return { serverDiagnosis: { source: 'server', result: j }, demoLabel: label, replay: isReplay };
}

/**
 * v0.5.1: the ONE rule for the prediction banner (ui2/model.js and ProvePanel both use it).
 * -> null | 'pending' | 'held' | 'failed' | 'unverified' | 'integrity'
 * integrity  = the record check failed: prove.chain_ok === false, or a HELD/FAILED result whose prove record has no valid head.
 * unverified = HELD/FAILED but no prove record at all, or chain not confirmed (never shown as "proved").
 * pending    = LOCKED / not checked yet (chain fields may be absent; that is not a failure).
 */
function bannerStatus(p, prove) {
  if (!p || !p.text) return null;
  const raw = String(p.status || '').toUpperCase();
  const pr = prove && typeof prove === 'object' ? prove : null;
  if (pr && pr.chain_ok === false) return 'integrity';
  if (raw !== 'HELD' && raw !== 'FAILED') return 'pending';
  if (!pr) return 'unverified';
  if (!(typeof pr.head_sha256 === 'string' && /^[0-9a-f]{8,}$/i.test(pr.head_sha256))) return 'integrity';
  if (pr.chain_ok !== true) return 'unverified';
  return raw.toLowerCase();
}

/** Banner model {text, status, measured} via bannerStatus. */
function bannerOf(p, prove) {
  const status = bannerStatus(p, prove);
  if (!status) return null;
  return { text: String(p.text), status, measured: (status === 'held' || status === 'failed') && p.measured ? String(p.measured) : null };
}

module.exports = { bannerStatus, bannerOf, REPLAY_CASES, STATUS, features, samplesSince, check, replay, predictionView, asScan };
