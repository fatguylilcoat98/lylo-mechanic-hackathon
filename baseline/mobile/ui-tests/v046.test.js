/* v0.4.6 hackathon: Watch how, Find nearest store, no-sensor note up front, first-run setup. Mocked; no network. */
import React from 'react';
import { render, fireEvent, act } from './testUtils';
import NoAdapterScreen from '../../../hackathon/mobile-bridge/src/NoAdapterScreen';
import SetupScreen from '../../../hackathon/mobile-bridge/src/SetupScreen';
import RepairLinks from '../../../hackathon/mobile-bridge/src/RepairLinks';
import { buildCodeResult } from '../src/engine/diagnose';
import HomeScreen from '../src/screens/HomeScreen';

jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useFocusEffect: () => {} }));
jest.mock('../../../hackathon/mobile-bridge/src/setup', () => ({ ...jest.requireActual('../../../hackathon/mobile-bridge/src/setup'), firstRunOn: () => true }));

const mem = (init) => { const m = { ...(init || {}) }; return { m, getItem: async (k) => m[k] ?? null, setItem: async (k, v) => { m[k] = v; }, removeItem: async (k) => { delete m[k]; } }; };
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const truck = { vin: '', name: '2015 Ford F-150', year: 2015, make: 'Ford', model: 'F-150', recalls: null };

test('no adapter: less-accurate note shows before the first check', async () => {
  const ui = render(<NoAdapterScreen navigation={{ navigate: jest.fn() }} storage={mem()} audio={null} open={() => {}} env={{ EXPO_PUBLIC_LYLO_NO_ADAPTER: '1' }} />);
  await settle();
  expect(ui.getByTestId('no-sensor-note')).toBeTruthy();
  expect(ui.getByText(/less accurate than a scan with an OBD adapter/)).toBeTruthy();
  expect(ui.queryByTestId('na-verdict')).toBeNull();
});

test('code detail links: Watch how uses the remembered vehicle; nearest store opens Maps', async () => {
  const open = jest.fn();
  const ui = render(<RepairLinks result={buildCodeResult('P0335')} storage={mem({ 'lylo.vehicle': JSON.stringify(truck) })} open={open} />);
  await settle();
  expect(ui.getByText(/videos for your 2015 Ford F-150/)).toBeTruthy();
  fireEvent.press(ui.getByTestId('watch-how'));
  expect(open.mock.calls[0][0]).toMatch(/^https:\/\/www\.youtube\.com\/results\?search_query=2015%20Ford%20F-150%20/);
  expect(ui.queryByTestId('nearest-list')).toBeNull();
  fireEvent.press(ui.getByTestId('find-nearest'));
  fireEvent.press(ui.getByTestId('near-autozone'));
  expect(open.mock.calls[1][0]).toBe('https://www.google.com/maps/search/?api=1&query=AutoZone%20near%20me');
  expect(ui.getByTestId('near-oreilly')).toBeTruthy();
  expect(ui.getByTestId('near-napa')).toBeTruthy();
});

test('code detail links without a vehicle still offer Watch how', async () => {
  const ui = render(<RepairLinks result={buildCodeResult('P0171')} storage={mem()} open={() => {}} />);
  await settle();
  expect(ui.getByTestId('watch-how')).toBeTruthy();
  expect(ui.getByText(/Add your VIN/)).toBeTruthy();
});

test('setup: no adapter + mechanic + year/make/model -> saved, goes to No adapter', async () => {
  const s = mem(); const nav = { navigate: jest.fn(), reset: jest.fn() };
  const ui = render(<SetupScreen navigation={nav} storage={s} noAdapterOn={true} fetchImpl={jest.fn()} />);
  fireEvent.press(ui.getByTestId('setup-adapter-no'));
  fireEvent.press(ui.getByTestId('setup-view-mechanic'));
  fireEvent.changeText(ui.getByTestId('setup-year'), '2015');
  fireEvent.changeText(ui.getByTestId('setup-make'), 'ford');
  fireEvent.changeText(ui.getByTestId('setup-model'), 'F-150');
  await act(async () => { fireEvent.press(ui.getByTestId('setup-ymm-go')); });
  expect(s.m['lylo.viewMode']).toBe('mechanic');
  expect(JSON.parse(s.m['lylo.vehicle']).name).toBe('2015 Ford F-150');
  expect(s.m['lylo.setupDone']).toBe('1');
  expect(nav.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'NoAdapter' }] });
});

test('setup: VIN path reuses the VIN lookup; adapter yes -> Home', async () => {
  const s = mem(); const nav = { navigate: jest.fn(), reset: jest.fn() };
  const f = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ vin_status: 'ok', vehicle: { year: 2003, make: 'Honda', model: 'Accord' }, recalls: { status: 'ok', count: 1, components: ['Air Bags'], source: 'NHTSA', check_url: 'https://www.nhtsa.gov/recalls' } }) }));
  const ui = render(<SetupScreen navigation={nav} storage={s} noAdapterOn={true} fetchImpl={f} baseUrl="https://x" appKey="k" />);
  fireEvent.press(ui.getByTestId('setup-adapter-yes'));
  fireEvent.press(ui.getByTestId('setup-skip-q'));
  fireEvent.changeText(ui.getByTestId('setup-vin'), '1HGCM82633A004352');
  await act(async () => { fireEvent.press(ui.getByTestId('setup-vin-go')); });
  expect(f).toHaveBeenCalled();
  const v = JSON.parse(s.m['lylo.vehicle']);
  expect(v.recalls.text).toMatch(/recall for your model \(2003 Honda Accord\)/);
  expect(s.m['lylo.viewMode']).toBeUndefined();
  expect(nav.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Home' }] });
});

test('setup: skip all marks done and goes Home without saving answers', async () => {
  const s = mem(); const nav = { navigate: jest.fn(), reset: jest.fn() };
  const ui = render(<SetupScreen navigation={nav} storage={s} noAdapterOn={true} />);
  await act(async () => { fireEvent.press(ui.getByTestId('setup-skip-all')); });
  expect(s.m).toEqual({ 'lylo.setupDone': '1' });
  expect(nav.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Home' }] });
});

test('Home: first launch opens Setup once; Tools has a Setup button', async () => {
  const nav = { navigate: jest.fn() };
  const ui = render(<HomeScreen navigation={nav} />);
  await settle();
  expect(nav.navigate).toHaveBeenCalledWith('Setup');
  nav.navigate.mockClear();
  fireEvent.press(ui.getByText('Setup: adapter, view, your car'));
  expect(nav.navigate).toHaveBeenCalledWith('Setup');
});
