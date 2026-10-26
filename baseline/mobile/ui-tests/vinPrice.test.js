/* v0.4.3 hackathon: VIN screen + "Check the price" buttons (hackathon/mobile-bridge). */
import React from 'react';
import { Linking } from 'react-native';
import { render, fireEvent, act } from './testUtils';
import VinScreen from '../../../hackathon/mobile-bridge/src/VinScreen';
import PhotoHelperScreen from '../../../hackathon/mobile-bridge/src/PhotoHelperScreen';

const SAMPLE_VIN = '1HGCM82633A004352';
const mem = (init = {}) => { const m = { ...init }; return { m, getItem: async (k) => m[k] ?? null, setItem: async (k, v) => { m[k] = v; }, removeItem: async (k) => { delete m[k]; } }; };
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const nav = { navigate: jest.fn() };
const decoded = { vin_status: 'ok', vehicle: { year: 2003, make: 'Honda', model: 'Accord', engine: '3.0L 6-cyl Gasoline', source: 'NHTSA vPIC VIN decoder' },
  recalls: { status: 'ok', count: 1, components: ['Air Bags'], source: 'NHTSA recalls by year/make/model (not checked against this exact VIN)', check_url: 'https://www.nhtsa.gov/recalls' } };
global.FormData = class { constructor() { this.f = {}; } append(k, v) { this.f[k] = v; } };

test('Type VIN: bad check digit is rejected without a network call', async () => {
  const fetchImpl = jest.fn();
  const ui = render(<VinScreen navigation={nav} storage={mem()} picker={null} fetchImpl={fetchImpl} baseUrl="https://x" appKey="k" />);
  await settle();
  fireEvent.changeText((await ui.findByPlaceholderText('17 characters')), '1HGCM82633A004353');
  await act(async () => { fireEvent.press(ui.getByText('Look up my car')); });
  expect(ui.getByText(/check digit/)).toBeTruthy();
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('Type VIN: decoded car shown with factory-engine caveat and labeled recalls, saved', async () => {
  const st = mem();
  const fetchImpl = jest.fn(async () => ({ status: 200, json: async () => decoded }));
  const ui = render(<VinScreen navigation={nav} storage={st} picker={null} fetchImpl={fetchImpl} baseUrl="https://x" appKey="k" />);
  await settle();
  fireEvent.changeText((await ui.findByPlaceholderText('17 characters')), SAMPLE_VIN.toLowerCase());
  await act(async () => { fireEvent.press(ui.getByText('Look up my car')); });
  await settle();
  expect(ui.getByText(/2003 Honda Accord/)).toBeTruthy();
  expect(ui.getByText(/assumes the factory engine \(not swapped\)/)).toBeTruthy();
  expect(ui.getByText(/1 recall on record/)).toBeTruthy();
  expect(ui.getByText(/Source: NHTSA recalls by year\/make\/model/)).toBeTruthy();
  expect(JSON.parse(st.m['lylo.vehicle']).name).toBe('2003 Honda Accord');
});

test('Photo of VIN: unreadable photo -> type it instead, never a guess', async () => {
  const picker = { requestCameraPermissionsAsync: async () => ({ granted: true }),
    launchCameraAsync: async () => ({ canceled: false, assets: [{ uri: 'file:///v.jpg' }] }) };
  const fetchImpl = async () => ({ status: 200, json: async () => ({ vin_status: 'read', vin: '1HGCM82633A004353' }) });
  const ui = render(<VinScreen navigation={nav} storage={mem()} picker={picker} fetchImpl={fetchImpl} baseUrl="https://x" appKey="k" />);
  await settle();
  await act(async () => { fireEvent.press(ui.getByText('Photo of VIN')); });
  await settle();
  expect(ui.getByText(/Type it in instead/)).toBeTruthy();
  expect((await ui.findByPlaceholderText('17 characters')).props.value).toBe('');
});

test('Photo Helper with a saved car: sends VIN to LYLO server, shows the car and price buttons', async () => {
  const st = mem({ 'lylo.vehicle': JSON.stringify({ vin: SAMPLE_VIN, name: '2003 Honda Accord', year: 2003, make: 'Honda', model: 'Accord', caveat: 'assumes the factory engine (not swapped)' }) });
  const picker = { requestCameraPermissionsAsync: async () => ({ granted: true }), MediaTypeOptions: { Images: 'Images' },
    launchCameraAsync: async () => ({ canceled: false, assets: [{ uri: 'file:///p.jpg', width: 1024, height: 768 }] }) };
  let sent = null;
  const fetchImpl = async (url, init) => { sent = init.body.f; return { status: 200, json: async () => require('../../../hackathon/server/evidence/photo_helper/live_battery.json') }; };
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  const ui = render(<PhotoHelperScreen navigation={nav} storage={st} picker={picker} fetchImpl={fetchImpl} baseUrl="https://x" appKey="k" />);
  await settle();
  expect(ui.getByText(/2003 Honda Accord/)).toBeTruthy();
  await act(async () => { fireEvent.press(ui.getByText(/Battery check/)); });
  await act(async () => { fireEvent.press(ui.getByText('Take a picture')); });
  await settle();
  expect(sent.vin).toBe(SAMPLE_VIN);
  expect(ui.getByText('Check the price: car battery')).toBeTruthy();
  expect(ui.getByText(/^Estimate: \$80/)).toBeTruthy();
  await act(async () => { fireEvent.press(ui.getByText('NAPA')); });
  expect(open).toHaveBeenCalledWith('https://www.napaonline.com/en/search?text=2003%20Honda%20Accord%20car%20battery');
  expect(ui.getByText('RockAuto (online)')).toBeTruthy();
});
