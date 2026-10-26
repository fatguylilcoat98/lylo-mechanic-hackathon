/*
 * LYLO Mechanic — OBD-II scan routines.
 *
 * Works on any object with sendCommand(cmd, {timeoutMs}) that resolves to
 * parser.parseResponse() output (i.e. an AdapterSession). No React Native
 * dependencies, so the whole flow is tested in Node against a simulated
 * ELM327/STN adapter (see obdScan.test.js).
 */

'use strict';

const D = require('./decoders');

let _log = () => {};
function setScanLogger(fn) { _log = fn || (() => {}); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Send a command; never throws. Returns parsed result or null on timeout. */
async function q(session, cmd, timeoutMs) {
  try {
    const r = await session.sendCommand(cmd, timeoutMs ? { timeoutMs } : {});
    if (!r.ok) _log(cmd + ' -> ' + r.error);
    return r;
  } catch (e) {
    _log(cmd + ' failed: ' + (e.message || e));
    return null;
  }
}

/**
 * Initialise the adapter. The first ATZ gets a long timeout because on the
 * very first connection to an OBDLink CX, Android shows a pairing prompt and
 * nothing flows until the user taps "Pair".
 */
async function initAdapter(session, { firstTimeoutMs = 20000 } = {}) {
  let adapter = null;
  let okReset = false;
  for (let attempt = 1; attempt <= 3 && !okReset; attempt++) {
    try {
      const r = await session.sendCommand('ATZ', { timeoutMs: attempt === 1 ? firstTimeoutMs : 6000 });
      okReset = true;
      adapter = (r.lines.find((l) => /ELM|STN|OBD/i.test(l)) || '').trim() || null;
    } catch (e) {
      _log('ATZ attempt ' + attempt + ' failed: ' + (e.message || e));
      if (attempt < 3) await sleep(800);
    }
  }
  if (!okReset) {
    throw new Error('The adapter did not answer. If this is an OBDLink CX: unplug it, plug it back in, and connect again within 5 minutes (accept the pairing prompt).');
  }
  for (const c of ['ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATAT1', 'ATSP0']) {
    await q(session, c, 4000);
  }
  const sti = await q(session, 'STI', 3000); // OBDLink/STN identity; '?' on plain ELM
  if (sti && sti.ok && sti.lines[0]) adapter = sti.lines[0];

  // First real query: the adapter searches for the car's protocol here.
  const r = await q(session, '0100', 15000);
  if (!r) throw new Error('No answer from the car. Make sure the ignition is ON (engine running or key in RUN) and try again.');
  if (!r.ok && /UNABLE TO CONNECT|BUS INIT|CAN ERROR|NO DATA/.test(r.error || '')) {
    throw new Error('The adapter is working, but it cannot talk to the car (' + r.error + '). Turn the ignition ON (or start the engine) and try again.');
  }
  const p = await q(session, 'ATDPN', 3000);
  const proto = p && p.ok && p.lines[0] ? p.lines[0].replace(/^A/i, '').trim() : null;
  const isCan = proto ? /^[6-9ABC]$/i.test(proto) : null;
  _log('adapter=' + (adapter || '?') + ' protocol=' + (proto || '?') + ' can=' + isCan);
  return { adapter, protocol: proto, isCan, supported0100: r };
}

async function readSupported(session, first) {
  const sup = new Set();
  let res = first;
  for (const base of ['00', '20', '40', '60']) {
    if (base !== '00') {
      if (!sup.has(base)) break;
      res = await q(session, '01' + base, 4000);
    }
    if (!res || !res.ok) break;
    D.decodeSupported(res.lines, base).forEach((p) => sup.add(p));
  }
  return sup;
}

const USED_CAR_PIDS = ['21', '30', '31', '4D', '4E'];
const LIVE_PIDS = ['42', '05', '0C', '04', '06', '07', '0F', '11', '0D', '2F', '1F'];

/**
 * Full scan. onProgress(stepIndex, totalSteps, message).
 * Returns a plain object safe to JSON.stringify and pass between screens.
 */
async function runFullScan(session, onProgress) {
  const steps = 8;
  let i = 0;
  const step = (msg) => { i++; _log(msg); if (onProgress) onProgress(i, steps, msg); };
  const scan = {
    timestamp: new Date().toISOString(),
    adapter: null, protocol: null, isCan: null,
    vin: null, vehicle: null,
    monitor: null, stored: [], pending: [], permanent: [],
    permanentSupported: false,
    pids: {}, supported: [], notes: [],
  };

  step('Waking up the adapter...');
  const init = await initAdapter(session);
  scan.adapter = init.adapter; scan.protocol = init.protocol; scan.isCan = init.isCan;

  step('Checking what this car supports...');
  const sup = await readSupported(session, init.supported0100);
  scan.supported = Array.from(sup).sort();

  step('Reading VIN...');
  const v = await q(session, '0902', 8000);
  if (v && v.ok) {
    scan.vin = D.decodeVIN(v.lines);
    scan.vehicle = D.decodeVinOffline(scan.vin);
  }
  if (!scan.vin) scan.notes.push('VIN not reported by the engine computer (common on pre-2005 cars).');

  step('Reading check-engine light and readiness monitors...');
  const m = await q(session, '0101', 5000);
  if (m && m.ok) scan.monitor = D.decodeMonitorStatus(D.mode01Bytes(m.lines, '01'));

  step('Reading stored codes (Mode 03)...');
  const s = await q(session, '03', 6000);
  if (s && s.ok) scan.stored = D.decodeDTCs(s.lines, '03', scan.isCan);

  step('Reading pending codes (Mode 07)...');
  const pd = await q(session, '07', 6000);
  if (pd && pd.ok) scan.pending = D.decodeDTCs(pd.lines, '07', scan.isCan);

  step('Reading permanent codes (Mode 0A)...');
  const pm = await q(session, '0A', 6000);
  if (pm && pm.ok) {
    scan.permanentSupported = true;
    scan.permanent = D.decodeDTCs(pm.lines, '0A', scan.isCan);
  } else {
    scan.notes.push('Permanent codes (Mode 0A) not supported — normal for cars before about 2010.');
  }

  step('Reading used-car history counters and live data...');
  const want = USED_CAR_PIDS.concat(LIVE_PIDS);
  for (const pid of want) {
    // Ask for used-car PIDs even if the bitmap didn't list them (some ECUs under-report).
    if (sup.size && !sup.has(pid) && USED_CAR_PIDS.indexOf(pid) === -1) continue;
    const r = await q(session, '01' + pid, 3000);
    if (!r || !r.ok) continue;
    const val = D.decodePid(r.lines, pid);
    if (val !== null) scan.pids[D.PID_DEFS[pid].key] = val;
  }
  _log('scan done: stored=' + scan.stored.join(',') + ' pending=' + scan.pending.join(',') + ' permanent=' + scan.permanent.join(','));
  return scan;
}

/** Mode 04 — clear codes. Returns true if the car acknowledged. */
async function clearCodes(session) {
  const r = await q(session, '04', 8000);
  const ok = !!(r && r.ok && r.lines.some((l) => l.replace(/\s/g, '').toUpperCase().indexOf('44') === 0));
  _log('clear codes: ' + (ok ? 'acknowledged' : 'NOT acknowledged'));
  return ok;
}

module.exports = { initAdapter, runFullScan, clearCodes, setScanLogger, USED_CAR_PIDS, LIVE_PIDS };
