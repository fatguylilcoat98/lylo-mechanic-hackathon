/* v0.7.6 hotfix (patch 3130feb7): Mechanic rows wrap long values; clear-not-confirmed says engine OFF, key ON. */
import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import { render, act } from './testUtils';
jest.mock('react-native-ble-plx', () => ({ BleManager: jest.fn().mockImplementation(() => ({ state: jest.fn().mockResolvedValue('PoweredOn'), startDeviceScan: jest.fn(), stopDeviceScan: jest.fn() })) }), { virtual: true });
jest.mock('react-native-bluetooth-classic', () => ({ __esModule: true, default: { getBondedDevices: jest.fn().mockResolvedValue([]) } }), { virtual: true });
import { MechanicDeep } from '../../../hackathon/mobile-bridge/src/ViewModeScreens';
import CodesScreen from '../src/screens/CodesScreen';
import OBDService from '../src/services/OBDService';

const LONG = 'Replace ignition coil and spark plug on cylinder 2, then check the injector connector and the wiring harness for chafing near the valve cover';
const LONG_K = { levelCode: 'DRIVE_SHORT_DISTANCE_ONLY',
  codes: [{ code: 'P0302', title: 'Cylinder 2 misfire detected', system: 'Ignition / fuel', status: 'stored, pending, permanent', repair: LONG, causes: [], tests: [], related: [], parts: '$25-$90 (coil), $8-$20 (plug)', labor: '0.5-1.0 h', shop: '$150-$320' }],
  freezeFrame: null, mil: { on: true, distance: '210 km', time: 'not read' }, sinceClear: { distance: '6400 km', time: '9800 min', warmups: '255' },
  pids: [{ key: 'ltft', label: 'Long-term fuel trim bank 1', value: '+18.0 % (adding fuel to make up for extra air)' }], monitors: [], causes: [], recall: 'Open the recall link yourself.' };

test('Mechanic row: long value wraps (shrinks, right-aligned, label keeps its own space)', () => {
  const ui = render(<MechanicDeep k={LONG_K} />);
  const v = ui.getByText(LONG);
  const vs = StyleSheet.flatten(v.props.style);
  expect({ flexShrink: vs.flexShrink, flex: vs.flex > 0, textAlign: vs.textAlign }).toEqual({ flexShrink: 1, flex: true, textAlign: 'right' });
  expect(v.props.numberOfLines).toBeUndefined(); // never truncated
  const label = ui.getByText('Typical repair');
  expect(StyleSheet.flatten(label.props.style).paddingRight).toBeGreaterThan(0);
});

test('Clear not confirmed by the car: tells you engine OFF, key ON, then rescans', async () => {
  process.env.EXPO_PUBLIC_LYLO_SESSION_V2 = '1'; // read at runtime by sessionV2.on()
  jest.spyOn(OBDService, 'clearCodes').mockResolvedValue(false);
  jest.spyOn(OBDService, 'connected', 'get').mockReturnValue(true);
  const alerts = []; jest.spyOn(Alert, 'alert').mockImplementation((...a) => alerts.push(a));
  const nav = { navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => () => {}) };
  const scan = { stored: ['P0171'], pending: [], permanent: [], monitor: { milOn: true, incomplete: [] }, pids: {} };
  const ui = render(<CodesScreen route={{ params: { scan } }} navigation={nav} />);
  const btn = ui.getAllByText(/^Clear/i).map(ui._pressableFor).find((x) => typeof x.props.onPress === 'function');
  await act(async () => { btn.props.onPress(); });
  // walk the warning dialogs until the destructive confirm runs doClear
  for (let i = 0; i < 4 && !alerts.some((a) => a[0] === 'Car did not confirm'); i++) {
    const last = alerts[alerts.length - 1]; const opt = (last[2] || []).find((o) => o.style === 'destructive') || (last[2] || []).slice(-1)[0];
    await act(async () => { await opt.onPress(); });
  }
  const msg = alerts.find((a) => a[0] === 'Car did not confirm');
  expect(msg[1]).toMatch(/engine OFF and the key ON/);
  expect(msg[1]).toMatch(/dash lights on, engine not started/);
  expect(msg[2][0].text).toBe('Rescan now');
  delete process.env.EXPO_PUBLIC_LYLO_SESSION_V2; jest.restoreAllMocks();
});
