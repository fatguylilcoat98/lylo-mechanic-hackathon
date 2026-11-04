/* v0.7.5 connect -> scan path (connect-loop fix), Simple and Mechanic. Stubs only, no Bluetooth. */
import React from 'react';
import { render, fireEvent, act } from './testUtils';
jest.mock('react-native-ble-plx', () => ({ BleManager: jest.fn().mockImplementation(() => ({ state: jest.fn().mockResolvedValue('PoweredOn'), startDeviceScan: jest.fn(), stopDeviceScan: jest.fn() })) }), { virtual: true });
jest.mock('react-native-bluetooth-classic', () => ({ __esModule: true, default: { getBondedDevices: jest.fn().mockResolvedValue([]) } }), { virtual: true });
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useFocusEffect: () => {} }));
jest.mock('../src/services/BluetoothService', () => ({
  requestPermissions: jest.fn(async () => ({ ok: true, locationOk: true })), isBluetoothOn: jest.fn(async () => true), log: jest.fn(), getLog: jest.fn(() => []),
  scan: jest.fn((cb) => { cb([{ key: 'cx1', id: 'cx1', name: 'OBDLink CX', kind: 'ble', rssi: -50, isOBDLink: true }]); return () => {}; }),
}));
import OBDService from '../src/services/OBDService';
import HomeV2 from '../../../hackathon/mobile-bridge/src/ui2/HomeV2';
import { SimpleGuide } from '../../../hackathon/mobile-bridge/src/ViewModeScreens';
import { MechanicHomeV3 } from '../../../hackathon/mobile-bridge/src/ui2/ModeScreensV3';
import ConnectScreen from '../src/screens/ConnectScreen';

const memStore = (init = {}) => { const m = { ...init }; return { m, getItem: async (k) => m[k] ?? null, setItem: async (k, v) => { m[k] = v; } }; };
const nav = () => { const l = {}; return { l, navigate: jest.fn(), goBack: jest.fn(), addListener: jest.fn((e, f) => { l[e] = f; return () => {}; }) }; };
const mount = async (el) => { const ui = render(el); await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); return ui; };
const ON = { EXPO_PUBLIC_LYLO_HOME_V3: '1', EXPO_PUBLIC_LYLO_VIEW_MODE: '1' };
const DEV = { name: 'OBDLink CX', key: 'cx1' };
let connected = false;
beforeEach(() => {
  connected = false;
  jest.spyOn(OBDService, 'connected', 'get').mockImplementation(() => connected);
  jest.spyOn(OBDService, 'device', 'get').mockImplementation(() => (connected ? DEV : null));
});
afterEach(() => jest.restoreAllMocks());

test('Simple home: Check My Car scans when a sensor is connected (no guide loop)', async () => {
  connected = true; const n = nav();
  const ui = await mount(<HomeV2 navigation={n} noAdapterOn demoOn env={ON} storage={memStore({ 'lylo.viewMode': 'simple' })} />);
  fireEvent.press(ui.getByTestId('primary-action'));
  expect(n.navigate).toHaveBeenLastCalledWith('Scan', { mode: 'codes' });
});

test('Mechanic home: Check My Car scans when connected', async () => {
  connected = true; const n = nav();
  const ui = await mount(<HomeV2 navigation={n} noAdapterOn demoOn env={ON} storage={memStore({ 'lylo.viewMode': 'mechanic' })} />);
  fireEvent.press(ui.getByTestId('primary-action'));
  expect(n.navigate).toHaveBeenLastCalledWith('Scan', { mode: 'codes' });
});

test('Simple guide: connected -> "Scan my car now" / "Connect a different sensor"', async () => {
  connected = true; const n = nav();
  const ui = await mount(<SimpleGuide navigation={n} />);
  expect(ui.getByTestId('vm-connected')).toBeTruthy();
  fireEvent.press(ui.getByTestId('vm-scan-now'));
  expect(n.navigate).toHaveBeenLastCalledWith('Scan', { mode: 'codes' });
  fireEvent.press(ui.getByTestId('vm-sensor-yes'));
  expect(ui.getByTestId('vm-step-where')).toBeTruthy();
});

test('Simple guide, not connected: last step opens Connect marked to scan next', async () => {
  const n = nav();
  const ui = await mount(<SimpleGuide navigation={n} />);
  fireEvent.press(ui.getByTestId('vm-sensor-yes'));
  for (let i = 0; i < 5; i++) fireEvent.press(ui.getByTestId('vm-next'));
  fireEvent.press(ui.getByTestId('vm-go'));
  expect(n.navigate).toHaveBeenLastCalledWith('Connect', { then: 'scan' });
});

test('ConnectScreen from the guide: after pairing goes straight to Scan; otherwise Home', async () => {
  for (const [params, want] of [[{ then: 'scan' }, ['Scan', { mode: 'codes' }]], [undefined, ['Home']]]) {
    jest.spyOn(OBDService, 'connect').mockImplementation(async () => { connected = true; });
    const n = nav();
    const ui = await mount(<ConnectScreen navigation={n} route={{ params }} />);
    await ui.findByText(/OBDLink CX/);
    const row = ui.getAllByText(/^OBDLink CX$/).map(ui._pressableFor).find((x) => typeof x.props.onPress === 'function');
    expect(row).toBeTruthy();
    await act(async () => { await row.props.onPress(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(n.navigate).toHaveBeenLastCalledWith(...want);
  }
});

test('Mechanic home re-reads the connection on focus (Full Scan goes to Scan after pairing)', async () => {
  const n = nav();
  const ui = await mount(<MechanicHomeV3 navigation={n} storage={memStore()} env={{}} />);
  fireEvent.press(ui.getByTestId('mech-scan'));
  expect(n.navigate).toHaveBeenLastCalledWith('Connect', undefined);
  connected = true;
  await act(async () => { n.l.focus && n.l.focus(); });
  fireEvent.press(ui.getByTestId('mech-scan'));
  expect(n.navigate).toHaveBeenLastCalledWith('Scan', { mode: 'codes' });
  expect(ui.getByTestId('obd-status')).toBeTruthy();
});
