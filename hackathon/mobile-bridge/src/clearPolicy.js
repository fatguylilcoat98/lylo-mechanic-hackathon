/*
 * LYLO Mechanic v0.7.3 clear-codes policy (flag EXPO_PUBLIC_LYLO_SESSION_V2=1). Pure CommonJS.
 * - Clearing needs an explicit two-step confirm (warning, then a final confirm).
 * - The warning says clearing resets readiness monitors and does NOT fix the fault.
 * - Clearing is NOT offered while any safety-level code is active (stored, pending or permanent),
 *   or when the LYLO server rated the scan red/unsafe.
 * Safety-level = a conservative fixed list (ANY B, C or U code incl. manufacturer-specific, Vera C1;
 * overheating, oil pressure, engine misfire). EVAP/emissions codes such as P04E0 are NOT safety-level.
 */
'use strict';

const CODE_INFO = {
  P04E0: { title: 'EVAP System Purge Control Valve "A" Stuck Closed', source: 'SAE J2012 generic (same meaning on every make)', system: 'Evaporative emissions (fuel vapor purge)', level: 'emissions',
    note: 'An emissions fault, not a driveability or safety fault. Common causes: purge valve, its hose or connector. The car\'s maker may add detail in its own service info.' },
};

const SAFETY_RULES = [
  [/^C[0-9A-F]{4}$/, 'Chassis code (brakes, ABS, stability, steering, suspension)'],
  [/^B[0-9A-F]{4}$/, 'Body code (airbag, restraints, lighting, body systems)'],
  [/^U[0-9A-F]{4}$/, 'Network code (modules not talking, can affect safety systems)'],
  [/^P021[78]$/, 'Engine or transmission overheating'],
  [/^P052[0-4]$/, 'Engine oil pressure'],
  [/^P030\d$|^P031[0-2]$/, 'Engine misfire (can overheat the catalytic converter)'],
];

function safetyReason(code) {
  const c = String(code || '').toUpperCase();
  for (const [re, why] of SAFETY_RULES) if (re.test(c)) return why;
  return null;
}
function classify(code) {
  const c = String(code || '').toUpperCase();
  const why = safetyReason(c);
  if (why) return { code: c, level: 'safety', why };
  return { code: c, level: (CODE_INFO[c] && CODE_INFO[c].level) || 'other', why: null, info: CODE_INFO[c] || null };
}

function activeCodes(scan) {
  const s = scan || {}; const out = [];
  ['stored', 'pending', 'permanent'].forEach((k) => (Array.isArray(s[k]) ? s[k] : []).forEach((c) => out.push({ code: String(c).toUpperCase(), kind: k })));
  return out;
}

/** Can the Clear button be offered for this scan? */
function canOffer(scan) {
  const blockers = activeCodes(scan).map((x) => ({ ...x, ...classify(x.code) })).filter((x) => x.level === 'safety');
  const lv = scan && scan.serverDiagnosis && scan.serverDiagnosis.result && scan.serverDiagnosis.result.safety && scan.serverDiagnosis.result.safety.level;
  const serverRed = /^(red|unsafe|stop|danger)/i.test(String(lv || ''));
  if (blockers.length || serverRed) {
    return { ok: false, blockers, serverRed,
      reason: 'Clearing is not offered while a safety-level problem is active' + (blockers.length ? ` (${blockers.map((b) => `${b.code}: ${b.why}`).join('; ')})` : ' (the LYLO safety check rated this scan unsafe)') + '. Get it repaired first.' };
  }
  return { ok: true, blockers: [], serverRed: false, reason: null };
}

const WARNING = {
  title: 'Clear codes? Read this first',
  body: 'Clearing does NOT fix the fault. If the problem is still there, the code and the check-engine light will come back.\n\n'
    + '• It resets the readiness monitors (emissions self-tests). The car will not pass a smog check until it has been driven enough to finish them, often several days.\n'
    + '• It erases freeze-frame data a mechanic could use.\n'
    + '• Permanent codes cannot be erased by any scan tool.\n\n'
    + 'LYLO will record what was there before, when you cleared it, and why, then rescan to show what is left.',
  confirm: 'I understand, continue',
  final: { title: 'Clear codes now?', body: 'Best with the engine OFF and the ignition ON. This cannot be undone.', confirm: 'Clear codes' },
};

/** Two-step flow as a pure state machine: idle -> warned -> confirmed. Returns next state or a block. */
function step(state, action, scan) {
  const offer = canOffer(scan);
  if (!offer.ok) return { state: 'blocked', reason: offer.reason };
  if (action === 'cancel') return { state: 'idle' };
  if (state === 'idle' && action === 'tap') return { state: 'warned', show: WARNING };
  if (state === 'warned' && action === 'ack') return { state: 'final', show: WARNING.final };
  if (state === 'final' && action === 'confirm') return { state: 'confirmed' };
  return { state: 'idle' }; // anything out of order resets; never clears
}

/** Before/after record for the clear (vehicle-reported facts only; LYLO's own timestamp and reason). */
function clearRecord(before, why, nowIso) {
  return { at: nowIso || new Date().toISOString(), why: why || 'After a repair, to confirm the fix',
    vin: (before && before.vin) || null, sessionId: (before && before.session && before.session.id) || null,
    before: activeCodes(before), milBefore: before && before.monitor ? !!before.monitor.milOn : null };
}

module.exports = { CODE_INFO, classify, safetyReason, activeCodes, canOffer, WARNING, step, clearRecord };
