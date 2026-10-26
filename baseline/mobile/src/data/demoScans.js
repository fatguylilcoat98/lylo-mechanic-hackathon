/*
 * LYLO Mechanic — demo scans (no adapter needed). Clearly labelled DEMO in the UI.
 */
'use strict';

const base = {
  adapter: 'DEMO (no adapter)', protocol: '6', isCan: true, permanentSupported: true, supported: [], notes: [],
  deviceName: 'Demo mode', deviceModel: 'Demo',
};

const DEMO_SCANS = {
  usedcar: {
    ...base,
    demoLabel: 'Demo: used car where the seller just cleared the codes',
    vin: '1HGCM82633A004352',
    vehicle: { vin: '1HGCM82633A004352', year: 2003, make: 'Honda' },
    monitor: {
      milOn: false, dtcCount: 0, engineType: 'gasoline',
      monitors: [
        { name: 'Misfire', complete: true, continuous: true },
        { name: 'Fuel system', complete: true, continuous: true },
        { name: 'Comprehensive components', complete: true, continuous: true },
        { name: 'Catalyst', complete: false, continuous: false },
        { name: 'Evaporative system (EVAP)', complete: false, continuous: false },
        { name: 'Oxygen sensor', complete: false, continuous: false },
        { name: 'Oxygen sensor heater', complete: true, continuous: false },
        { name: 'EGR / VVT system', complete: true, continuous: false },
      ],
      incomplete: ['Catalyst', 'Evaporative system (EVAP)', 'Oxygen sensor'],
    },
    stored: [], pending: ['P0420'], permanent: ['P0171'],
    pids: { dist_since_clear_km: 19, warmups_since_clear: 3, time_since_clear_min: 41, dist_mil_on_km: 0, time_mil_on_min: 0, module_voltage: 14.1, rpm: 720, coolant_temp_f: 192, ltft_b1: 14.8, stft_b1: 3.1 },
  },
  checkengine: {
    ...base,
    demoLabel: 'Demo: check-engine light on',
    vin: '1HGCM82633A004352',
    vehicle: { vin: '1HGCM82633A004352', year: 2003, make: 'Honda' },
    monitor: {
      milOn: true, dtcCount: 2, engineType: 'gasoline',
      monitors: [
        { name: 'Misfire', complete: true, continuous: true },
        { name: 'Fuel system', complete: true, continuous: true },
        { name: 'Comprehensive components', complete: true, continuous: true },
        { name: 'Catalyst', complete: true, continuous: false },
        { name: 'Evaporative system (EVAP)', complete: true, continuous: false },
        { name: 'Oxygen sensor', complete: true, continuous: false },
        { name: 'Oxygen sensor heater', complete: true, continuous: false },
      ],
      incomplete: [],
    },
    stored: ['P0302', 'P0171'], pending: ['P0302'], permanent: ['P0302'],
    pids: { dist_since_clear_km: 6400, warmups_since_clear: 255, time_since_clear_min: 9800, dist_mil_on_km: 210, module_voltage: 14.3, rpm: 690, coolant_temp_f: 195, ltft_b1: 18.0, stft_b1: 6.3 },
  },
};

module.exports = { DEMO_SCANS };
