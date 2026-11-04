'use strict';
/* v0.7.7 tour 12: "Meta AI at work". Replays a REAL recorded Meta AI answer (tourData/metaReal.js).
 * Everything shown is read from the fixture; nothing is invented. Missing or not-a-real-Meta-run fixture -> build() returns null (tour hidden). */
const OV = require('../oneVerdict');

const resultOf = (f) => (f && f.result && f.result.detective ? f.result : f && f.serverDiagnosis && f.serverDiagnosis.result ? f.serverDiagnosis.result : f);
function codeMeaning(code) {
  try { const c = require('../../../../baseline/mobile/src/engine/diagnose').buildCodeResult(code, 'stored'); return c && c.known ? c.title : null; } catch (e) { return null; }
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Saved date in the user's zone (America/Los_Angeles, fixed offset: PDT Mar-Oct approx, PST otherwise). No Intl needed (Hermes). */
function savedDate(f, det) {
  const iso = f && (f.saved_at || f.captured_at || f.recorded_at);
  const ms = iso ? Date.parse(iso) : det.prove && typeof det.prove.locked_at === 'number' ? det.prove.locked_at * 1000 : NaN;
  if (Number.isNaN(ms)) return null;
  const u = new Date(ms); const m = u.getUTCMonth();
  const off = m >= 3 && m <= 9 ? 7 : m === 2 || m === 10 ? (u.getUTCDate() >= 8 && m === 2) || (u.getUTCDate() < 2 && m === 10) ? 7 : 8 : 8;
  const d = new Date(ms - off * 3600e3);
  return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
const isSample = (f, r) => /SYNTHETIC|sample|made-up/i.test(String((f && f._note) || '')) || !(r.vehicle && r.vehicle.vin);
const cut = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); if (t.length <= n) return t; const one = t.split(/(?<=[.!?])\s/)[0]; return one.length <= n ? one : t.slice(0, n - 1) + '\u2026'; };
const clip = (s, n) => { const x = String(s || '').replace(/\s+/g, ' ').trim(); return x.length <= n ? x : x.slice(0, n - 1) + '\u2026'; };
const NO_TITLES = (s) => Object.values(OV.TITLES).reduce((acc, x) => acc.split(x.title).join('\u201c' + x.title.toLowerCase() + '\u201d'), s);

function build(fixture) {
  const r = resultOf(fixture);
  const det = r && r.detective;
  if (!det || det.muse_status !== 'ok') return null; // only a run where Meta actually answered
  const rc = det.receipt || {};
  if (!rc.model || typeof rc.latency_ms !== 'number' || /simulat/i.test(String(rc.model))) return null; // not a real model call
  const expl = det.explanation && det.explanation.text;
  const date = savedDate(fixture, det);
  if (!expl || !date) return null;
  const code = (det.ledger || []).filter((i) => String(i.id || '').startsWith('dtc:')).map((i) => i.code).filter(Boolean)[0] || null;
  const meaning = code ? codeMeaning(code) : null; // same code library the v0.7.4 card uses (dtcCodes.js)
  const secs = Math.round(rc.latency_ms / 100) / 10;
  const hyps = (Array.isArray(det.hypotheses) ? det.hypotheses : []).slice().sort((a, b) => (a.rank || 99) - (b.rank || 99)).slice(0, 3);
  const pv = det.prove || {}; const pred = det.prediction || {};
  const label = `Recorded real Meta AI answer (${String(rc.model)}) to ${isSample(fixture, r) ? 'a sample scan' : 'a recorded scan'}, saved ${date}`;
  const steps = [
    { t: 'A real Meta AI answer', say: NO_TITLES(`${label}. LYLO sent this scan to Meta AI and it answered in ${secs} seconds.`),
      deep: `${code ? 'Code ' + code + (meaning ? ': ' + meaning : '') + '. ' : ''}muse_status ok. Model: ${rc.model}. Latency ${rc.latency_ms} ms. Saved replay; no call is made now.` },
    { t: 'What Meta AI said', say: NO_TITLES(cut(expl, 190)), deep: NO_TITLES('Full explanation: ' + expl) },
  ];
  if (hyps.length) steps.push({ t: 'Its likely causes, ranked', say: NO_TITLES(clip(hyps.map((h, i) => `#${i + 1} ${String(h.cause || h.text || h.title).split(' - ')[0]} (${h.confidence || 'n/a'})`).join('; '), 190)),
    deep: NO_TITLES(hyps.map((h) => `#${h.rank} ${h.cause || h.text || h.title} (confidence ${h.confidence || 'n/a'}): ${h.reasoning || ''}`).join(' | ')) });
  if (pred.text) steps.push({ t: 'It locks a guess first', say: NO_TITLES(cut(`Before new readings came in, a guess was locked: "${pred.text}".`, 190)),
    deep: `Proposed by: ${pv.proposed_by === 'model' ? 'Meta AI' : 'the safety rules'} (${pv.proposed_by || 'unknown'}). lock_sha256 ${String(pv.lock_sha256 || 'n/a').slice(0, 12)}\u2026` });
  const v = OV.decide((r.safety && r.safety.level) || undefined, OV.factsFromResult(r)) // same as tours/common verdictOf;
  const raisedNote = v.raised ? 'Any trouble code keeps the answer at least at check-soon. ' : '';
  steps.push({ t: 'The safety rules check it', say: NO_TITLES(clip(`${OV.plainAction(det.safety_action)}.${pred.status ? ' The locked guess ' + (pred.status === 'HELD' ? 'held' : pred.status === 'FAILED' ? 'failed' : pred.status === 'LOCKED' ? 'was not checked yet in this recording' : 'is ' + String(pred.status).toLowerCase()) + '.' : ''} ${raisedNote}Meta AI can only raise the answer at the top.`, 199)),
    deep: `rule_safety_level ${det.rule_safety_level}, final ${det.final_safety_level}, safety_action ${det.safety_action}.${pred.measured ? ' Checker: ' + pred.status + ', ' + pred.measured + '.' : ''}` });
  return {
    id: 'metaai', n: 12, title: 'Meta AI at work', body: r,
    car: isSample(fixture, r) ? 'Sample scan (made-up car)' + (code ? ': ' + code + (meaning ? ', ' + meaning : '') : '') : ((r.vehicle && [r.vehicle.year, r.vehicle.make, r.vehicle.model].filter(Boolean).join(' ')) || 'Recorded scan'),
    short: 'Replay of a real Meta AI answer: what it said, its causes and locked guess, then the safety rules checking it.',
    sub: label, recorded: { date, model: String(rc.model), latency_ms: rc.latency_ms },
    steps, tryIt: { label: 'Scan your own car', route: 'Connect' },
  };
}
const META = (() => { try { return require('../tourData/metaReal'); } catch (e) { return null; } })();
module.exports = { codeMeaning, build, tour: build(META) };
