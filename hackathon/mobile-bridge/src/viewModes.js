/*
 * LYLO Mechanic v0.7.2: Simple view / Mechanic view (phone flag EXPO_PUBLIC_LYLO_VIEW_MODE=1).
 * Pure, tested in Node. Flag off: nothing here is used and nothing changes.
 *  - opening choice remembered under the existing key 'lylo.viewMode' (viewMode.js)
 *  - Simple view is a guided flow: "Do you have an OBD sensor?" -> one step per screen
 *  - buildPlain(): the same facts as the results screen, in everyday words (not dumbed down)
 *  - buildMechanic(): every detail the scan has, dense; anything not read says 'not read'
 * Never invents values; never changes the safety level (it only re-words the one verdict).
 */
'use strict';

const { VIEW_MODE_KEY, MODES, saveViewMode } = require('./viewMode');

function features(env) {
  const e = env || { EXPO_PUBLIC_LYLO_VIEW_MODE: process.env.EXPO_PUBLIC_LYLO_VIEW_MODE };
  return { on: e.EXPO_PUBLIC_LYLO_VIEW_MODE === '1' };
}

/** null until the person picks (so the opening choice shows first). Never throws. */
async function loadChosen(storage) {
  try { const v = storage ? await storage.getItem(VIEW_MODE_KEY) : null; return MODES.includes(v) ? v : null; } catch (e) { return null; }
}

// ---- "Where does it plug in?" (generic guidance only; no make/model claims) ----
const PORT_HELP = {
  title: 'Where does it plug in?',
  where: 'Look under the dashboard on the driver\'s side, usually below the steering wheel, near your knees. The plug is shaped like a wide D (a trapezoid) with 16 little holes. Sometimes it is behind a small cover or near the fuse panel.',
  steps: [
    'Turn the car off.',
    'Find the port (see the drawing).',
    'Push the sensor in firmly. It only fits one way.',
    'Turn the key to ON, or start the engine.',
    'Wait for the light on the sensor to come on.',
    'Tap Next to pair it with your phone.',
  ],
  cantFind: [
    'Look to the left of the steering column.',
    'Check behind the little panel under the dash.',
    'Check the kick panel (the side wall by your left foot).',
    'Cars and light trucks sold in the US from 1996 on have one.',
  ],
  note: 'General guidance. Every car is a little different.',
};

const SENSOR_STEPS = [
  { id: 'where', title: PORT_HELP.title, port: true },
  { id: 'off', title: 'Turn the car off', body: 'Turn the car off before you plug anything in.' },
  { id: 'plug', title: 'Push the sensor in', body: 'Push the sensor into the port firmly. It only fits one way, so turn it over if it does not slide in.' },
  { id: 'key', title: 'Turn the key to ON', body: 'Turn the key to ON (the dash lights come on), or start the engine.' },
  { id: 'light', title: 'Wait for the light', body: 'Wait until the light on the sensor comes on. That means it has power.' },
  { id: 'pair', title: 'Pair the sensor', body: 'Your phone will look for the sensor over Bluetooth. Keep the key ON and stay near the car.', go: 'Connect', goLabel: 'Pair and scan' },
];

// No sensor: reuses the existing No-adapter screen (snap the dash, describe, type a code) and Photo Helper.
const NOSENSOR_STEPS = [
  { id: 'dash', title: 'Snap your dash lights', body: 'Turn the key to ON. Take one photo of any lights that are lit on the dashboard.', go: 'NoAdapter', params: { start: 'dash' }, goLabel: 'Take the dash photo' },
  { id: 'photo', title: 'Take a picture of the problem', body: 'Leak, smoke, a worn part, a strange part? Take a photo of it.', go: 'PhotoHelper', goLabel: 'Take a photo' },
  { id: 'describe', title: 'Tell us what\'s happening', body: 'Say it or type it in your own words, like "it shakes when I stop" or "it smells hot".', go: 'NoAdapter', params: { start: 'describe' }, goLabel: 'Say or type it' },
  { id: 'code', title: 'Have a code?', body: 'If a shop or parts store gave you a code (like P0302), type it in. No code? Skip this.', go: 'NoAdapter', params: { start: 'code' }, goLabel: 'Type a code' },
];

// ---- plain words: any term that has to appear gets a short plain explanation once ----
const GLOSSARY = [
  ['readiness monitors', 'the car\'s own self-tests'],
  ['self-checks', 'the car\'s own self-tests'],
  ['misfire', 'a cylinder not firing right'],
  ['fuel trim', 'how much fuel the computer adds'],
  ['catalytic converter', 'the exhaust part that cleans fumes'],
  ['oxygen sensor', 'sensor that sniffs the exhaust'],
  ['O2 sensor', 'sensor that sniffs the exhaust'],
  ['ignition coil', 'part that makes the spark'],
  ['spark plug', 'part that lights the fuel'],
  ['vacuum leak', 'air sneaking in through a crack'],
  ['EVAP', 'the system that traps fuel vapor'],
  ['coolant', 'the liquid that cools the engine'],
  ['lean', 'too much air, not enough fuel'],
  ['freeze frame', 'a snapshot when the problem happened'],
  ['OBD', 'the car\'s plug-in computer port'],
  ['VIN', 'your car\'s 17-character ID'],
  ['MAF', 'sensor that measures incoming air'],
  ['injector', 'nozzle that sprays in fuel'],
  ['compression', 'how tightly the engine squeezes air'],
];
function explainTerms(text, seen) {
  let out = String(text || '');
  const done = seen || new Set();
  for (const [term, plain] of GLOSSARY) {
    if (done.has(term)) continue;
    const re = new RegExp('\\b(' + term.replace(/[-]/g, '\\-') + ')\\b', 'i');
    if (re.test(out)) { out = out.replace(re, `$1 (${plain})`); done.add(term); }
  }
  return out;
}

const PLAIN_VERDICT = {
  green: { title: 'Safe to drive', why: 'We did not find anything that makes it unsafe to drive right now.' },
  yellow: { title: 'Get it checked soon', why: 'It is OK to drive, but have a mechanic look at it in the next few days.' },
  orange: { title: 'Get it checked soon', why: 'Only drive it a short way, straight to a repair shop.' },
  red: { title: "Don't drive", why: 'Driving it could be unsafe or cause damage. Leave it parked and get help.' },
};

const SYSTEM = { P: 'engine and transmission', C: 'brakes, steering and suspension', B: 'body (airbags, locks, climate)', U: 'the car\'s computer network' };
const STATUS_PLAIN = { stored: 'confirmed and saved by the car', pending: 'seen once, not confirmed yet', permanent: 'kept until the car proves it is fixed' };

function codeList(scan) {
  const by = {};
  ['stored', 'pending', 'permanent'].forEach((k) => (Array.isArray(scan && scan[k]) ? scan[k] : []).forEach((c) => {
    const code = String(c || '').toUpperCase(); if (!/^[PCBU][0-9A-F]{4}$/.test(code)) return;
    (by[code] = by[code] || []).push(k);
  }));
  return Object.keys(by).map((code) => ({ code, statuses: by[code] }));
}

function lookup(code, kind) {
  try { return require('../../../baseline/mobile/src/engine/diagnose').buildCodeResult(code, kind); } catch (e) { return null; }
}

const KM_TO_MI = 0.621371;
const mi = (km) => (typeof km === 'number' ? Math.round(km * KM_TO_MI) : null);

/** Simple view: same facts, everyday words. m = buildResults/buildV2 model (one verdict). */
function buildPlain(m, scan) {
  if (!m) return null;
  const seen = new Set();
  const say = (t) => explainTerms(t, seen);
  const v = PLAIN_VERDICT[m.tone] || PLAIN_VERDICT.yellow;
  const codes = codeList(scan || {}).map(({ code, statuses }) => {
    const r = lookup(code, statuses[0]);
    return {
      code,
      means: say(r ? r.plain : `Your car saved code ${code}.`),
      status: statuses.map((s) => STATUS_PLAIN[s]).join('; '),
      likely: r && r.causes && r.causes.length ? say('Most common reasons: ' + r.causes.slice(0, 3).join(', ').toLowerCase() + '.') : null,
      firstCheck: r && r.check && r.check.length ? say('A cheap first check: ' + r.check[0] + '.') : null,
      cost: r && r.known && r.priceText ? `About ${r.priceText.shop} at a shop` + (r.priceText.diy && !/Not a DIY/.test(r.priceText.diy) ? `, or ${r.priceText.diy} if you do it yourself` : '') : null,
    };
  });
  const p = (scan && scan.pids) || {};
  const readings = [];
  if (typeof p.coolant_temp_f === 'number') readings.push(say(`Engine temperature: ${p.coolant_temp_f} °F. ${p.coolant_temp_f >= 240 ? 'That is too hot.' : p.coolant_temp_f < 150 ? 'The engine is still cold, so some readings are not reliable yet.' : 'That is a normal warm engine.'}`));
  if (typeof p.module_voltage === 'number') readings.push(`Battery and charging: ${p.module_voltage} volts. ${p.module_voltage >= 13.2 ? 'The charging system is working while the engine runs.' : p.module_voltage < 12 ? 'That is low. The battery or charging may be weak.' : 'That is a normal battery reading.'}`);
  const trim = (typeof p.stft_b1 === 'number' ? p.stft_b1 : 0) + (typeof p.ltft_b1 === 'number' ? p.ltft_b1 : 0);
  if (typeof p.ltft_b1 === 'number') readings.push(say(`Fuel trim: the computer is adding ${trim > 0 ? 'extra' : 'less'} fuel (${Math.round(trim)}%). ${trim > 10 ? 'More than 10% often means air is getting in somewhere it shouldn\'t (lean).' : 'That is in the usual range.'}`));
  if (typeof p.dist_since_clear_km === 'number') readings.push(`Codes were last erased ${mi(p.dist_since_clear_km)} miles ago.`);
  const mons = (scan && scan.monitor && Array.isArray(scan.monitor.incomplete)) ? scan.monitor.incomplete : [];
  const selfTests = mons.length ? say(`${mons.length} of the car's self-checks have not finished yet (${mons.join(', ')}). Until they finish, some problems can stay hidden.`) : null;
  const shop = codes.map((c) => c.cost).filter(Boolean);
  return {
    verdict: v, levelCode: m.levelCode,
    vehicle: m.vehicle && m.vehicle.name ? m.vehicle.name : null,
    cleared: m.clearedWarning ? say(m.clearedWarning) : null,
    codes, readings, selfTests,
    todo: (m.actions || []).map(say),
    cost: shop.length ? shop : null,
    costNote: shop.length ? 'Rough LYLO estimates, not a quote. Prices vary by car and shop.' : null,
    ai: m.causes && m.causes.length ? m.causes.map((c) => say(`${c.likely}: ${c.title}`)) : [],
    noCodes: !codes.length,
  };
}

// Live data the mechanic view lists. Anything the scan did not read shows 'not read'.
const MECH_PIDS = [
  ['stft_b1', 'STFT bank 1', '%'], ['ltft_b1', 'LTFT bank 1', '%'], ['stft_b2', 'STFT bank 2', '%'], ['ltft_b2', 'LTFT bank 2', '%'],
  ['o2_b1s1_v', 'O2 B1S1', 'V'], ['o2_b1s2_v', 'O2 B1S2', 'V'], ['maf_gs', 'MAF', 'g/s'], ['map_kpa', 'MAP', 'kPa'],
  ['rpm', 'RPM', 'rpm'], ['coolant_temp_f', 'Coolant temp', '°F'], ['intake_temp_f', 'IAT', '°F'], ['timing_adv_deg', 'Timing advance', '° BTDC'],
  ['engine_load', 'Calculated load', '%'], ['throttle', 'Throttle position', '%'], ['module_voltage', 'Control module voltage', 'V'],
  ['speed_mph', 'Vehicle speed', 'mph'], ['fuel_level', 'Fuel level', '%'], ['run_time_s', 'Run time since start', 's'],
];
const NOT_READ = 'not read';
const val = (v, u) => (v === null || v === undefined || v === '' ? NOT_READ : `${v}${u ? ' ' + u : ''}`);
const UNIT = Object.fromEntries(MECH_PIDS.map(([k, , u]) => [k, u]));

function buildMechanic(m, scan) {
  const sc = scan || {};
  const p = sc.pids || {};
  const vehicle = (m && m.mechanic && m.mechanic.vehicle) || null;
  let library = []; let lib = {};
  try { const d = require('../../../baseline/mobile/src/data/dtcCodes'); library = d.CODES || []; lib = d.BY_CODE || {}; } catch (e) { library = []; }
  const codes = codeList(sc).map(({ code, statuses }) => {
    const r = lookup(code, statuses[0]);
    const fam = code.slice(0, 4);
    return {
      code, status: statuses.join(' + '),
      title: r ? (r.officialTitle || r.title) : NOT_READ,
      system: SYSTEM[code[0]] || 'unknown',
      causes: r && r.causes ? r.causes : [],
      tests: r && r.check ? r.check : [],
      repair: r && r.known ? r.fix : null,
      parts: lib[code] && lib[code].parts ? `$${lib[code].parts[0]}–$${lib[code].parts[1]} parts` : null,
      labor: r && r.known && r.laborHours ? `${r.laborHours[0]}–${r.laborHours[1]} h` : null,
      shop: r && r.priceText ? r.priceText.shop : null,
      related: library.filter((x) => x.code !== code && x.code.slice(0, 4) === fam).slice(0, 4).map((x) => `${x.code} ${x.t}`),
    };
  });
  const ff = sc.freezeFrame;
  const freeze = ff && ff.values ? { code: ff.code || NOT_READ, values: Object.keys(ff.values).map((k) => ({ name: k, value: val(ff.values[k], UNIT[k] || '') })) } : null;
  const recall = vehicle && vehicle.recalls ? vehicle.recalls.text : (sc.vehicleSummary && sc.vehicleSummary.recalls ? sc.vehicleSummary.recalls.text : null);
  return {
    levelCode: m ? m.levelCode : null,
    codes,
    freezeFrame: freeze, // null = not read
    mil: { on: sc.monitor ? !!sc.monitor.milOn : null,
      distance: val(mi(p.dist_mil_on_km), 'mi'), time: val(p.time_mil_on_min, 'min') },
    sinceClear: { distance: val(mi(p.dist_since_clear_km), 'mi'), time: val(p.time_since_clear_min, 'min'), warmups: val(p.warmups_since_clear, '') },
    pids: MECH_PIDS.map(([k, label, u]) => ({ key: k, label, value: val(p[k], u) })),
    monitors: sc.monitor && Array.isArray(sc.monitor.monitors) ? sc.monitor.monitors.map((x) => ({ name: x.name, state: x.complete ? 'complete' : 'incomplete', type: x.continuous ? 'continuous' : 'non-continuous' })) : [],
    causes: (m && m.causes) || [],
    recall: recall || 'not checked (add your VIN)',
    ledger: (m && m.mechanic && m.mechanic.ledgerSize) || null,
    vehicle: vehicle ? vehicle.name : null,
  };
}

/** Demo only: a local model for a saved demo scan, from the offline code library (worst code urgency). Labeled a replay. */
function demoModel(scan) {
  const TONE = { ok: 'green', soon: 'yellow', stop: 'red' };
  const LEVEL = { green: 'SAFE_TO_DRIVE', yellow: 'INSPECT_SOON', red: 'DO_NOT_DRIVE' };
  let tone = 'green';
  const actions = [];
  codeList(scan).forEach(({ code, statuses }) => {
    const r = lookup(code, statuses[0]); if (!r) return;
    const t = TONE[(Object.keys(TONE).find((k) => r.urgency && r.urgency.color && ({ ok: 'green', soon: 'orange', stop: 'red' })[k] === r.urgency.color)) || 'soon'];
    if (['green', 'yellow', 'red'].indexOf(t) > ['green', 'yellow', 'red'].indexOf(tone)) tone = t;
    if (r.known && actions.length < 3) actions.push(`Ask a shop about code ${code}: ${r.fix.toLowerCase()}.`);
  });
  if (!actions.length) actions.push('Nothing to fix right now. Keep up regular service.');
  return { tone, levelCode: LEVEL[tone], actions, causes: [], mechanic: { vehicle: null }, replay: scan.demoLabel || 'Demo replay' };
}

const MODES_LIST = MODES;
module.exports = { MODES_LIST, demoModel, codeList, features, loadChosen, saveViewMode, PORT_HELP, SENSOR_STEPS, NOSENSOR_STEPS, GLOSSARY, explainTerms, PLAIN_VERDICT, buildPlain, buildMechanic, MECH_PIDS, NOT_READ };
