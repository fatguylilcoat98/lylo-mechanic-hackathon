/*
 * LYLO Mechanic hackathon v0.4.8: "Not my engine?" (owner-set engine).
 * Flag (build time): EXPO_PUBLIC_LYLO_ENGINE_OVERRIDE=1. Unset = nothing here runs, nothing is sent,
 * and every screen and request is exactly as in v0.4.7.
 * The NHTSA VIN decode can get the engine wrong (old Ford cutaways can decode as diesel on a gas truck;
 * engines get swapped). The owner picks the fuel and can type the engine. It is saved on the phone under
 * 'lylo.engineOverride' (next to 'lylo.vehicle', same VIN) and sent instead of the decoded engine,
 * always labeled as set by the owner. Never throws.
 */
'use strict';

const KEY = 'lylo.engineOverride';
const MAX_ENGINE = 60;
const FUELS = [
  { id: 'gas', label: 'Gas' },
  { id: 'diesel', label: 'Diesel' },
  { id: 'hybrid_ev', label: 'Hybrid/EV' },
  { id: 'not_sure', label: 'Not sure' },
];
const FUEL_IDS = FUELS.map((f) => f.id);

function features(env) {
  let on;
  if (env) on = env.EXPO_PUBLIC_LYLO_ENGINE_OVERRIDE;
  else { try { on = process.env.EXPO_PUBLIC_LYLO_ENGINE_OVERRIDE; } catch (e) { on = undefined; } }
  return { on: String(on || '').trim() === '1' };
}

const cleanEngine = (v) => String(typeof v === 'string' ? v : '').replace(/[^A-Za-z0-9 .,/()+\-']/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_ENGINE).trim();

/** {vin, fuel, engine, setAt} or null when there's nothing to save. */
function makeOverride(fuel, engine, vin) {
  const f = FUEL_IDS.includes(fuel) ? fuel : '';
  const e = cleanEngine(engine);
  if (!f && !e) return null;
  return { vin: typeof vin === 'string' ? vin : '', fuel: f || 'not_sure', engine: e, setAt: new Date().toISOString() };
}

function fuelLabel(id) { const f = FUELS.find((x) => x.id === id); return f ? f.label : ''; }

/** What the card shows, e.g. "6.8L V10 Triton (Gas)". */
function label(ov) {
  if (!ov) return '';
  const fl = ov.fuel && ov.fuel !== 'not_sure' ? fuelLabel(ov.fuel) : '';
  if (ov.engine) return fl && !ov.engine.toLowerCase().includes(fl.toLowerCase()) ? `${ov.engine} (${fl})` : ov.engine;
  return fl || 'Not sure';
}

let current = null;
let loaded = false;
const setCurrent = (ov) => { current = ov || null; loaded = true; };
const getCurrent = () => current;

let defaultStorage;
function storageOrDefault(s) {
  if (s) return s;
  if (defaultStorage === undefined) {
    try { defaultStorage = require('@react-native-async-storage/async-storage').default || null; } catch (e) { defaultStorage = null; }
  }
  return defaultStorage;
}

async function load(storage) {
  try {
    const st = storageOrDefault(storage);
    const s = st ? await st.getItem(KEY) : null;
    const v = s ? JSON.parse(s) : null;
    setCurrent(v && (v.fuel || v.engine) ? v : null);
  } catch (e) { setCurrent(null); }
  return current;
}

/** Loads once per app run; no-op when the flag is off. */
async function ensureLoaded(storage, env) {
  if (!features(env).on) return null;
  if (!loaded) await load(storage);
  return current;
}

async function save(storage, ov) {
  try {
    const st = storageOrDefault(storage);
    if (!st) { setCurrent(ov); return false; }
    if (ov) await st.setItem(KEY, JSON.stringify(ov)); else await st.removeItem(KEY);
    setCurrent(ov);
    return true;
  } catch (e) { return false; }
}

/** Fields added to what goes to the server. {} when off, unset, or saved for a different VIN. */
function fieldsFor(vin, env) {
  if (!features(env).on || !current) return {};
  if (vin && current.vin && vin !== current.vin) return {};
  const out = { engine_source: 'user', fuel_user: current.fuel || 'not_sure' };
  if (current.engine) out.engine_user = current.engine;
  return out;
}

function appendTo(form, vin, env) {
  const f = fieldsFor(vin, env);
  Object.keys(f).forEach((k) => form.append(k, f[k]));
  return form;
}

module.exports = { KEY, MAX_ENGINE, FUELS, features, cleanEngine, makeOverride, label, fuelLabel, setCurrent, getCurrent, load, ensureLoaded, save, fieldsFor, appendTo };
