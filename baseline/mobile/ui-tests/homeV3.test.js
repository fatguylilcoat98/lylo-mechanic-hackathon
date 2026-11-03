/* Home v3 polish (EXPO_PUBLIC_LYLO_HOME_V3=1). Synthetic data and stubs only. */
import React from 'react';
import { render, fireEvent, act } from './testUtils';
jest.mock('react-native-ble-plx', () => ({ BleManager: jest.fn().mockImplementation(() => ({ state: jest.fn().mockResolvedValue('PoweredOn'), startDeviceScan: jest.fn(), stopDeviceScan: jest.fn() })) }), { virtual: true });
jest.mock('react-native-bluetooth-classic', () => ({ __esModule: true, default: { getBondedDevices: jest.fn().mockResolvedValue([]) } }), { virtual: true });
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useFocusEffect: () => {} }));
import HomeV2 from '../../../hackathon/mobile-bridge/src/ui2/HomeV2';
const memStore = (init = {}) => { const m = { ...init }; return { m, getItem: async (k) => m[k] ?? null, setItem: async (k, v) => { m[k] = v; } }; };
const nav = () => ({ navigate: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => () => {}) });
const mount = async (el) => { const ui = render(el); await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); return ui; };
const ON = { EXPO_PUBLIC_LYLO_HOME_V3: '1', EXPO_PUBLIC_LYLO_VIEW_MODE: '1', EXPO_PUBLIC_LYLO_CRASH_GUARD: '1', EXPO_PUBLIC_LYLO_COLLISION: '1' };

test('flag off: old home, no v3', async () => {
  const ui = await mount(<HomeV2 navigation={nav()} noAdapterOn demoOn={false} env={{}} storage={memStore()} />);
  expect(ui.queryByTestId('home-v3')).toBeNull(); expect(ui.getByTestId('primary-action')).toBeTruthy();
});

test('flag on: cards route, toggle switches and saves mode, tabs are honest', async () => {
  const st = memStore({ 'lylo.viewMode': 'simple' }); const n = nav();
  const ui = await mount(<HomeV2 navigation={n} noAdapterOn demoOn env={ON} storage={st} />);
  expect(ui.getByTestId('home-v3')).toBeTruthy();
  fireEvent.press(ui.getByTestId('primary-action')); expect(n.navigate).toHaveBeenLastCalledWith('Guide', undefined);
  await act(async () => { fireEvent.press(ui.getByTestId('vm-toggle-mechanic')); });
  expect(st.m['lylo.viewMode']).toBe('mechanic');
  fireEvent.press(ui.getByTestId('primary-action')); expect(n.navigate).toHaveBeenLastCalledWith('Connect', undefined);
  fireEvent.press(ui.getByTestId('card-demo')); expect(n.navigate).toHaveBeenLastCalledWith('Demo', undefined);
  fireEvent.press(ui.getByTestId('tab-garage')); expect(n.navigate).toHaveBeenLastCalledWith('Vin', undefined);
  expect(ui.queryByTestId('tab-history')).toBeNull();
  fireEvent.press(ui.getByTestId('tab-more')); expect(ui.getByTestId('more-tools')).toBeTruthy();
});

test('flag on, crash/collision flags off: those cards hidden', async () => {
  const ui = await mount(<HomeV2 navigation={nav()} noAdapterOn demoOn env={{ EXPO_PUBLIC_LYLO_HOME_V3: '1' }} storage={memStore()} />);
  expect(ui.queryByTestId('card-crash')).toBeNull(); expect(ui.queryByTestId('card-collision')).toBeNull();
});
