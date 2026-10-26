/*
 * LYLO Mechanic hackathon: everyday names for OBD readings (no PID jargon).
 * friendly(item) -> { label, value } for ledger items { name, value, unit }.
 */
'use strict';

const LABELS = {
  ENGINE_COOLANT_TEMP: 'Engine temperature',
  ENGINE_RPM: 'Engine speed',
  SHORT_TERM_FUEL_TRIM_B1: 'Fuel adjustment',
  LONG_TERM_FUEL_TRIM_B1: 'Learned fuel adjustment',
  SHORT_TERM_FUEL_TRIM_B2: 'Fuel adjustment (side 2)',
  LONG_TERM_FUEL_TRIM_B2: 'Learned fuel adjustment (side 2)',
  BATTERY_VOLTAGE: 'Battery',
  ENGINE_LOAD: 'How hard the engine is working',
  THROTTLE_POSITION: 'Gas pedal opening',
  INTAKE_AIR_TEMP: 'Air temperature going in',
  VEHICLE_SPEED: 'Speed',
  RUN_TIME_SINCE_START: 'Running since start',
  FUEL_LEVEL: 'Fuel in tank',
  DIST_MIL_ON: 'Miles with warning light on',
  TIME_MIL_ON: 'Time with warning light on',
  TIME_SINCE_CODES_CLEARED: 'Engine time since codes were erased',
  WARMUPS_SINCE_CLEAR: 'Warm-ups since codes were erased',
  DIST_SINCE_CODES_CLEARED: 'Miles since codes were erased',
};

const MONITORS = {
  misfire: 'Misfire check', fuel_system: 'Fuel system check', comprehensive_components: 'Parts check',
  catalyst: 'Catalytic converter check', evaporative_system_evap: 'Fuel vapor (EVAP) check',
  oxygen_sensor: 'Oxygen sensor check', oxygen_sensor_heater: 'Oxygen sensor heater check',
  egr_vvt_system: 'EGR / valve timing check', heated_catalyst: 'Heated catalyst check',
  secondary_air_system: 'Secondary air check',
};

const n = (v) => (typeof v === 'number' ? v : Number(v));
const round = (v, d = 0) => { const p = 10 ** d; return Math.round(n(v) * p) / p; };

function formatValue(name, value, unit) {
  if (value === null || value === undefined || value === '' || Number.isNaN(n(value))) return '—';
  const u = String(unit || '');
  if (/FUEL_TRIM/.test(name)) { const r = round(value); return (r > 0 ? '+' : '') + r + '%'; }
  if (/°?C$/.test(u) && /TEMP/.test(name)) return round(n(value) * 9 / 5 + 32) + ' °F';
  if (/F$/.test(u)) return round(value) + ' °F';
  if (u === 'km') return round(n(value) * 0.621371).toLocaleString('en-US') + ' mi';
  if (u === 'min') { const h = n(value) / 60; return h >= 1 ? round(h, 1) + ' hours' : round(value) + ' min'; }
  if (u === 's') return round(n(value) / 60, 1) + ' min';
  if (u === 'rpm') return round(value) + ' rpm';
  if (u === 'V') return round(value, 1) + ' V';
  if (u === '%') return round(value) + '%';
  if (u === 'mph') return round(value) + ' mph';
  return String(round(value, 1)) + (u ? ' ' + u : '');
}

function labelFor(name) {
  if (LABELS[name]) return LABELS[name];
  return String(name || '').toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function monitorLabel(id) {
  const k = String(id || '').replace(/^mon:/, '');
  return MONITORS[k] || labelFor(k.toUpperCase());
}

/** Everyday label for any ledger item. */
function friendly(item) {
  if (!item || typeof item !== 'object') return null;
  const id = String(item.id || '');
  if (id.startsWith('pid:')) return { label: labelFor(item.name), value: formatValue(item.name, item.value, item.unit) };
  if (id.startsWith('mon:')) return { label: monitorLabel(id), value: item.status === 'complete' || item.complete ? 'Done' : 'Not finished' };
  if (id.startsWith('dtc:')) return { label: 'Warning code ' + item.code, value: item.status === 'permanent' ? 'stored' : String(item.status || '') };
  if (id.startsWith('photo:')) return { label: 'Photo: ' + String(item.name || '').replace(/_/g, ' '), value: item.color || '' };
  if (id.startsWith('clr:')) return { label: 'Signs codes were erased', value: '' };
  return null; // rule:*, veh:* etc. are not shown in the everyday view
}

module.exports = { LABELS, MONITORS, formatValue, labelFor, monitorLabel, friendly };
