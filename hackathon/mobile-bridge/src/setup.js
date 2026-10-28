/*
 * LYLO Mechanic hackathon v0.4.6: first-run setup (3 questions, shown once, skippable,
 * re-openable from Home > Tools). Answers reuse the existing keys lylo.viewMode and
 * lylo.vehicle; only "setup done" and "has adapter" are new keys.
 */
'use strict';

const { saveViewMode } = require('./viewMode');
const { saveVehicle, CAVEAT } = require('./vin');

const SETUP_DONE_KEY = 'lylo.setupDone';
const HAS_ADAPTER_KEY = 'lylo.hasAdapter';

function firstRunOn() {
  return process.env.EXPO_PUBLIC_LYLO_FIRST_RUN === '1';
}

async function isSetupDone(storage) {
  try { return !!storage && (await storage.getItem(SETUP_DONE_KEY)) === '1'; } catch (e) { return true; }
}

async function markDone(storage) {
  try { if (storage) await storage.setItem(SETUP_DONE_KEY, '1'); } catch (e) { /* ignore */ }
}

async function skip(storage) { await markDone(storage); }

const cap = (w) => String(w).trim().split(/\s+/).map((x) => (x.length <= 3 && /^[a-z0-9-]+$/i.test(x) && /\d|-/.test(x) ? x.toUpperCase() : x.charAt(0).toUpperCase() + x.slice(1))).join(' ');

/** Year/make/model typed by the user (no VIN): same shape as vehicleSummary, no recalls. */
function manualVehicle(year, make, model) {
  const y = String(year || '').trim();
  const now = new Date().getFullYear() + 1;
  if (!/^\d{4}$/.test(y) || +y < 1981 || +y > now) return null;
  if (!String(make || '').trim() || !String(model || '').trim()) return null;
  const mk = cap(make); const md = cap(model);
  return { vin: '', name: `${y} ${mk} ${md}`, year: +y, make: mk, model: md, engine: '', caveat: CAVEAT,
           source: 'typed by you (add your VIN for recalls for your model)', recalls: null };
}

/** answers: {hasAdapter: true|false|null, viewMode: 'simple'|'mechanic'|null, vehicle: summary|null} */
async function saveAnswers(storage, a) {
  if (a.hasAdapter === true || a.hasAdapter === false) {
    try { await storage.setItem(HAS_ADAPTER_KEY, a.hasAdapter ? 'yes' : 'no'); } catch (e) { /* ignore */ }
  }
  if (a.viewMode) await saveViewMode(storage, a.viewMode);
  if (a.vehicle) await saveVehicle(storage, a.vehicle);
  await markDone(storage);
}

/** Where to go after setup: no adapter -> the No adapter screen (when that feature is on). */
function nextRoute(hasAdapter, noAdapterOn) {
  return hasAdapter === false && noAdapterOn ? 'NoAdapter' : 'Home';
}

module.exports = { SETUP_DONE_KEY, HAS_ADAPTER_KEY, firstRunOn, isSetupDone, markDone, skip, manualVehicle, saveAnswers, nextRoute };
