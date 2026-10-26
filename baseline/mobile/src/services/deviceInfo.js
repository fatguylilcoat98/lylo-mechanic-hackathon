/*
 * LYLO Mechanic — identify OBD adapters from their Bluetooth names.
 * Pure function (unit-tested).
 */
'use strict';

const MODELS = [
  { re: /obdlink\s*cx/i, model: 'OBDLink CX', link: 'ble', note: 'Bluetooth LE. Pairs inside the app. Only accepts NEW pairing in the first 5 minutes after it is plugged in.' },
  { re: /obdlink\s*mx\s*\+|obdlink\s*mx\s*plus|obdlink\s*mxp/i, model: 'OBDLink MX+', link: 'classic', note: 'Classic Bluetooth. Pair it first in Android Bluetooth settings (press the button on the adapter), then pick it here.' },
  { re: /obdlink\s*lx/i, model: 'OBDLink LX', link: 'classic', note: 'Classic Bluetooth. Pair it first in Android Bluetooth settings (press the button on the adapter), then pick it here.' },
  { re: /obdlink\s*mx/i, model: 'OBDLink MX', link: 'classic', note: 'Classic Bluetooth. Pair it first in Android Bluetooth settings.' },
  { re: /obdlink/i, model: 'OBDLink', link: null, note: 'OBDLink adapter.' },
  { re: /obd|elm|vlink|vgate|v-link|konnwei|veepeak|carista|bimmer/i, model: 'OBD adapter (other brand)', link: null, note: 'Other-brand OBD adapter — may work, not tested.' },
];

function identifyAdapter(name) {
  const n = String(name || '');
  for (const m of MODELS) {
    if (m.re.test(n)) {
      return { model: m.model, preferredLink: m.link, note: m.note, isOBDLink: /obdlink/i.test(n), isOBD: true };
    }
  }
  return { model: null, preferredLink: null, note: '', isOBDLink: false, isOBD: false };
}

/** Sort: OBDLink first, then other OBD adapters, then the rest; strongest signal first. */
function sortDevices(list) {
  const rank = (d) => (d.isOBDLink ? 0 : d.isOBD ? 1 : 2);
  return list.slice().sort((a, b) => rank(a) - rank(b) || (b.rssi || -999) - (a.rssi || -999) || String(a.name).localeCompare(String(b.name)));
}

module.exports = { identifyAdapter, sortDevices };
