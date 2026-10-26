/*
 * LYLO Mechanic hackathon v0.4.3: "Check the price" buttons.
 * Opens each store's OWN public search page in the phone's browser. No scraping, no
 * unofficial APIs, no affiliate or tracking tags; we never fetch prices ourselves.
 * The only number we show is LYLO's own repair-cost range, labeled "Estimate".
 * URL patterns checked Oct 26 2026 (see hackathon/server/evidence/price_links.md).
 */
'use strict';

const enc = (s) => encodeURIComponent(String(s).replace(/\s+/g, ' ').trim());
const slug = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, '+');

// kind: 'local' (store near you, can check pickup) | 'online'
const STORES = [
  { id: 'autozone', name: 'AutoZone', kind: 'local', url: (q) => `https://www.autozone.com/searchresult?searchText=${enc(q)}` },
  { id: 'oreilly', name: "O'Reilly", kind: 'local', url: (q) => `https://www.oreillyauto.com/search?q=${enc(q)}` },
  { id: 'advance', name: 'Advance Auto Parts', kind: 'local', url: (q) => `https://shop.advanceautoparts.com/web/SearchResults?searchTerm=${enc(q)}` },
  { id: 'napa', name: 'NAPA', kind: 'local', url: (q) => `https://www.napaonline.com/en/search?text=${enc(q)}` },
  // RockAuto has no public keyword-search URL; its public catalog page for the exact vehicle is stable.
  { id: 'rockauto', name: 'RockAuto (online)', kind: 'online', needsVehicle: true,
    url: (q, v) => `https://www.rockauto.com/en/catalog/${slug(v.make)},${v.year},${slug(v.model)}` },
];

// Parts the Photo Helper jobs are about (search words), and LYLO repair_costs keys when we have one.
const JOB_PARTS = {
  engine_air_filter: { part: 'engine air filter' },
  cabin_air_filter: { part: 'cabin air filter' },
  battery: { part: 'car battery', costKey: 'weak_battery' },
  wipers: { part: 'wiper blades' },
  bulb: { part: 'headlight bulb' },
  tires: { part: 'tires' },
};
// Copied from baseline/backend/data/pricing/repair_costs.json (a test keeps them in sync).
const REPAIR_COSTS = {
  weak_battery: { parts: [80, 200], shop: [110, 280] },
};

const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const range = (lo, hi) => `${money(lo)}–${money(hi)}`;

function vehicleName(v) {
  if (!v || !v.year || !v.make || !v.model) return '';
  return `${v.year} ${v.make} ${v.model}`;
}

/** Part name from a baseline "fix" line, only when it clearly names a part to buy. */
function partFromFix(fix) {
  const m = /\breplace\s+(?:the\s+)?([a-z0-9 \-/()]+?)(?:\s+if\b|\s+or\b|,|\(|$)/i.exec(String(fix || ''));
  if (!m) return null;
  const p = m[1].trim();
  return p.length >= 3 && p.length <= 40 ? p : null;
}

/** Part name from a cause line like "Faulty MAP sensor" (Mechanic view). */
function partFromCause(cause) {
  const m = /^(?:faulty|bad|failed|failing|worn|weak|clogged|dirty|leaking|sticking|cracked|damaged)\s+(.+)$/i.exec(String(cause || '').trim());
  if (!m || /leak|wiring|connector|ground|gasket passages/i.test(m[1])) return null;
  return m[1].replace(/\s*\(.*\)$/, '');
}

/**
 * @param part search words, e.g. "crankshaft position sensor"
 * @param vehicle {year, make, model} (decoded from VIN) or null
 * @param estimate optional string, e.g. "$120 – $300" from LYLO price data
 * @returns {title, query, estimate, buttons:[{store, kind, url}], note} or null
 */
function priceLinks(part, vehicle, estimate) {
  if (!part) return null;
  const name = vehicleName(vehicle);
  const query = name ? `${name} ${part}` : part;
  const buttons = STORES.filter((s) => !s.needsVehicle || name)
    .map((s) => ({ store: s.name, kind: s.kind, url: s.url(query, vehicle || {}) }));
  return {
    title: `Check the price: ${part}`,
    query,
    estimate: estimate ? `Estimate: ${estimate}` : 'Estimate: not in LYLO\'s price data',
    buttons,
    note: name ? 'Opens the store\'s own website. Prices and fit are theirs, not LYLO\'s.'
      : 'Add your VIN so the stores can match the part to your car. Opens the store\'s own website.',
  };
}

function forJob(jobId, vehicle) {
  const j = JOB_PARTS[jobId];
  if (!j) return null;
  const c = j.costKey && REPAIR_COSTS[j.costKey];
  return priceLinks(j.part, vehicle, c ? `${range(...c.parts)} for the part, ${range(...c.shop)} at a shop` : null);
}

function forCode(codeResult, vehicle) {
  const part = codeResult && partFromFix(codeResult.fix);
  if (!part) return null;
  const shop = codeResult.priceText && codeResult.priceText.shop;
  return priceLinks(part, vehicle, shop && !/unknown|diagnosis/i.test(shop) ? `${shop} at a shop` : null);
}

module.exports = { STORES, JOB_PARTS, REPAIR_COSTS, priceLinks, forJob, forCode, partFromFix, partFromCause, vehicleName };
