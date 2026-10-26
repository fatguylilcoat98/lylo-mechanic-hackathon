/*
 * LYLO Mechanic — offline diagnosis engine (replaces the server call).
 */
'use strict';

const { BY_CODE, CODES } = require('../data/dtcCodes');
const { estimate, money, ESTIMATE_NOTE } = require('./pricing');

const URGENCY = {
  ok: { level: 'SAFE TO DRIVE', color: 'green', message: 'You can keep driving, but plan the repair so it doesn\'t turn into something bigger.' },
  soon: { level: 'GET IT CHECKED SOON', color: 'orange', message: 'OK for short trips, but have it checked within a few days.' },
  stop: { level: 'DO NOT DRIVE', color: 'red', message: 'Driving could cause damage or be unsafe. Stop and get it towed or checked.' },
};
const DIFFICULTY = {
  easy: { level: 'Easy', label: 'DIY friendly — basic tools' },
  moderate: { level: 'Moderate', label: 'Experienced DIY or a shop' },
  pro: { level: 'Pro', label: 'Shop recommended' },
};

const SYSTEM_BY_LETTER = { P: 'engine / transmission', C: 'chassis (brakes, ABS, steering)', B: 'body (airbags, locks, climate)', U: 'computer network' };

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

/** Build the full plain-English result for one code. */
function buildCodeResult(rawCode, kind) {
  const code = normalizeCode(rawCode);
  const e = BY_CODE[code];
  if (!e) {
    const manufacturer = /^[PCBU][13]/.test(code);
    return {
      code, kind: kind || 'stored', known: false,
      title: manufacturer ? 'Manufacturer-specific code' : 'Code not in LYLO\'s library yet',
      plain: 'Your car\'s ' + (SYSTEM_BY_LETTER[code[0]] || 'computer') + ' system stored code ' + code + '. ' +
        (manufacturer ? 'This one is specific to your car\'s brand, so its meaning depends on the make and model.' : 'LYLO doesn\'t have this code in its offline library yet.'),
      causes: [], check: ['Look the code up for your exact make and model', 'A shop scan with an enhanced (brand-specific) scanner can pin it down'],
      urgency: URGENCY.soon, difficulty: { level: 'Unknown', label: 'Needs diagnosis' },
      fix: 'Professional diagnosis', price: null, priceText: { diy: 'Unknown', shop: 'Diagnosis first: $100 – $200', dealer: null },
      estimateNote: ESTIMATE_NOTE,
      shopScript: '"My scanner shows ' + code + '. Can you diagnose it and give me a written estimate before doing any work?"',
      redFlags: ['Ask for a written estimate before any work begins.', 'If the quote feels high, it\'s OK to get a second opinion.'],
    };
  }
  const price = estimate(e);
  const others = e.causes.slice(1, 3);
  const shopScript = '"I\'m getting code ' + code + ' (' + e.t + '). I understand it could be ' + e.causes[0].toLowerCase() +
    (others.length ? ', or possibly ' + others.map((x) => x.toLowerCase()).join(' or ') : '') +
    '. Can you confirm the cause before replacing parts? From what I\'ve read, the usual repair runs about ' + money(price.shop) + ' — does that sound right?"';
  const redFlags = [];
  if (e.flag) redFlags.push(e.flag);
  redFlags.push('If the quote is well above ' + money(price.shop) + ', ask for an itemized parts-and-labor breakdown.');
  redFlags.push('Ask: "Is there a cheaper fix we should try first?"');
  return {
    code, kind: kind || 'stored', known: true,
    title: e.t, plain: e.plain, causes: e.causes, check: e.check,
    urgency: URGENCY[e.urg], difficulty: DIFFICULTY[e.diff], fix: e.fix,
    price, priceText: { diy: price.diy ? money(price.diy) : 'Not a DIY job', shop: money(price.shop), dealer: money(price.dealer) },
    laborHours: e.hrs, estimateNote: ESTIMATE_NOTE, shopScript, redFlags,
  };
}

const URG_RANK = { red: 0, orange: 1, green: 2 };

/** Results for every code in a scan, most urgent first. */
function analyzeCodes(scan) {
  const out = [];
  const seen = new Set();
  const add = (code, kind) => {
    if (seen.has(code)) {
      const r = out.find((x) => x.code === code);
      if (r && r.alsoKinds.indexOf(kind) === -1) r.alsoKinds.push(kind);
      return;
    }
    seen.add(code);
    const r = buildCodeResult(code, kind);
    r.alsoKinds = [kind];
    out.push(r);
  };
  (scan.stored || []).forEach((c) => add(c, 'stored'));
  (scan.pending || []).forEach((c) => add(c, 'pending'));
  (scan.permanent || []).forEach((c) => add(c, 'permanent'));
  out.sort((a, b) => URG_RANK[a.urgency.color] - URG_RANK[b.urgency.color]);
  return out;
}

function searchCodes(query) {
  const q = String(query || '').trim().toUpperCase();
  if (!q) return [];
  return CODES.filter((c) => c.code.indexOf(q) === 0 || c.t.toUpperCase().indexOf(q) !== -1 || c.plain.toUpperCase().indexOf(q) !== -1).slice(0, 30);
}

const KIND_LABEL = {
  stored: 'Stored (confirmed — turns on the check-engine light)',
  pending: 'Pending (seen once — not confirmed yet)',
  permanent: 'Permanent (stays until the car proves it\'s fixed — clearing won\'t erase it)',
};

module.exports = { buildCodeResult, analyzeCodes, searchCodes, KIND_LABEL, URGENCY, DIFFICULTY };
