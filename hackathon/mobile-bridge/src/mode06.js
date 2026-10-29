/*
 * LYLO Mechanic v0.5.1: Mode 06 misfire monitor decoder (CAN, SAE J1979). Pure function, not yet called by the
 * live scan (the scan does not send 06 requests). Monitor IDs A2..AD are cylinders 1..12, so AA/AB are cylinders
 * 9 and 10 on a V10. TID 0B = misfire count over the last 10 drive cycles (EWMA), TID 0C = this/last cycle.
 * Pre-CAN cars (e.g. a 1998 J1850 Ford) use maker-specific Mode 06 and are reported as not supported.
 */
const MID_FIRST = 0xa2;
const MAX_CYL = 12;

/** bytes: response data bytes for one or more "46 MID TID UASID valHi valLo minHi minLo maxHi maxLo" records. */
function decodeMisfire(bytes, opts = {}) {
  const tid = opts.tid === undefined ? 0x0b : opts.tid;
  const b = Array.isArray(bytes) ? bytes.filter((x) => Number.isInteger(x) && x >= 0 && x <= 255) : [];
  const counts = {};
  let i = b[0] === 0x46 ? 1 : 0;
  while (i + 9 <= b.length) {
    const [mid, t] = [b[i], b[i + 1]];
    const value = (b[i + 3] << 8) | b[i + 4];
    if (mid >= MID_FIRST && mid < MID_FIRST + MAX_CYL && t === tid) counts[String(mid - MID_FIRST + 1)] = value;
    i += 9;
    if (b[i] === 0x46) i += 1; // multi-frame responses repeat the service byte
  }
  const n = Object.keys(counts).length;
  return n ? { supported: true, misfire_counts: counts, source: 'Mode 06 (car)' } : { supported: false, misfire_counts: null, source: 'Mode 06 (car)' };
}

/** Cylinder number -> Mode 06 monitor id (1 -> 0xA2 ... 10 -> 0xAB). */
const midFor = (cyl) => (Number.isInteger(cyl) && cyl >= 1 && cyl <= MAX_CYL ? MID_FIRST + cyl - 1 : null);

module.exports = { decodeMisfire, midFor, MAX_CYL };
