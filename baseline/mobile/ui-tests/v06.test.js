/* v0.6: no-sensor home, Crash Guard simulate flow, collision checklist, Show-me follow-ups. Synthetic data, stubs only. */
import React from 'react';
import { render, fireEvent, act } from './testUtils';
jest.mock('react-native-ble-plx', () => ({ BleManager: jest.fn().mockImplementation(() => ({ state: jest.fn().mockResolvedValue('PoweredOn'), startDeviceScan: jest.fn(), stopDeviceScan: jest.fn() })) }), { virtual: true });
jest.mock('react-native-bluetooth-classic', () => ({ __esModule: true, default: { getBondedDevices: jest.fn().mockResolvedValue([]) } }), { virtual: true });
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useFocusEffect: () => {} }));
jest.mock('expo-sensors', () => ({ Accelerometer: { setUpdateInterval: jest.fn(), addListener: jest.fn(() => ({ remove: jest.fn() })) } }));
jest.mock('expo-location', () => ({ Accuracy: { High: 4 }, requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getLastKnownPositionAsync: jest.fn(async () => ({ coords: { latitude: 38.5, longitude: -121.4, accuracy: 10 } })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 38.5, longitude: -121.4, accuracy: 10 } })),
  watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })) }));
jest.mock('expo-sms', () => ({ isAvailableAsync: jest.fn(async () => true), sendSMSAsync: jest.fn(async () => ({ result: 'sent' })) }));
jest.mock('expo-mail-composer', () => ({ isAvailableAsync: jest.fn(async () => true), composeAsync: jest.fn(async () => ({ status: 'sent' })) }));
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(), deactivateKeepAwake: jest.fn() }));

import HomeV2 from '../../../hackathon/mobile-bridge/src/ui2/HomeV2';
import CrashGuardScreen from '../../../hackathon/mobile-bridge/src/CrashGuardScreen';
import CollisionScreen from '../../../hackathon/mobile-bridge/src/CollisionScreen';
afterEach(() => { jest.useRealTimers(); });

const nav = () => ({ navigate: jest.fn(), goBack: jest.fn() });
const mount = async (el) => { const ui = render(el); await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); return ui; };

test('home: flag off = old primary; NOSENSOR_HOME=1 = "Tell LYLO what\'s wrong" primary, adapter secondary', async () => {
  let ui = await mount(<HomeV2 navigation={nav()} noAdapterOn demoOn={false} env={{}} />);
  expect(ui.getByText('Scan with adapter')).toBeTruthy();
  expect(ui.queryByText("Tell LYLO what's wrong")).toBeNull();
  expect(ui.queryByText('Crash Guard')).toBeNull();
  const n = nav();
  ui = await mount(<HomeV2 navigation={n} noAdapterOn demoOn={false} env={{ EXPO_PUBLIC_LYLO_NOSENSOR_HOME: '1', EXPO_PUBLIC_LYLO_CRASH_GUARD: '1', EXPO_PUBLIC_LYLO_COLLISION: '1' }} />);
  fireEvent.press(ui.getByText("Tell LYLO what's wrong"));
  expect(n.navigate).toHaveBeenCalledWith('NoAdapter', undefined);
  expect(ui.getByText('Have an OBD adapter? Scan')).toBeTruthy();
  expect(ui.queryByText('No adapter? Start here')).toBeNull();
  expect(ui.getByText('Crash Guard')).toBeTruthy();
  expect(ui.getByText('I was in a collision')).toBeTruthy();
});

test('crash guard: off flag renders nothing; simulate shows countdown, I\'m OK goes to collision question', async () => {
  let ui = await mount(<CrashGuardScreen navigation={nav()} env={{}} />);
  expect(ui.queryByTestId('cg-screen')).toBeNull();
  const n = nav();
  ui = await mount(<CrashGuardScreen navigation={n} env={{ EXPO_PUBLIC_LYLO_CRASH_GUARD: '1' }} />);
  expect(ui.getByTestId('cg-not911')).toBeTruthy();
  await act(async () => { fireEvent.press(ui.getByTestId('cg-simulate')); });
  expect(ui.getByText('Are you okay?')).toBeTruthy();
  expect(ui.getByText('30')).toBeTruthy();
  await act(async () => { fireEvent.press(ui.getByTestId('cg-ok')); });
  expect(n.navigate).toHaveBeenCalledWith('Collision', { ask: true });
});

test('crash guard: no answer for 60 s in TEST mode sends nothing and shows the preview', async () => {
  const real = Date.now; let off = 0; const spy = jest.spyOn(Date, 'now').mockImplementation(() => real() + off);
  const wait = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
  try {
    const fetchImpl = jest.fn();
    const ui = await mount(<CrashGuardScreen navigation={nav()} fetchImpl={fetchImpl} env={{ EXPO_PUBLIC_LYLO_CRASH_GUARD: '1' }} />);
    await act(async () => { fireEvent.press(ui.getByTestId('cg-simulate')); });
    off = 31000; await wait(400);
    expect(ui.getByText(/Last check: are you okay/)).toBeTruthy();
    off = 61000; await wait(600);
    expect(ui.getByText(/TEST: nothing was sent/)).toBeTruthy();
    expect(fetchImpl).not.toHaveBeenCalled();
  } finally { spy.mockRestore(); }
});

test('collision: asks first; yes -> checklist; send opens mail composer with report', async () => {
  const Mail = require('expo-mail-composer');
  let ui = await mount(<CollisionScreen navigation={nav()} route={{ params: { ask: true } }} env={{ EXPO_PUBLIC_LYLO_COLLISION: '1' }} />);
  expect(ui.getByText('Were you in a collision?')).toBeTruthy();
  await act(async () => { fireEvent.press(ui.getByTestId('col-yes')); await new Promise((r) => setTimeout(r, 10)); });
  expect(ui.getByText(/not legal or insurance advice/)).toBeTruthy();
  fireEvent.changeText(ui.getByTestId('col-field-police_report'), 'R-123');
  await act(async () => { fireEvent.press(ui.getByTestId('col-send')); });
  const arg = Mail.composeAsync.mock.calls[0][0];
  expect(arg.body).toMatch(/Police report number \/ officer: R-123/);
  expect(arg.body).toMatch(/38\.50000, -121\.40000/);
});

test('show-me: causes labeled guesses, follow-up tap re-runs with the owner answer, fix-it card shows', async () => {
  const NoAdapterScreen = require('../../../hackathon/mobile-bridge/src/NoAdapterScreen').default;
  const bodies = [];
  const reply = { final_safety_level: 'INSPECT_SOON', answer_status: 'verified', answer: { text: 'Likely a dirty air filter (a guess).', status: 'verified' },
    hypotheses: [{ id: 'h1', cause: 'clogged air filter', confidence: 'medium' }], follow_up_checks: [{ text: 'Is it worse at high speed?' }], symptom_matches: [] };
  const fetchImpl = jest.fn(async (u, o) => { bodies.push(o.body); return { ok: true, status: 200, json: async () => reply }; });
  const env = { EXPO_PUBLIC_LYLO_NO_ADAPTER: '1', EXPO_PUBLIC_LYLO_SERVER_URL: 'https://x.invalid', EXPO_PUBLIC_LYLO_SHOWME: '1' };
  const ui = await mount(<NoAdapterScreen navigation={nav()} env={env} fetchImpl={fetchImpl} baseUrl="https://x.invalid" appKey="k" storage={{ getItem: async () => null, setItem: async () => {} }} />);
  fireEvent.changeText(ui.getByTestId('symptom-text'), 'sluggish when I speed up');
  await act(async () => { fireEvent.press(ui.getByTestId('check-it')); await new Promise((r) => setTimeout(r, 10)); });
  expect(ui.getByText(/Possible causes \(all guesses\)/)).toBeTruthy();
  expect(ui.getByTestId('sm-fixit')).toBeTruthy();
  await act(async () => { fireEvent.press(ui.getByText('Yes')); await new Promise((r) => setTimeout(r, 10)); });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  const field = (b, k) => (b._parts ? (b._parts.find((p) => p[0] === k) || [])[1] : b.get && b.get(k));
  expect(field(bodies[1], 'text')).toBe('sluggish when I speed up');
  expect(JSON.parse(field(bodies[1], 'followup_answers'))).toEqual([{ question: 'Is it worse at high speed?', answer: 'yes' }]);
});
