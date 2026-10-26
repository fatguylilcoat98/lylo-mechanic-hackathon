/*
 * LYLO Mechanic — Used-Car Check assessment (offline rules).
 *
 * Main goal: catch a seller who cleared the check-engine codes right before
 * a sale. Clearing codes (or disconnecting the battery) resets the readiness
 * monitors to "incomplete" and resets the "distance / time since codes
 * cleared" counters — those can't be faked from the dash.
 */
'use strict';

const { kmToMi } = require('../services/obd/decoders');
const { analyzeCodes } = require('./diagnose');

// Thresholds (miles / warm-ups / minutes)
const RECENT_MI_STRONG = 100;  // under this = very recent clear
const RECENT_MI_SOFT = 200;
const RECENT_WARMUPS = 15;
const RECENT_MIN = 300;        // 5 hours of engine run time

function assessUsedCar(scan) {
  const findings = []; // {level: 'red'|'yellow'|'green'|'info', title, detail}
  const add = (level, title, detail) => findings.push({ level, title, detail });
  const p = scan.pids || {};
  const mon = scan.monitor;
  const miSinceClear = kmToMi(p.dist_since_clear_km);
  const miMilOn = kmToMi(p.dist_mil_on_km);
  const warmups = p.warmups_since_clear;
  const minSinceClear = p.time_since_clear_min;
  const incomplete = mon ? mon.incomplete.filter((n) => n !== 'A/C refrigerant') : [];
  const stored = scan.stored || [];
  const pending = scan.pending || [];
  const permanent = scan.permanent || [];

  // ── Recently-cleared detection ───────────────────────────────
  const recentDistance = miSinceClear !== null && miSinceClear !== undefined && miSinceClear < RECENT_MI_STRONG;
  const softDistance = miSinceClear !== null && miSinceClear !== undefined && miSinceClear < RECENT_MI_SOFT;
  const recentWarmups = warmups !== undefined && warmups !== null && warmups < RECENT_WARMUPS;
  const recentTime = minSinceClear !== undefined && minSinceClear !== null && minSinceClear > 0 && minSinceClear < RECENT_MIN;
  const counterSaysRecent = recentDistance || recentWarmups || recentTime;
  const permanentWithoutStored = permanent.some((c) => stored.indexOf(c) === -1);

  let recentlyCleared = 'no';
  if ((incomplete.length >= 2 && (counterSaysRecent || softDistance)) || (permanentWithoutStored && counterSaysRecent)) {
    recentlyCleared = 'likely';
  } else if (counterSaysRecent || incomplete.length >= 2 || (incomplete.length === 1 && softDistance) || permanentWithoutStored) {
    recentlyCleared = 'possible';
  }

  const counterBits = [];
  if (miSinceClear !== null && miSinceClear !== undefined) counterBits.push(miSinceClear + ' miles');
  if (warmups !== null && warmups !== undefined) counterBits.push(warmups + ' warm-up' + (warmups === 1 ? '' : 's'));
  if (minSinceClear) counterBits.push(Math.round(minSinceClear / 60 * 10) / 10 + ' engine hours');
  const counterText = counterBits.length ? 'Since the codes were last cleared: ' + counterBits.join(', ') + '. ' : '';

  if (recentlyCleared === 'likely') {
    add('red', 'Codes look RECENTLY CLEARED',
      counterText + (incomplete.length ? incomplete.length + ' emissions self-tests are not finished (' + incomplete.join(', ') + '). ' : '') +
      (permanentWithoutStored ? 'The computer still remembers permanent code(s) ' + permanent.join(', ') + ' even though the regular codes were erased. ' : '') +
      'Someone may have erased trouble codes right before selling. Ask the seller directly, and ask to come back after the car has been driven 100+ miles — or have a pre-purchase inspection done.');
  } else if (recentlyCleared === 'possible') {
    add('yellow', 'Codes may have been cleared not long ago',
      counterText + (incomplete.length ? 'Not finished: ' + incomplete.join(', ') + '. ' : '') +
      'This can also happen after a battery replacement or disconnect. Ask the seller when and why.');
  } else if (mon && (miSinceClear === null || miSinceClear === undefined || miSinceClear >= RECENT_MI_SOFT)) {
    add('green', 'No sign of recently cleared codes', counterText + (incomplete.length ? '' : 'Emissions self-tests are finished.'));
  }

  // ── Check-engine light & codes ───────────────────────────────
  if (mon && mon.milOn) add('red', 'Check-engine light is ON', 'The engine computer is reporting ' + (mon.dtcCount || stored.length) + ' confirmed problem(s).');
  if (miMilOn) add(miMilOn > 50 ? 'red' : 'yellow', 'Driven ' + miMilOn + ' miles with the check-engine light on', 'Problems were ignored for a while. Ask what was wrong.');
  if (stored.length) add('red', stored.length + ' stored trouble code(s): ' + stored.join(', '), 'Confirmed problems. See each code below for meaning and typical repair cost.');
  if (pending.length) add('yellow', pending.length + ' pending code(s): ' + pending.join(', '), 'Problems the car has noticed once but not confirmed yet — they often turn into a check-engine light soon.');
  if (permanent.length) add(permanentWithoutStored ? 'red' : 'yellow', 'Permanent code(s): ' + permanent.join(', '), 'These can\'t be erased with a scanner. They clear only after the car verifies the repair itself.');
  if (mon && !mon.milOn && !stored.length && !pending.length && !permanent.length) add('green', 'No trouble codes', 'No stored, pending or permanent codes were found.');

  // ── Smog readiness ───────────────────────────────────────────
  if (mon && mon.monitors.length) {
    if (incomplete.length === 0) add('green', 'All emissions self-tests complete', 'The car should be ready for a smog check (as far as the computer is concerned).');
    else if (incomplete.length === 1) add('yellow', '1 emissions self-test not finished', incomplete[0] + ' is not finished. Many states allow one for 2001+ cars; it can mean a recent clear or battery disconnect.');
    else add('yellow', incomplete.length + ' emissions self-tests not finished', 'The car would likely fail a smog check right now: ' + incomplete.join(', ') + '.');
  }

  // ── Battery / charging (if engine running) ───────────────────
  if (p.module_voltage) {
    const v = p.module_voltage;
    const running = (p.rpm || 0) > 400;
    if (running && v < 13.0) add('yellow', 'Charging voltage low (' + v + ' V)', 'With the engine running it should be about 13.5–14.7 V. The alternator or battery may be weak.');
    else if (!running && v < 12.2) add('yellow', 'Battery voltage low (' + v + ' V)', 'A healthy battery reads about 12.4–12.7 V with the engine off.');
    else if (running && v > 15.0) add('yellow', 'Charging voltage high (' + v + ' V)', 'Overcharging can damage the battery. Have the charging system tested.');
  }

  // ── VIN ──────────────────────────────────────────────────────
  if (scan.vin) add('info', 'VIN from the engine computer: ' + scan.vin, 'Compare this to the VIN on the dashboard (through the windshield), the driver\'s door sticker, and the title. If they don\'t match, walk away.');
  else add('info', 'VIN not available from the computer', 'Common on older cars. Check the dashboard VIN matches the title.');

  const reds = findings.filter((f) => f.level === 'red').length;
  const yellows = findings.filter((f) => f.level === 'yellow').length;
  const verdict = reds ? { level: 'red', label: 'CONCERNS FOUND', summary: 'Don\'t buy without answers to the red items below, or a professional pre-purchase inspection.' }
    : yellows ? { level: 'yellow', label: 'PROCEED WITH CAUTION', summary: 'Nothing alarming, but ask the seller about the yellow items below.' }
      : { level: 'green', label: 'LOOKS GOOD', summary: 'The engine computer shows no problems. A computer check can\'t see everything — still have the car inspected (brakes, tires, leaks, rust, accident history).' };

  return {
    verdict, findings, recentlyCleared,
    counters: { miSinceClear, miMilOn, warmups, minSinceClear },
    incomplete, codes: analyzeCodes(scan),
  };
}

module.exports = { assessUsedCar };
