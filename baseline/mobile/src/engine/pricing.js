/*
 * LYLO Mechanic — repair price ESTIMATE model (not a quote).
 *
 *   DIY  = parts low .. parts high
 *   Shop = (parts x shop markup) + (labor hours x hourly rate)
 *
 * Assumptions (LYLO's own, general US figures — adjust as better data arrives):
 *   - Independent shop labor rate: $120 – $180 per hour
 *   - Shop parts markup: 1.3x (low) – 1.6x (high)
 *   - Dealer: roughly 20–40% above independent shops
 *   - Diagnostic fee when a shop has to find the cause: $100 – $200
 */
'use strict';

const RATE_LOW = 120;
const RATE_HIGH = 180;
const MARKUP_LOW = 1.3;
const MARKUP_HIGH = 1.6;
const DIAG_FEE = [100, 200];

const round10 = (n) => Math.round(n / 10) * 10;

function estimate(entry) {
  if (!entry) return null;
  const [pl, ph] = entry.parts;
  const [hl, hh] = entry.hrs;
  const shopLow = round10(pl * MARKUP_LOW + hl * RATE_LOW);
  const shopHigh = round10(ph * MARKUP_HIGH + hh * RATE_HIGH);
  return {
    diy: entry.diff === 'pro' ? null : [round10(pl), Math.max(round10(ph), 10)],
    shop: [Math.max(shopLow, 20), Math.max(shopHigh, 40)],
    dealer: [round10(shopLow * 1.2), round10(shopHigh * 1.4)],
    laborHours: entry.hrs,
    diagFee: DIAG_FEE,
  };
}

const money = (r) => (r ? '$' + r[0].toLocaleString('en-US') + ' – $' + r[1].toLocaleString('en-US') : 'N/A');

const ESTIMATE_NOTE = 'LYLO estimate, not a quote: typical US parts prices plus ' +
  'labor hours × $' + RATE_LOW + '–$' + RATE_HIGH + '/hr shop rate. Your car and area can be higher or lower. ' +
  'Shops may add a $' + DIAG_FEE[0] + '–$' + DIAG_FEE[1] + ' diagnostic fee.';

module.exports = { estimate, money, ESTIMATE_NOTE, RATE_LOW, RATE_HIGH, DIAG_FEE };
