/*
 * LYLO Mechanic v0.7.6 guided tours, shared helpers (flag EXPO_PUBLIC_LYLO_TOUR=1, exactly '1').
 * Every tour runs on SYNTHETIC or REPLAY data shipped in the app. No tour calls the server or Meta.
 *
 * One verdict per tour screen: verdictOf(tour, part) = oneVerdict.decide(ruleLevel, facts).
 * ruleLevel comes from a recorded server replay when the tour has one; otherwise it is undefined and
 * decide() fails closed (at least "Get it checked soon"). Facts can only raise it.
 *
 * Coach cards: `say` = plain words a 10-year-old can follow; `deep` = full mechanic detail.
 * Coach text must never contain a verdict title (tests enforce this), so the pinned headline is the
 * only verdict on the screen.
 */
'use strict';
const OV = require('../oneVerdict');

function tourOn(env) {
  let v;
  if (env) v = env.EXPO_PUBLIC_LYLO_TOUR; else { try { v = process.env.EXPO_PUBLIC_LYLO_TOUR; } catch (e) { v = undefined; } }
  return v === '1';
}
const HONDA = '2003 Honda Accord (made-up demo car)';
const quiet = () => ({ stored: [], pending: [], permanent: [], monitor: { milOn: false, incomplete: [] },
  pids: { dist_since_clear_km: 9000, coolant_temp_f: 195, stft_b1: 1.0, ltft_b1: 2.0 } });
const ruleOf = (body) => (body && body.safety && body.safety.level) || undefined;
const partOf = (tour, part) => (tour.parts ? tour.parts[Math.max(0, Math.min(part || 0, tour.parts.length - 1))] : tour);

/** One verdict for one tour screen (or one part of a two-part tour). */
function verdictOf(tour, part) {
  const p = partOf(tour, part);
  if (p.body) return OV.decide(ruleOf(p.body), OV.factsFromResult(p.body));
  if (p.scan) return OV.decide(p.rule, OV.factsFromScan(p.scan));
  return OV.decide(undefined, {}); // no data -> fail closed
}
const stepsFor = (tour, part) => tour.steps.filter((s) => s.part === undefined || s.part === (part || 0));
module.exports = { tourOn, HONDA, quiet, ruleOf, partOf, verdictOf, stepsFor };
