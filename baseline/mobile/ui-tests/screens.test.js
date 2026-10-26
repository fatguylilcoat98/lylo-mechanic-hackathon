/*
 * UI smoke tests (jest-expo): render the real screens and click through the
 * demo flows, with Bluetooth native modules mocked.
 */
import React from 'react';
import { render, fireEvent, act } from './testUtils';

jest.mock('react-native-ble-plx', () => {
  const devices = [
    { id: 'AA:BB', name: 'OBDLink CX', rssi: -60 },
    { id: 'CC:DD', name: 'JBL Speaker', rssi: -40 },
    { id: 'EE:FF', name: 'Vgate iCar Pro', rssi: -70 },
  ];
  return {
    BleManager: jest.fn().mockImplementation(() => ({
      state: jest.fn().mockResolvedValue('PoweredOn'),
      startDeviceScan: jest.fn((uuids, opts, cb) => devices.forEach((d) => cb(null, d))),
      stopDeviceScan: jest.fn(),
    })),
  };
}, { virtual: true });
jest.mock('react-native-bluetooth-classic', () => ({
  __esModule: true,
  default: { getBondedDevices: jest.fn().mockResolvedValue([{ id: '11:22', address: '11:22', name: 'OBDLink MX+ 47011' }]) },
}), { virtual: true });

import { PermissionsAndroid, Alert } from 'react-native';
import App from '../src/App';
import ConnectScreen from '../src/screens/ConnectScreen';
import CodesScreen from '../src/screens/CodesScreen';
import { DEMO_SCANS } from '../src/data/demoScans';

beforeAll(() => {
  jest.spyOn(PermissionsAndroid, 'requestMultiple').mockImplementation(async (perms) => {
    const r = {}; perms.forEach((p) => { r[p] = 'granted'; }); return r;
  });
});

const nav = { navigate: jest.fn(), replace: jest.fn(), popToTop: jest.fn() };

test('Home renders and the Used-Car demo shows the recently-cleared warning', async () => {
  const ui = render(<App />);
  expect(ui.getByText('LYLO Mechanic')).toBeTruthy();
  expect(ui.getByText(/TEST BUILD v0.4.1/)).toBeTruthy();
  expect(ui.getByText('Powered by Meta AI')).toBeTruthy();
  await act(async () => { fireEvent.press(ui.getByText('Demo: Used-Car Check')); });
  expect(await ui.findByText('CONCERNS FOUND')).toBeTruthy();
  expect(ui.getByText(/Codes look RECENTLY CLEARED/)).toBeTruthy();
  expect(ui.getAllByText(/P0420/).length).toBeGreaterThan(0);
  // open a code from the used-car screen
  await act(async () => { fireEvent.press(ui.getByText('Catalyst System Efficiency Below Threshold (Bank 1)')); });
  expect(await ui.findByText('What to say at the shop')).toBeTruthy();
  expect(ui.getByText(/estimate, not a quote/i)).toBeTruthy();
});

test('Check-engine demo lists codes; clear codes is blocked in demo mode', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const ui = render(<CodesScreen route={{ params: { scan: DEMO_SCANS.checkengine } }} navigation={nav} />);
  expect(ui.getByText('Check-engine light is ON')).toBeTruthy();
  expect(ui.getByText('P0302')).toBeTruthy();
  expect(ui.getByText('P0171')).toBeTruthy();
  fireEvent.press(ui.getByText('Clear codes (after a repair)'));
  expect(alert).toHaveBeenCalledWith('Demo mode', expect.any(String));
});

jest.setTimeout(20000);

test('Connect screen lists OBDLink adapters first with the CX 5-minute note', async () => {
  const ui = render(<ConnectScreen navigation={nav} />);
  expect(ui.getByText(/first 5 minutes after it's plugged in/)).toBeTruthy();
  expect(await ui.findByText('OBDLink CX')).toBeTruthy();
  expect(await ui.findByText('OBDLink MX+ 47011')).toBeTruthy();
  expect(ui.getAllByText('Bluetooth LE').length).toBeGreaterThan(0);
  expect(ui.getAllByText('Classic (paired)').length).toBeGreaterThan(0);
  expect(ui.queryByText('JBL Speaker')).toBeNull(); // non-OBD hidden by default
  ui.unmount();
});

test('Code lookup works offline', async () => {
  const ui = render(<App />);
  await act(async () => { fireEvent.press(ui.getByText('Look up a trouble code')); });
  const input = await ui.findByPlaceholderText(/Type a code/);
  fireEvent.changeText(input, 'gas cap');
  expect(ui.getAllByText(/EVAP/).length).toBeGreaterThan(0);
});

// v0.4.1: one consistent verdict when the LYLO server is stricter than the on-phone check.
import UsedCarScreen from '../src/screens/UsedCarScreen';
const cleanScan = () => {
  const s = JSON.parse(JSON.stringify(DEMO_SCANS.checkengine));
  s.stored = []; s.pending = []; s.permanent = [];
  s.monitor.milOn = false; s.monitor.dtcCount = 0;
  s.pids = { rpm: 984, coolant_temp_f: 79, stft_b1: 27.3, ltft_b1: 6.3, module_voltage: 14.1 };
  delete s.demoLabel;
  return s;
};
const withServer = (s, level) => ({ ...s, serverDiagnosis: { source: 'server', result: { safety: { level } } } });

test('Used-car: no serverDiagnosis keeps the baseline verdict', () => {
  const ui = render(<UsedCarScreen route={{ params: { scan: cleanScan() } }} navigation={nav} />);
  expect(ui.getByText('LOOKS GOOD')).toBeTruthy();
  expect(ui.queryByText('GET IT INSPECTED SOON')).toBeNull();
});

test('Used-car + Codes: server answered -> one verdict, no LOOKS GOOD', () => {
  const s = withServer(cleanScan(), 'INSPECT_SOON');
  const ui = render(<UsedCarScreen route={{ params: { scan: s } }} navigation={nav} />);
  expect(ui.queryByText('LOOKS GOOD')).toBeNull();
  expect(ui.getAllByText(/Get it checked soon/).length).toBe(1);
  const c = render(<CodesScreen route={{ params: { scan: s } }} navigation={nav} />);
  expect(c.getAllByText(/Get it checked soon/).length).toBe(1);
  expect(c.queryByText('No trouble codes found.')).toBeNull();
});
