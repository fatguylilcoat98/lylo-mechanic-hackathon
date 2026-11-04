/* v0.7.2: Simple/Mechanic view (EXPO_PUBLIC_LYLO_VIEW_MODE=1). Synthetic data and stubs only. */
import React from 'react';
import { render, fireEvent, act } from './testUtils';
jest.mock('react-native-ble-plx', () => ({ BleManager: jest.fn().mockImplementation(() => ({ state: jest.fn().mockResolvedValue('PoweredOn'), startDeviceScan: jest.fn(), stopDeviceScan: jest.fn() })) }), { virtual: true });
jest.mock('react-native-bluetooth-classic', () => ({ __esModule: true, default: { getBondedDevices: jest.fn().mockResolvedValue([]) } }), { virtual: true });
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useFocusEffect: () => {} }));

import HomeV2 from '../../../hackathon/mobile-bridge/src/ui2/HomeV2';
import ResultsV2 from '../../../hackathon/mobile-bridge/src/ui2/ResultsV2';
import { DemoViews } from '../../../hackathon/mobile-bridge/src/DemoScreen';
import { SimpleGuide, PortHelp, MechanicDeep } from '../../../hackathon/mobile-bridge/src/ViewModeScreens';
const VM = require('../../../hackathon/mobile-bridge/src/viewModes');
const truck = () => JSON.parse(JSON.stringify(require('../../../hackathon/mobile-bridge/test/fixtures/truck.json').scan));
const memStore = (init = {}) => { const m = { ...init }; return { m, getItem: async (k) => m[k] ?? null, setItem: async (k, v) => { m[k] = v; } }; };
const nav = () => ({ navigate: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => () => {}) });
const mount = async (el) => { const ui = render(el); await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); return ui; };
const ON = { EXPO_PUBLIC_LYLO_VIEW_MODE: '1' };

test('flag off: home has no view choice or toggle', async () => {
  const ui = await mount(<HomeV2 navigation={nav()} noAdapterOn demoOn={false} env={{}} storage={memStore()} />);
  expect(ui.queryByTestId('vm-choice')).toBeNull(); expect(ui.queryByTestId('vm-toggle')).toBeNull();
  expect(ui.getByTestId('primary-action')).toBeTruthy();
});

test('flag on: opening choice shows before anything else, is remembered, Simple opens the guide', async () => {
  const st = memStore(); const n = nav();
  const ui = await mount(<HomeV2 navigation={n} noAdapterOn demoOn={false} env={ON} storage={st} />);
  expect(ui.getByTestId('vm-choice')).toBeTruthy(); expect(ui.queryByTestId('primary-action')).toBeNull();
  await act(async () => { fireEvent.press(ui.getByTestId('vm-simple')); });
  expect(st.m['lylo.viewMode']).toBe('simple'); expect(n.navigate).toHaveBeenCalledWith('Guide');
  const ui2 = await mount(<HomeV2 navigation={nav()} noAdapterOn demoOn={false} env={ON} storage={memStore({ 'lylo.viewMode': 'mechanic' })} />);
  expect(ui2.queryByTestId('vm-choice')).toBeNull(); expect(ui2.getByTestId('vm-toggle')).toBeTruthy();
});

test('simple guide: sensor question, then one step per screen; port help has the drawing and tips', async () => {
  const n = nav();
  const ui = await mount(<SimpleGuide navigation={n} />);
  expect(ui.getByText('Do you have an OBD sensor?')).toBeTruthy();
  fireEvent.press(ui.getByTestId('vm-sensor-yes'));
  expect(ui.getByTestId('vm-step-where')).toBeTruthy(); expect(ui.getByTestId('vm-port-drawing')).toBeTruthy();
  expect(ui.getByText("Can't find it?")).toBeTruthy(); expect(ui.getByText(/from 1996 on/)).toBeTruthy();
  for (const id of ['off', 'plug', 'key', 'light', 'pair']) { fireEvent.press(ui.getByTestId('vm-next')); expect(ui.getByTestId('vm-step-' + id)).toBeTruthy(); }
  fireEvent.press(ui.getByTestId('vm-go')); expect(n.navigate).toHaveBeenCalledWith('Connect', { then: 'scan' }) // v0.7.5: guide -> Connect -> Scan;
});

test('simple guide without a sensor walks dash photo, problem photo, describe, code (existing screens)', async () => {
  const n = nav();
  const ui = await mount(<SimpleGuide navigation={n} />);
  fireEvent.press(ui.getByTestId('vm-sensor-no'));
  const seen = [];
  for (const id of ['dash', 'photo', 'describe', 'code']) { expect(ui.getByTestId('vm-step-' + id)).toBeTruthy(); seen.push(id); fireEvent.press(ui.getByTestId('vm-go')); if (id !== 'code') fireEvent.press(ui.getByTestId('vm-next')); }
  expect(n.navigate.mock.calls.map((c) => c[0])).toEqual(['NoAdapter', 'PhotoHelper', 'NoAdapter', 'NoAdapter']);
});

test('results: toggle switches Simple (plain, one verdict) and Mechanic (dense, not read, port link)', async () => {
  const st = memStore({ 'lylo.viewMode': 'simple' }); const n = nav();
  const ui = await mount(<ResultsV2 scan={truck()} screen="codes" storage={st} viewEnv={ON} navigation={n} />);
  expect(ui.getByTestId('vm-plain')).toBeTruthy(); expect(ui.queryByTestId('vm-mechanic')).toBeNull();
  await act(async () => { fireEvent.press(ui.getByTestId('vm-toggle-mechanic')); });
  expect(st.m['lylo.viewMode']).toBe('mechanic');
  expect(ui.getByTestId('vm-mechanic')).toBeTruthy(); expect(ui.getAllByText('not read').length).toBeGreaterThan(0);
  fireEvent.press(ui.getByTestId('vm-port-link')); expect(n.navigate).toHaveBeenCalledWith('PortHelp');
});

test('results flag off: unchanged (no toggle)', async () => {
  const ui = await mount(<ResultsV2 scan={truck()} screen="codes" storage={memStore()} viewEnv={{}} />);
  expect(ui.queryByTestId('vm-toggle')).toBeNull(); expect(ui.queryByTestId('vm-plain')).toBeNull();
});

test('demo shows both views', async () => {
  const ui = await mount(<DemoViews navigation={nav()} />);
  expect(ui.getByTestId('vm-plain')).toBeTruthy(); expect(ui.getByText(/REPLAY/)).toBeTruthy();
  fireEvent.press(ui.getByTestId('vm-toggle-mechanic'));
  expect(ui.getByTestId('vm-mechanic')).toBeTruthy(); expect(ui.getByTestId('vm-dtc-P0302')).toBeTruthy();
});

test('port help renders on its own (mechanic help link target)', async () => {
  const ui = await mount(<PortHelp />);
  expect(ui.getByTestId('vm-port-drawing')).toBeTruthy(); expect(ui.getByText(/Push the sensor in firmly/)).toBeTruthy();
});
