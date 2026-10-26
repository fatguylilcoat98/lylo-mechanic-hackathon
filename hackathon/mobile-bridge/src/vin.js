/*
 * LYLO Mechanic hackathon v0.4.3: VIN-first.
 * The user types the VIN or takes a photo of it; the server decodes it with NHTSA vPIC.
 * A VIN is only accepted if it passes the check digit (we never guess characters).
 * Saved under the NEW AsyncStorage key 'lylo.vehicle'. Never throws.
 */
'use strict';

const VEHICLE_KEY = 'lylo.vehicle';
const CAVEAT = 'assumes the factory engine (not swapped)';
const TRANSLIT = {}; 'ABCDEFGHJKLMNPRSTUVWXYZ'.split('').forEach((c, i) => { TRANSLIT[c] = [1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 7, 9, 2, 3, 4, 5, 6, 7, 8, 9][i]; });
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

const normalize = (v) => String(v || '').replace(/[\s-]/g, '').toUpperCase();

function checkDigit(v) {
  let t = 0;
  for (let i = 0; i < 17; i++) t += (/\d/.test(v[i]) ? Number(v[i]) : TRANSLIT[v[i]]) * WEIGHTS[i];
  const r = t % 11;
  return r === 10 ? 'X' : String(r);
}

/** {ok, vin, reason}. Plain-English reasons; never "fixes" the VIN. */
function validateVin(input) {
  const vin = normalize(input);
  if (vin.length !== 17) return { ok: false, vin, reason: `A VIN has 17 characters (this has ${vin.length}).` };
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return { ok: false, vin, reason: 'A VIN never uses the letters I, O or Q.' };
  if (checkDigit(vin) !== vin[8]) return { ok: false, vin, reason: "That VIN doesn't add up (check digit). One character is probably mistyped." };
  return { ok: true, vin, reason: '' };
}

const maskVin = (v) => (v ? String(v).slice(0, 3) + '*'.repeat(Math.max(0, String(v).length - 3)) : '');

async function post(fetchImpl, url, appKey, body, isJson, timeoutMs) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const r = await fetchImpl(url, { method: 'POST', body, signal: ctrl ? ctrl.signal : undefined,
      headers: { 'X-LYLO-App-Key': appKey || '', ...(isJson ? { 'Content-Type': 'application/json' } : {}) } });
    let j = null; try { j = await r.json(); } catch (e) { j = null; }
    return { status: r.status, json: j };
  } finally { if (t) clearTimeout(t); }
}

/** Decode on the server (NHTSA vPIC). Returns {status:'ok'|'invalid'|'unknown'|'offline', vehicle, recalls, message}. */
async function decodeVin(vinInput, { baseUrl, appKey, fetchImpl, timeoutMs = 12000 } = {}) {
  const v = validateVin(vinInput);
  if (!v.ok) return { status: 'invalid', message: v.reason };
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!baseUrl || !f) return { status: 'offline', vin: v.vin, message: 'Saved your VIN. We will look up the car when you are online.' };
  try {
    const { json } = await post(f, `${baseUrl}/api/v1/vin/decode`, appKey, JSON.stringify({ vin: v.vin }), true, timeoutMs);
    if (json && json.vin_status === 'ok' && json.vehicle) return { status: 'ok', vin: v.vin, vehicle: json.vehicle, recalls: json.recalls || null };
    if (json && json.vin_status === 'invalid') return { status: 'invalid', message: json.message };
    return { status: 'unknown', vin: v.vin, message: "We couldn't look up this VIN right now. The app still works without it." };
  } catch (e) {
    return { status: 'offline', vin: v.vin, message: "We couldn't reach the server. The app still works without it." };
  }
}

/** Photo of the VIN, read by Meta AI on the server. Returns {status:'read', vin} or {status:'not_read', message}. */
async function readVinPhoto(photo, { baseUrl, appKey, fetchImpl, timeoutMs = 30000, FormDataImpl } = {}) {
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  const FD = FormDataImpl || (typeof FormData !== 'undefined' ? FormData : null);
  const CANT = "I couldn't read the VIN clearly. Type it in instead, or try a sharper photo.";
  if (!baseUrl || !f || !FD || !photo) return { status: 'not_read', message: CANT };
  try {
    const fd = new FD();
    fd.append('photo', photo);
    const { json } = await post(f, `${baseUrl}/api/v1/vin/photo`, appKey, fd, false, timeoutMs);
    const v = json && json.vin_status === 'read' ? validateVin(json.vin) : { ok: false };
    if (v.ok) return { status: 'read', vin: v.vin, message: 'Check this matches your car before using it.' };
    return { status: 'not_read', message: (json && json.message) || CANT };
  } catch (e) { return { status: 'not_read', message: CANT }; }
}

/** What the app keeps and shows. */
function vehicleSummary(res) {
  const v = res && res.vehicle;
  if (!res || res.status !== 'ok' || !v || !v.year || !v.make || !v.model) return null;
  const rc = res.recalls;
  return {
    vin: res.vin, name: `${v.year} ${v.make} ${v.model}`, year: v.year, make: v.make, model: v.model,
    engine: v.engine || '', caveat: CAVEAT, source: v.source || 'NHTSA vPIC VIN decoder',
    recalls: rc && rc.status === 'ok' ? {
      text: rc.count ? `${rc.count} recall${rc.count === 1 ? '' : 's'} on record for this model year` + (rc.components && rc.components.length ? ` (${rc.components.slice(0, 3).join(', ')})` : '') : 'No recalls on record for this model year',
      source: rc.source, checkUrl: rc.check_url,
    } : null,
  };
}

async function loadVehicle(storage) {
  try { const s = storage ? await storage.getItem(VEHICLE_KEY) : null; const v = s ? JSON.parse(s) : null; return v && v.name ? v : null; } catch (e) { return null; }
}
async function saveVehicle(storage, v) {
  try { if (!storage) return false; if (v) await storage.setItem(VEHICLE_KEY, JSON.stringify(v)); else await storage.removeItem(VEHICLE_KEY); return true; } catch (e) { return false; }
}

module.exports = { VEHICLE_KEY, CAVEAT, validateVin, checkDigit, maskVin, decodeVin, readVinPhoto, vehicleSummary, loadVehicle, saveVehicle, normalize };
