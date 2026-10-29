/* v0.4.8 hackathon: "Not my engine?" on the Your car screen (hackathon/mobile-bridge). Synthetic data. */
import React from 'react';
import { render, fireEvent, act } from './testUtils';
import VinScreen from '../../../hackathon/mobile-bridge/src/VinScreen';

const VIN = '1HGCM82633A004352'; // NHTSA's published sample VIN (synthetic stand-in)
const mem = (init = {}) => { const m = { ...init }; return { m, getItem: async (k) => m[k] ?? null, setItem: async (k, v) => { m[k] = v; }, removeItem: async (k) => { delete m[k]; } }; };
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const nav = { navigate: jest.fn() };
const car = { vin: VIN, name: '1998 Ford E-450', year: 1998, make: 'Ford', model: 'E-450', engine: '10.3L 6-cyl Diesel', caveat: 'assumes the factory engine (not swapped)', source: 'NHTSA vPIC VIN decoder', recalls: null };
const HINT = 'The government VIN decode lists a diesel for this truck, but it may be wrong for this VIN.';
const decoded = { vin_status: 'ok', vehicle: { ...car }, engine_check_hint: HINT };

test('flag off: no "Not my engine?" and no hint, card as before', async () => {
  const fetchImpl = jest.fn(async () => ({ status: 200, json: async () => decoded }));
  const ui = render(<VinScreen navigation={nav} storage={mem()} picker={null} fetchImpl={fetchImpl} baseUrl="https://x" appKey="k" engineOverrideOn={false} />);
  await settle();
  fireEvent.changeText(await ui.findByPlaceholderText('17 characters'), VIN);
  await act(async () => { fireEvent.press(ui.getByText('Look up my car')); });
  await settle();
  expect(ui.getByText(/10.3L 6-cyl Diesel, assumes the factory engine/)).toBeTruthy();
  expect(ui.queryByText('Not my engine?')).toBeNull();
  expect(ui.queryByText(HINT)).toBeNull();
});

test('flag on: hint shown, owner picks Gas + 6.8L V10 Triton, card says Engine set by you, NHTSA kept small', async () => {
  const st = mem();
  const fetchImpl = jest.fn(async () => ({ status: 200, json: async () => decoded }));
  const ui = render(<VinScreen navigation={nav} storage={st} picker={null} fetchImpl={fetchImpl} baseUrl="https://x" appKey="k" engineOverrideOn />);
  await settle();
  fireEvent.changeText(await ui.findByPlaceholderText('17 characters'), VIN);
  await act(async () => { fireEvent.press(ui.getByText('Look up my car')); });
  await settle();
  expect(ui.getByText(HINT)).toBeTruthy();
  await act(async () => { fireEvent.press(ui.getByText('Not my engine?')); });
  await act(async () => { fireEvent.press(ui.getByText('Gas')); });
  fireEvent.changeText(ui.getByTestId('eo-name'), '6.8L V10 Triton');
  await act(async () => { fireEvent.press(ui.getByText('Save my engine')); });
  await settle();
  expect(ui.getByText('Engine set by you: 6.8L V10 Triton (Gas)')).toBeTruthy();
  expect(ui.getByText(/VIN decoder says \(unverified\): 10.3L 6-cyl Diesel\. Your engine above is used instead/)).toBeTruthy();
  const saved = JSON.parse(st.m['lylo.engineOverride']);
  expect(saved).toMatchObject({ vin: VIN, fuel: 'gas', engine: '6.8L V10 Triton' });
  expect(JSON.parse(st.m['lylo.vehicle']).engine).toBe('10.3L 6-cyl Diesel'); // the decode itself is kept
});

test('flag on: saved override loads on open and can be cleared back to the NHTSA engine', async () => {
  const st = mem({ 'lylo.vehicle': JSON.stringify(car), 'lylo.engineOverride': JSON.stringify({ vin: VIN, fuel: 'gas', engine: '6.8L V10 Triton', setAt: 'x' }) });
  const ui = render(<VinScreen navigation={nav} storage={st} picker={null} fetchImpl={jest.fn()} baseUrl="https://x" appKey="k" engineOverrideOn />);
  await settle();
  expect(ui.getByText('Engine set by you: 6.8L V10 Triton (Gas)')).toBeTruthy();
  await act(async () => { fireEvent.press(ui.getByText('Change my engine')); });
  await act(async () => { fireEvent.press(ui.getByText('Use the NHTSA engine instead')); });
  await settle();
  expect(ui.queryByText(/Engine set by you/)).toBeNull();
  expect(ui.getByText(/10.3L 6-cyl Diesel, assumes the factory engine/)).toBeTruthy();
  expect(st.m['lylo.engineOverride']).toBeUndefined();
});
