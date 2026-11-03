/* v0.7.1: Crash Guard name field, footer version, collision fault-first screen + Meta AI. Stubs only. */
import React from 'react';
import { render, fireEvent, act } from './testUtils';
jest.mock('react-native-ble-plx', () => ({ BleManager: jest.fn().mockImplementation(() => ({ state: jest.fn().mockResolvedValue('PoweredOn'), startDeviceScan: jest.fn(), stopDeviceScan: jest.fn() })) }), { virtual: true });
jest.mock('react-native-bluetooth-classic', () => ({ __esModule: true, default: { getBondedDevices: jest.fn().mockResolvedValue([]) } }), { virtual: true });
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useFocusEffect: () => {} }));
jest.mock('expo-sensors', () => ({ Accelerometer: { setUpdateInterval: jest.fn(), addListener: jest.fn(() => ({ remove: jest.fn() })) } }));
jest.mock('expo-location', () => ({ Accuracy: { High: 4 }, requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: false })),
  getLastKnownPositionAsync: jest.fn(async () => null), getCurrentPositionAsync: jest.fn(async () => null), watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })) }));
jest.mock('expo-sms', () => ({ isAvailableAsync: jest.fn(async () => true), sendSMSAsync: jest.fn(async () => ({ result: 'sent' })) }));
jest.mock('expo-mail-composer', () => ({ isAvailableAsync: jest.fn(async () => true), composeAsync: jest.fn(async () => ({ status: 'sent' })) }));
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(), deactivateKeepAwake: jest.fn() }));

import HomeV2 from '../../../hackathon/mobile-bridge/src/ui2/HomeV2';
import CrashGuardScreen from '../../../hackathon/mobile-bridge/src/CrashGuardScreen';
import CollisionScreen from '../../../hackathon/mobile-bridge/src/CollisionScreen';
const Mail = require('expo-mail-composer');
const appVersion = require('../app.json').expo.version;
const nav = () => ({ navigate: jest.fn(), goBack: jest.fn() });
const mount = async (el) => { const ui = render(el); await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); return ui; };

test('crash guard: name field accepts typing (was reverting to empty)', async () => {
  const ui = await mount(<CrashGuardScreen navigation={nav()} env={{ EXPO_PUBLIC_LYLO_CRASH_GUARD: '1' }} />);
  await act(async () => { ui.getByTestId('cg-name').props.onChangeText('Chris'); });
  expect(ui.getByTestId('cg-name').props.value).toBe('Chris');
});

test('home footer shows the app.json version, not v0.5.2', async () => {
  const ui = await mount(<HomeV2 navigation={nav()} noAdapterOn demoOn={false} env={{}} />);
  expect(ui.getByText(new RegExp('v' + appVersion.replace(/\./g, '\\.') + '$'))).toBeTruthy();
  expect(ui.queryByText(/v0\.5\.2/)).toBeNull();
});

const ON = { EXPO_PUBLIC_LYLO_COLLISION: '1', EXPO_PUBLIC_LYLO_COLLISION_AI: '1', EXPO_PUBLIC_LYLO_SERVER_URL: 'https://x.invalid' };

test('collision: COLLISION alone shows the fault screen first with Call 911; no AI button', async () => {
  const { Linking } = require('react-native');
  const spy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  const ui = await mount(<CollisionScreen navigation={nav()} env={{ EXPO_PUBLIC_LYLO_COLLISION: '1' }} />);
  expect(ui.getByTestId('col-fault')).toBeTruthy();
  expect(ui.queryByTestId('col-screen')).toBeNull();
  await act(async () => { fireEvent.press(ui.getByTestId('col-fault-911')); });
  expect(spy).toHaveBeenCalledWith('tel:911');
  await act(async () => { fireEvent.press(ui.getByTestId('col-fault-next')); });
  expect(ui.getByTestId('col-screen')).toBeTruthy();
  expect(ui.queryByTestId('col-ai')).toBeNull();
  spy.mockRestore();
});

test('collision: "Don\'t admit fault" renders FIRST, before photos', async () => {
  const ui = await mount(<CollisionScreen navigation={nav()} env={ON} />);
  expect(ui.getByTestId('col-fault')).toBeTruthy();
  expect(ui.queryByTestId('col-screen')).toBeNull();
  expect(ui.getByText("Don't admit fault")).toBeTruthy();
  expect(ui.getByText('General safety guidance, not legal advice.')).toBeTruthy();
  await act(async () => { fireEvent.press(ui.getByTestId('col-fault-next')); });
  expect(ui.getByTestId('col-photo-my_damage')).toBeTruthy();
});

test('collision AI: labelled result, kept in email; removed when toggled off; offline still sends', async () => {
  const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ collision_ai_status: 'ok', photos: [], summary: 'Neutral summary.', missing: ['No photo of the scene'] }) }));
  const ui = await mount(<CollisionScreen navigation={nav()} env={ON} fetchImpl={fetchImpl} />);
  await act(async () => { fireEvent.press(ui.getByTestId('col-fault-next')); });
  await act(async () => { fireEvent.press(ui.getByTestId('col-ai-ask')); });
  expect(ui.getByText('Written by Meta AI: check it before sending')).toBeTruthy();
  await act(async () => { fireEvent.press(ui.getByTestId('col-send')); });
  expect(Mail.composeAsync.mock.calls.pop()[0].body).toMatch(/Neutral summary\./);
  await act(async () => { fireEvent.press(ui.getByTestId('col-ai-keep')); });
  await act(async () => { fireEvent.press(ui.getByTestId('col-send')); });
  expect(Mail.composeAsync.mock.calls.pop()[0].body).not.toMatch(/Meta AI/);
  const off = await mount(<CollisionScreen navigation={nav()} env={ON} fetchImpl={async () => { throw new Error('offline'); }} />);
  await act(async () => { fireEvent.press(off.getByTestId('col-fault-next')); });
  await act(async () => { fireEvent.press(off.getByTestId('col-ai-ask')); });
  expect(off.getByTestId('col-ai-msg')).toBeTruthy();
  await act(async () => { fireEvent.press(off.getByTestId('col-send')); });
  expect(Mail.composeAsync).toHaveBeenCalled();
});
