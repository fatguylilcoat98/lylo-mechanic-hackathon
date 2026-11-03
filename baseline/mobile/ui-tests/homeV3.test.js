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
  fireEvent.press(ui.getByTestId('tab-garage')); expect(n.navigate).toHaveBeenLastCalledWith('Vin');
  expect(ui.queryByTestId('tab-history')).toBeNull();
  fireEvent.press(ui.getByTestId('tab-more')); expect(ui.getByTestId('more-tools')).toBeTruthy();
});

test('flag on, crash/collision flags off: those cards hidden', async () => {
  const ui = await mount(<HomeV2 navigation={nav()} noAdapterOn demoOn env={{ EXPO_PUBLIC_LYLO_HOME_V3: '1' }} storage={memStore()} />);
  expect(ui.queryByTestId('card-crash')).toBeNull(); expect(ui.queryByTestId('card-collision')).toBeNull();
});

import ResultsV2 from '../../../hackathon/mobile-bridge/src/ui2/ResultsV2';
import { SimpleHomeV3, MechanicHomeV3 } from '../../../hackathon/mobile-bridge/src/ui2/ModeScreensV3';
const truck = () => JSON.parse(JSON.stringify(require('../../../hackathon/mobile-bridge/test/fixtures/truck.json').scan));
const V3 = { EXPO_PUBLIC_LYLO_HOME_V3: '1' }; const VMON = { EXPO_PUBLIC_LYLO_VIEW_MODE: '1' };

test('home toggle opens the two distinct screens', async () => {
  const n = nav(); const st = memStore({ 'lylo.viewMode': 'simple' });
  const ui = await mount(<HomeV2 navigation={n} noAdapterOn demoOn env={ON} storage={st} />);
  await act(async () => { fireEvent.press(ui.getByTestId('vm-toggle-mechanic')); });
  expect(n.navigate).toHaveBeenLastCalledWith('MechanicHome');
  await act(async () => { fireEvent.press(ui.getByTestId('vm-toggle-simple')); });
  expect(n.navigate).toHaveBeenLastCalledWith('SimpleHome');
});

test('Simple screen: guided flow up front, technical tools collapsed', async () => {
  const n = { ...nav(), replace: jest.fn() }; const st = memStore();
  const ui = await mount(<SimpleHomeV3 navigation={n} storage={st} />);
  expect(ui.getByTestId('vm-sensor-q')).toBeTruthy(); expect(ui.getByTestId('tab-bar')).toBeTruthy();
  expect(ui.queryByTestId('simple-tech-body')).toBeNull();
  fireEvent.press(ui.getByTestId('simple-tech')); expect(ui.getByTestId('simple-tech-body')).toBeTruthy();
  await act(async () => { fireEvent.press(ui.getByTestId('vm-toggle-mechanic')); });
  expect(st.m['lylo.viewMode']).toBe('mechanic'); expect(n.replace).toHaveBeenCalledWith('MechanicHome');
});

test('Mechanic screen: everything expanded, no dropdown, demo labeled', async () => {
  const ui = await mount(<MechanicHomeV3 navigation={{ ...nav(), replace: jest.fn() }} storage={memStore()} />);
  expect(ui.getByTestId('vm-mechanic')).toBeTruthy(); expect(ui.getByText(/DEMO REPLAY/)).toBeTruthy();
  expect(ui.queryByTestId('simple-tech')).toBeNull();
});

test('Results v3 Simple: plain answer, technical details collapsed until tapped', async () => {
  const ui = await mount(<ResultsV2 scan={truck()} viewEnv={VMON} homeEnv={V3} storage={memStore({ 'lylo.viewMode': 'simple' })} />);
  expect(ui.getByTestId('results-simple-v3')).toBeTruthy();
  expect(ui.queryByTestId('vm-mechanic')).toBeNull(); expect(ui.queryByTestId('results-tech-body')).toBeNull();
  fireEvent.press(ui.getByTestId('results-tech')); expect(ui.getByTestId('vm-mechanic')).toBeTruthy();
});

test('Results v3 Mechanic: deep view and mechanic details open with no tap', async () => {
  const ui = await mount(<ResultsV2 scan={truck()} viewEnv={VMON} homeEnv={V3} storage={memStore({ 'lylo.viewMode': 'mechanic' })} />);
  expect(ui.getByTestId('results-mechanic-v3')).toBeTruthy(); expect(ui.getByTestId('vm-mechanic')).toBeTruthy();
  expect(ui.getByText(/Hide mechanic details/)).toBeTruthy();
});

test('Results flag off: old view switch, no v3 blocks', async () => {
  const ui = await mount(<ResultsV2 scan={truck()} viewEnv={VMON} homeEnv={{}} storage={memStore({ 'lylo.viewMode': 'simple' })} />);
  expect(ui.queryByTestId('results-simple-v3')).toBeNull(); expect(ui.getByTestId('vm-plain')).toBeTruthy();
});
