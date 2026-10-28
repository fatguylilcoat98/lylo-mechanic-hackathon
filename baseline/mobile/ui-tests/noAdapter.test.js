/* v0.4.5 hackathon: "No adapter? Start here" (hackathon/mobile-bridge/src/NoAdapterScreen). Fetch mocked. */
import React from 'react';
import { render, fireEvent, act } from './testUtils';
import NoAdapterScreen from '../../../hackathon/mobile-bridge/src/NoAdapterScreen';

const mem = () => { const m = {}; return { getItem: async (k) => m[k] ?? null, setItem: async (k, v) => { m[k] = v; } }; };
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
global.FormData = class { append() {} };
const OFFLINE = { EXPO_PUBLIC_LYLO_NO_ADAPTER: '1' };
const ON = { ...OFFLINE, EXPO_PUBLIC_LYLO_SERVER_URL: 'https://x', EXPO_PUBLIC_LYLO_APP_KEY: 'k' };
const fetchOf = (status, body) => jest.fn(async () => ({ ok: status < 400, status, json: async () => body }));
const mount = async (props) => { const nav = { navigate: jest.fn() }; const ui = render(<NoAdapterScreen navigation={nav} storage={mem()} audio={null} open={() => {}} {...props} />); await settle(); return { ui, nav }; };

test('flag off: renders nothing', async () => {
  const { ui } = await mount({ env: {} });
  expect(ui.queryByText(/No adapter\? Start here/)).toBeNull();
});

test('offline: rules on typed words give do not drive, no network', async () => {
  const f = fetchOf(200, {});
  const { ui } = await mount({ env: OFFLINE, fetchImpl: f });
  fireEvent.changeText(ui.getByTestId('symptom-text'), 'grinding noise when I brake');
  await act(async () => { fireEvent.press(ui.getByText('Check it (offline)')); });
  expect(ui.getByText(/Grinding brakes/)).toBeTruthy();
  expect(ui.getByTestId('na-verdict')).toBeTruthy();
  expect(ui.getAllByText(/Confidence is lower/).length).toBeGreaterThan(0);
  expect(f).not.toHaveBeenCalled();
});

test('typed code: offline meaning + price links + details', async () => {
  const { ui, nav } = await mount({ env: OFFLINE });
  fireEvent.changeText(ui.getByTestId('code-text'), 'p0300');
  await act(async () => { fireEvent.press(ui.getByText('Check it (offline)')); });
  expect(ui.getByTestId('na-code-P0300')).toBeTruthy();
  expect(ui.getAllByText(/Check the price/).length).toBeGreaterThan(0);
  fireEvent.press(ui.getByText('Full details'));
  expect(nav.navigate).toHaveBeenCalledWith('CodeDetail', expect.objectContaining({ code: 'P0300' }));
});

test('server answer cannot lower the phone rule level', async () => {
  const body = { final_safety_level: 'SAFE_TO_DRIVE', answer: { text: 'Probably the pads.', status: 'verified', cites: ['sym:brake_grind'] }, follow_up_checks: [], unverified_claims: [] };
  const { ui } = await mount({ env: ON, fetchImpl: fetchOf(200, body) });
  fireEvent.changeText(ui.getByTestId('symptom-text'), 'brakes are grinding');
  await act(async () => { fireEvent.press(ui.getByText('Check it')); });
  await settle();
  expect(ui.getByText('Probably the pads.')).toBeTruthy();
  expect(ui.queryByText(/Safe to drive/)).toBeNull();
});

test('OBDLink card: three official links, says app works without one, connect goes to Connect', async () => {
  const opened = [];
  const { ui, nav } = await mount({ env: OFFLINE, open: (u) => opened.push(u) });
  expect(ui.getByText(/works without an adapter/)).toBeTruthy();
  fireEvent.press(ui.getByTestId('obdlink-OBDLinkCX'));
  fireEvent.press(ui.getByTestId('obdlink-OBDLinkMX'));
  fireEvent.press(ui.getByTestId('obdlink-OBDLinkEX'));
  expect(opened).toEqual(['https://www.obdlink.com/products/obdlink-cx/', 'https://www.obdlink.com/products/obdlink-mxp/', 'https://www.obdlink.com/products/obdlink-ex/']);
  fireEvent.press(ui.getByTestId('na-connect'));
  expect(nav.navigate).toHaveBeenCalledWith('Connect');
});

test('empty check asks for words or a code', async () => {
  const { ui } = await mount({ env: OFFLINE });
  await act(async () => { fireEvent.press(ui.getByText('Check it (offline)')); });
  expect(ui.getByText(/Tell us what is happening/)).toBeTruthy();
});
