/* v0.7.3 session isolation on the real results screen. Synthetic scans, in-memory storage. */
import React from 'react';
import { render, act, fireEvent } from './testUtils';
import ResultsV2 from '../../../hackathon/mobile-bridge/src/ui2/ResultsV2';
const SV = require('../../../hackathon/mobile-bridge/src/sessionV2');

const truck = () => JSON.parse(JSON.stringify(require('../../../hackathon/mobile-bridge/test/fixtures/truck.json').scan));
const memStore = (init = {}) => { const m = { ...init }; return { m, getItem: async (k) => m[k] ?? null, setItem: async (k, v) => { m[k] = v; } }; };
const nav = () => ({ navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => () => {}) });
const mount = async (el) => { const ui = render(el); await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); return ui; };
const ON = { EXPO_PUBLIC_LYLO_SESSION_V2: '1' };
const FORD = { vin: '1FDXE45F0WHA00001', name: '1998 Ford E-450', engine: '7.3L', caveat: 'c', source: 'NHTSA vPIC' };
const saved = () => memStore({ 'lylo.vehicle': JSON.stringify(FORD) });

test('flag off: old screen, no session card', async () => {
  const ui = await mount(<ResultsV2 scan={truck()} screen="codes" storage={saved()} />);
  expect(ui.queryByTestId('session-card')).toBeNull();
});

test('fresh launch, VIN not read: Vehicle not identified, the saved Ford is never shown', async () => {
  const sc = SV.stamp({ ...truck(), vin: null, monitor: { milOn: true }, stored: ['P04E0'], pending: ['P04E0'], permanent: [], permanentSupported: true }, SV.newSession('MX'));
  const n = nav(); const onScanAnother = jest.fn();
  const ui = await mount(<ResultsV2 scan={sc} screen="codes" storage={saved()} sessionEnv={ON} navigation={n} onScanAnother={onScanAnother} />);
  expect(ui.getByTestId('vehicle-status').props.children).toBe('Vehicle not identified');
  expect(ui.queryByText(/^1998 Ford E-450/)).toBeNull();
  expect(ui.getByText('This is my 1998 Ford E-450')).toBeTruthy();
  expect(ui.getByTestId('mil-status').props.children).toMatch(/ON/);
  fireEvent.press(ui.getByTestId('enter-vin')); expect(n.navigate).toHaveBeenCalledWith('Vin');
  fireEvent.press(ui.getByTestId('scan-another')); expect(onScanAnother).toHaveBeenCalled();
});

test('stale result from an older session is hidden', async () => {
  const old = SV.stamp({ ...truck(), vin: null }, SV.newSession('MX'));
  SV.newSession('MX');
  const ui = await mount(<ResultsV2 scan={old} screen="codes" storage={saved()} sessionEnv={ON} navigation={nav()} />);
  expect(ui.getByTestId('session-stale')).toBeTruthy();
});
