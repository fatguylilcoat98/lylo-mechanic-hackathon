/*
 * LYLO Mechanic — OBD-II response decoders (pure functions, no RN deps).
 *
 * Input is the `lines` array from parser.parseResponse() — the adapter is
 * initialised with ATE0 ATL0 ATS0 ATH0, so lines are compact hex with no
 * headers, e.g. "4101830761A0" or, for multi-frame CAN, "014", "0:4902...".
 *
 * Unit-tested in decoders.test.js.
 */

'use strict';

const KM_TO_MI = 0.621371;

const cleanHex = (l) => String(l || '').replace(/\s+/g, '').toUpperCase();
const isHex = (s) => /^[0-9A-F]+$/.test(s);
const hexToBytes = (h) => {
  const out = [];
  for (let i = 0; i + 2 <= h.length; i += 2) out.push(parseInt(h.substr(i, 2), 16));
  return out;
};

/**
 * Turn the response lines into a list of "messages" (byte arrays).
 * Handles single-frame lines and ISO-TP multi-frame blocks that the
 * ELM/STN prints as:  "00A" / "0:430401330420" / "1:01710300000000".
 */
function collectMessages(lines) {
  const msgs = [];
  let multi = null; // {len, bytes}
  const flush = () => {
    if (multi) {
      const bytes = multi.len ? multi.bytes.slice(0, multi.len) : multi.bytes;
      if (bytes.length) msgs.push(bytes);
      multi = null;
    }
  };
  for (const raw of lines || []) {
    const line = cleanHex(raw);
    if (!line) continue;
    const frame = /^([0-9A-F]):([0-9A-F]+)$/.exec(line);
    if (frame) {
      if (!multi) multi = { len: 0, bytes: [] };
      if (frame[1] === '0' && multi.bytes.length) { flush(); multi = { len: 0, bytes: [] }; }
      multi.bytes = multi.bytes.concat(hexToBytes(frame[2]));
      continue;
    }
    if (!isHex(line)) continue;
    // A bare 3-hex-digit line right before "0:" is the total byte count.
    if (line.length === 3) {
      flush();
      multi = { len: parseInt(line, 16), bytes: [] };
      continue;
    }
    flush();
    msgs.push(hexToBytes(line));
  }
  flush();
  return msgs;
}

// ── DTCs ──────────────────────────────────────────────────────────
const DTC_LETTERS = ['P', 'C', 'B', 'U'];

function bytesToDtc(a, b) {
  if (a === 0 && b === 0) return null;
  const letter = DTC_LETTERS[(a >> 6) & 3];
  const d1 = (a >> 4) & 3;
  const d2 = (a & 0x0f).toString(16).toUpperCase();
  const rest = b.toString(16).toUpperCase().padStart(2, '0');
  return letter + d1 + d2 + rest;
}

/**
 * Decode Mode 03 / 07 / 0A responses.
 *   mode: '03' | '07' | '0A'
 *   isCan: true/false/null (null = guess per message)
 * Returns unique, ordered list of code strings.
 */
function decodeDTCs(lines, mode, isCan) {
  const respByte = (parseInt(mode, 16) + 0x40);
  const found = [];
  const add = (c) => { if (c && found.indexOf(c) === -1) found.push(c); };
  for (const msg of collectMessages(lines)) {
    if (!msg.length || msg[0] !== respByte) continue;
    const body = msg.slice(1);
    let can = isCan;
    if (can === null || can === undefined) {
      // CAN responses carry a count byte: 1 + 2*count bytes (maybe padded).
      const n = body[0];
      can = body.length % 2 === 1 && n * 2 <= body.length - 1 && (n * 2 === body.length - 1 || body.slice(1 + n * 2).every((x) => x === 0));
    }
    const pairs = can ? body.slice(1, 1 + body[0] * 2) : body;
    for (let i = 0; i + 1 < pairs.length; i += 2) add(bytesToDtc(pairs[i], pairs[i + 1]));
  }
  return found;
}

// ── Mode 01 helpers ───────────────────────────────────────────────
/** Find the data bytes for a Mode 01 PID (first ECU that answered). */
function mode01Bytes(lines, pid) {
  const want = pid.toUpperCase();
  for (const msg of collectMessages(lines)) {
    if (msg.length >= 2 && msg[0] === 0x41 && msg[1] === parseInt(want, 16)) return msg.slice(2);
  }
  return null;
}

/** Decode a "PIDs supported" bitmap (0100 / 0120 / 0140 ...). */
function decodeSupported(lines, basePid) {
  const base = parseInt(basePid, 16);
  const out = new Set();
  for (const msg of collectMessages(lines)) {
    if (msg.length < 6 || msg[0] !== 0x41 || msg[1] !== base) continue;
    const bits = msg.slice(2, 6);
    for (let i = 0; i < 32; i++) {
      if (bits[i >> 3] & (0x80 >> (i & 7))) {
        out.add((base + i + 1).toString(16).toUpperCase().padStart(2, '0'));
      }
    }
  }
  return out;
}

const SPARK_MONITORS = ['Catalyst', 'Heated catalyst', 'Evaporative system (EVAP)', 'Secondary air system', 'A/C refrigerant', 'Oxygen sensor', 'Oxygen sensor heater', 'EGR / VVT system'];
const DIESEL_MONITORS = ['NMHC catalyst', 'NOx / SCR aftertreatment', null, 'Boost pressure', null, 'Exhaust gas sensor', 'Particulate filter (DPF)', 'EGR / VVT system'];
const CONTINUOUS = ['Misfire', 'Fuel system', 'Comprehensive components'];

/** Decode 0101: MIL, DTC count, readiness monitors. */
function decodeMonitorStatus(bytes) {
  if (!bytes || bytes.length < 4) return null;
  const [A, B, C, D] = bytes;
  const diesel = !!(B & 0x08);
  const monitors = [];
  for (let i = 0; i < 3; i++) {
    if (B & (1 << i)) monitors.push({ name: CONTINUOUS[i], complete: !(B & (1 << (i + 4))), continuous: true });
  }
  const names = diesel ? DIESEL_MONITORS : SPARK_MONITORS;
  for (let i = 0; i < 8; i++) {
    if (!names[i]) continue;
    if (C & (1 << i)) monitors.push({ name: names[i], complete: !(D & (1 << i)), continuous: false });
  }
  const incomplete = monitors.filter((m) => !m.complete).map((m) => m.name);
  return { milOn: !!(A & 0x80), dtcCount: A & 0x7f, engineType: diesel ? 'diesel' : 'gasoline', monitors, incomplete };
}

const u16 = (b) => (b && b.length >= 2 ? b[0] * 256 + b[1] : null);

const PID_DEFS = {
  '04': { key: 'engine_load', label: 'Engine load', unit: '%', parse: (b) => Math.round(b[0] * 100 / 255) },
  '05': { key: 'coolant_temp_f', label: 'Coolant temp', unit: '°F', parse: (b) => Math.round((b[0] - 40) * 9 / 5 + 32) },
  '06': { key: 'stft_b1', label: 'Short-term fuel trim B1', unit: '%', parse: (b) => Math.round((b[0] - 128) * 1000 / 128) / 10 },
  '07': { key: 'ltft_b1', label: 'Long-term fuel trim B1', unit: '%', parse: (b) => Math.round((b[0] - 128) * 1000 / 128) / 10 },
  '0C': { key: 'rpm', label: 'Engine RPM', unit: 'rpm', parse: (b) => Math.round(u16(b) / 4) },
  '0D': { key: 'speed_mph', label: 'Vehicle speed', unit: 'mph', parse: (b) => Math.round(b[0] * KM_TO_MI) },
  '0F': { key: 'intake_temp_f', label: 'Intake air temp', unit: '°F', parse: (b) => Math.round((b[0] - 40) * 9 / 5 + 32) },
  '11': { key: 'throttle', label: 'Throttle position', unit: '%', parse: (b) => Math.round(b[0] * 100 / 255) },
  '1F': { key: 'run_time_s', label: 'Time since engine start', unit: 's', parse: u16 },
  '21': { key: 'dist_mil_on_km', label: 'Distance driven with check-engine light on', unit: 'km', parse: u16 },
  '2F': { key: 'fuel_level', label: 'Fuel level', unit: '%', parse: (b) => Math.round(b[0] * 100 / 255) },
  '30': { key: 'warmups_since_clear', label: 'Warm-ups since codes cleared', unit: '', parse: (b) => b[0] },
  '31': { key: 'dist_since_clear_km', label: 'Distance since codes cleared', unit: 'km', parse: u16 },
  '42': { key: 'module_voltage', label: 'Battery / module voltage', unit: 'V', parse: (b) => Math.round(u16(b) / 10) / 100 },
  '4D': { key: 'time_mil_on_min', label: 'Engine time with check-engine light on', unit: 'min', parse: u16 },
  '4E': { key: 'time_since_clear_min', label: 'Engine time since codes cleared', unit: 'min', parse: u16 },
};

function decodePid(lines, pid) {
  const def = PID_DEFS[pid];
  if (!def) return null;
  const b = mode01Bytes(lines, pid);
  if (!b || !b.length) return null;
  const v = def.parse(b);
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  return v;
}

// ── VIN (Mode 09 PID 02) ──────────────────────────────────────────
function decodeVIN(lines) {
  let bytes = [];
  const msgs = collectMessages(lines);
  // CAN: one message "49 02 01 <17 ascii>"
  for (const m of msgs) {
    if (m[0] === 0x49 && m[1] === 0x02 && m.length >= 20) { bytes = m.slice(3); break; }
  }
  // Legacy (J1850 / ISO 9141 / KWP): five lines "49 02 <seq> <4 bytes>"
  if (!bytes.length) {
    const parts = msgs.filter((m) => m[0] === 0x49 && m[1] === 0x02 && m.length === 7)
      .sort((a, b) => a[2] - b[2]);
    parts.forEach((m) => { bytes = bytes.concat(m.slice(3)); });
  }
  const text = bytes.filter((x) => x >= 0x30 && x <= 0x5a).map((x) => String.fromCharCode(x)).join('');
  const vin = text.replace(/[^A-HJ-NPR-Z0-9]/g, '');
  if (vin.length < 17) return null;
  return vin.slice(-17);
}

const VIN_YEAR = 'ABCDEFGHJKLMNPRSTVWXY123456789';
const WMI = {
  '1G': 'Chevrolet/GM', '1GC': 'Chevrolet', '1GT': 'GMC', '2G': 'GM (Canada)', '3G': 'GM (Mexico)',
  '1F': 'Ford', '2F': 'Ford (Canada)', '3F': 'Ford (Mexico)', '1L': 'Lincoln', '1ZV': 'Ford',
  '1C': 'Chrysler/Dodge/Jeep/Ram', '2C': 'Chrysler (Canada)', '3C': 'Chrysler/Ram (Mexico)', '1J': 'Jeep',
  '1H': 'Honda', '2H': 'Honda (Canada)', '5J': 'Honda/Acura', '19X': 'Honda', 'JH': 'Honda/Acura',
  '1N': 'Nissan', '3N': 'Nissan (Mexico)', '5N': 'Nissan', 'JN': 'Nissan/Infiniti',
  '4T': 'Toyota', '5T': 'Toyota', '2T': 'Toyota (Canada)', 'JT': 'Toyota/Lexus', '58A': 'Lexus',
  '1V': 'Volkswagen', '3V': 'Volkswagen (Mexico)', 'WV': 'Volkswagen', 'WA': 'Audi', 'WB': 'BMW', '5U': 'BMW', 'WD': 'Mercedes-Benz', '4J': 'Mercedes-Benz', '55': 'Mercedes-Benz', 'WP': 'Porsche',
  'KM': 'Hyundai', '5NP': 'Hyundai', 'KN': 'Kia', '5XY': 'Kia', 'JM': 'Mazda', 'JF': 'Subaru', '4S': 'Subaru', 'JA': 'Mitsubishi/Isuzu', 'YV': 'Volvo', 'SA': 'Land Rover/Jaguar', '5YJ': 'Tesla', '7SA': 'Tesla',
};

/** Offline VIN decode: model year + likely make. Not a full decode. */
function decodeVinOffline(vin) {
  if (!vin || vin.length !== 17) return null;
  const yc = vin[9];
  const idx = VIN_YEAR.indexOf(yc);
  let year = null;
  if (idx >= 0) {
    year = 1980 + idx;
    // 7th char alphabetic => 2010+ cycle (for North American vehicles)
    if (/[A-Z]/.test(vin[6]) && year < 2010) year += 30;
    if (year > new Date().getFullYear() + 1) year -= 30;
  }
  const make = WMI[vin.slice(0, 3)] || WMI[vin.slice(0, 2)] || null;
  return { vin, year, make };
}

const kmToMi = (km) => (km === null || km === undefined ? null : Math.round(km * KM_TO_MI));

module.exports = {
  collectMessages, bytesToDtc, decodeDTCs, mode01Bytes, decodeSupported,
  decodeMonitorStatus, decodePid, decodeVIN, decodeVinOffline, PID_DEFS, kmToMi,
};
