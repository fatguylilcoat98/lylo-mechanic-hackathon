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
  expect(ui.getByTestId('simple-check')).toBeTruthy(); expect(ui.getByTestId('tab-bar')).toBeTruthy();
  fireEvent.press(ui.getByTestId('simple-check')); expect(n.navigate).toHaveBeenLastCalledWith('Guide', undefined);
  expect(ui.queryByTestId('simple-tech-body')).toBeNull();
  fireEvent.press(ui.getByTestId('simple-tech')); expect(ui.getByTestId('simple-tech-body')).toBeTruthy();
  expect(ui.queryByTestId('vm-toggle')).toBeNull(); fireEvent.press(ui.getByTestId('vm-pill'));
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

import { PlainResults, stripLeadCode } from '../../../hackathon/mobile-bridge/src/ViewModeScreens';
const SAFE = { EXPO_PUBLIC_LYLO_CRASH_GUARD: '1', EXPO_PUBLIC_LYLO_COLLISION: '1' };
const CAVEAT = 'Crash Guard is not a replacement for 911. It can miss a crash or false-alarm; untested on real crashes.';

test('mode screens: Crash Guard / Collision cards gated on their flags, with the 911 caveat', async () => {
  for (const Screen of [SimpleHomeV3, MechanicHomeV3]) {
    const n = { ...nav(), replace: jest.fn() };
    const on = await mount(<Screen navigation={n} storage={memStore()} env={SAFE} />);
    expect(on.getByText(CAVEAT)).toBeTruthy();
    fireEvent.press(on.getByTestId('mode-crash')); expect(n.navigate).toHaveBeenLastCalledWith('CrashGuard', undefined);
    fireEvent.press(on.getByTestId('mode-collision')); expect(n.navigate).toHaveBeenLastCalledWith('Collision', undefined);
    const off = await mount(<Screen navigation={n} storage={memStore()} env={{}} />);
    expect(off.queryByTestId('mode-crash')).toBeNull(); expect(off.queryByTestId('mode-collision')).toBeNull(); expect(off.queryByText(CAVEAT)).toBeNull();
  }
});

test('noTech strips a leading code from verdict and to-do only; tone unchanged', async () => {
  expect(stripLeadCode('P0302: Get the misfire checked')).toBe('Get the misfire checked');
  expect(stripLeadCode('Check P0302 soon')).toBe('Check P0302 soon');
  const p = { verdict: { title: 'P0302 - Get it checked soon', why: 'U0100, lost talk' }, codes: [{ code: 'P0302', means: 'x', status: 's' }], ai: [], readings: [], todo: ['C1234 Check brakes', 'Drive gently'] };
  const ui = await mount(<PlainResults p={p} tone="red" noTech />);
  expect(ui.getByText('Get it checked soon')).toBeTruthy(); expect(ui.getByText('lost talk')).toBeTruthy();
  expect(ui.getByText(/1\.\s+Check brakes/)).toBeTruthy(); expect(ui.getByTestId('vm-verdict-red')).toBeTruthy();
  const full = await mount(<PlainResults p={p} tone="red" />); expect(full.getByText('P0302 - Get it checked soon')).toBeTruthy();
});

test('toggle and tabs have plain-word labels, no emoji', async () => {
  const ui = await mount(<HomeV2 navigation={nav()} noAdapterOn demoOn env={ON} storage={memStore({ 'lylo.viewMode': 'simple' })} />);
  const lbl = ui.getByTestId('vm-toggle-simple').props.accessibilityLabel;
  expect(lbl).toBe('Simple Mode, Step-by-step help'); expect(/\p{Extended_Pictographic}/u.test(lbl)).toBe(false);
});

test('mockup tiles: only real features; missing ones are not shown', async () => {
  const n = { ...nav(), replace: jest.fn() };
  const mech = await mount(<MechanicHomeV3 navigation={n} storage={memStore()} env={SAFE} />);
  for (const t of ['Live Data', 'Service & Repairs', 'System Tests', 'A/C', 'ABS', 'SRS', 'DPF', 'TPMS', 'History', 'Battery']) expect(mech.queryByText(t)).toBeNull();
  expect(mech.getByText(/Not connected/)).toBeTruthy();
  fireEvent.press(mech.getByTestId('mech-scan')); expect(n.navigate).toHaveBeenLastCalledWith('Connect', undefined);
  fireEvent.press(mech.getByTestId('obd-help')); expect(n.navigate).toHaveBeenLastCalledWith('PortHelp', undefined);
  fireEvent.press(mech.getByTestId('mech-diagnosis')); expect(n.navigate).toHaveBeenLastCalledWith('Demo', undefined);
  fireEvent.press(mech.getByTestId('mech-part')); expect(n.navigate).toHaveBeenLastCalledWith('PhotoHelper', undefined);
  const simp = await mount(<SimpleHomeV3 navigation={n} storage={memStore()} env={SAFE} />);
  for (const t of ['History', 'Settings']) expect(simp.queryByText(t)).toBeNull();
  fireEvent.press(simp.getByTestId('simple-say')); expect(n.navigate).toHaveBeenLastCalledWith('NoAdapter', { start: 'describe' });
  fireEvent.press(simp.getByTestId('simple-photo')); expect(n.navigate).toHaveBeenLastCalledWith('NoAdapter', { start: 'dash' });
  fireEvent.press(simp.getByTestId('tour-go')); expect(n.navigate).toHaveBeenLastCalledWith('Demo', undefined);
  fireEvent.press(simp.getByTestId('tour-no')); expect(simp.queryByTestId('tour-banner')).toBeNull();
  expect(simp.queryByTestId('simple-tech-body')).toBeNull();
});
