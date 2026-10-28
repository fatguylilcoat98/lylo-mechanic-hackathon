/* v0.4.5 hackathon: Home "No adapter? Start here" entry (flag ON); no Bluetooth permission prompt or BLE manager at launch. */
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
import { PermissionsAndroid } from 'react-native';
import { BleManager } from 'react-native-ble-plx';

// Same as a build with EXPO_PUBLIC_LYLO_NO_ADAPTER=1 (Expo inlines the env at build time, so mock the flag reader here).
jest.mock('../../../hackathon/mobile-bridge/src/noAdapter', () => {
  const real = jest.requireActual('../../../hackathon/mobile-bridge/src/noAdapter');
  return { ...real, features: (env) => real.features(env || { EXPO_PUBLIC_LYLO_NO_ADAPTER: '1' }) };
});
const App = require('../src/App').default;

test('launch: no Bluetooth prompt, Home shows "No adapter? Start here" and opens the screen', async () => {
  const ask = jest.spyOn(PermissionsAndroid, 'requestMultiple');
  const ui = render(<App />);
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(ask).not.toHaveBeenCalled();
  expect(BleManager).not.toHaveBeenCalled();
  const btns = ui.getAllByText('No adapter? Start here');
  await act(async () => { fireEvent.press(btns[btns.length - 1]); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(ui.getByTestId('no-adapter-screen')).toBeTruthy();
  expect(ui.getByTestId('obdlink-card')).toBeTruthy();
  expect(ask).not.toHaveBeenCalled();
});
