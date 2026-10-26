/* v0.4.2 hackathon Photo Helper screen (hackathon/mobile-bridge/src/PhotoHelperScreen). */
import React from 'react';
import { render, fireEvent, act } from './testUtils';
import PhotoHelperScreen from '../../../hackathon/mobile-bridge/src/PhotoHelperScreen';

const live = (j) => require(`../../../hackathon/server/evidence/photo_helper/live_${j}.json`);
const mem = () => { const m = {}; return { getItem: async (k) => m[k] ?? null, setItem: async (k, v) => { m[k] = v; } }; };
const picker = { requestCameraPermissionsAsync: async () => ({ granted: true }), MediaTypeOptions: { Images: 'Images' },
  launchCameraAsync: async () => ({ canceled: false, assets: [{ uri: 'file:///p.jpg', width: 1024, height: 768 }] }),
  launchImageLibraryAsync: async () => ({ canceled: true }) };
const fetchOf = (body) => async () => ({ status: 200, json: async () => body });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const nav = { navigate: jest.fn() };
global.FormData = class { append() {} };

async function run(job, body) {
  const ui = render(<PhotoHelperScreen navigation={nav} storage={mem()} picker={picker} fetchImpl={fetchOf(body)} baseUrl="https://x" appKey="k" />);
  await settle();
  await act(async () => { fireEvent.press(ui.getByText(new RegExp(job))); });
  await act(async () => { fireEvent.press(ui.getByText('Take a picture')); });
  await settle();
  return ui;
}

test('job list, photo instruction, battery warning', async () => {
  const ui = render(<PhotoHelperScreen navigation={nav} storage={mem()} picker={picker} />);
  for (const t of ['Engine air filter', 'Cabin air filter', 'Battery check or replacement', 'Wiper blades', 'Headlight or taillight bulb', 'Tire tread and sidewall check']) expect(ui.getByText(new RegExp(t))).toBeTruthy();
  await act(async () => { fireEvent.press(ui.getByText(/Battery check/)); });
  expect(ui.getByText('Open the hood and take a picture of the battery from above.')).toBeTruthy();
  expect(ui.getByText(/negative/)).toBeTruthy();
  expect(ui.getByText(/This is not a guarantee/)).toBeTruthy();
});

test('risky jobs: Get a pro for this one.', async () => {
  const ui = render(<PhotoHelperScreen navigation={nav} storage={mem()} picker={picker} />);
  await act(async () => { fireEvent.press(ui.getByText(/Brakes, fuel, airbags/)); });
  expect(ui.getByText(/Get a pro for this one\./)).toBeTruthy();
});

test('found: numbered marks, steps, disclaimer; Mechanic view shows confidence', async () => {
  const ui = await run('Engine air filter', live('engine_air_filter'));
  expect(ui.getAllByText('1. Air filter box').length).toBe(1);
  expect(ui.getByText('Steps')).toBeTruthy();
  expect(ui.getByText(/This is not a guarantee. It gives you an idea of where to look./)).toBeTruthy();
  expect(ui.getByText('Powered by Meta AI')).toBeTruthy();
  await act(async () => { fireEvent.press(ui.getByText('Mechanic view')); });
  expect(ui.getByText(/Air filter box — 92%/)).toBeTruthy();
});

test('not found: says so, no marks or steps', async () => {
  const ui = await run('Cabin air filter', live('cabin_air_filter'));
  expect(ui.getByText(/I can't see it in this photo. Try a closer picture or check your owner's manual./)).toBeTruthy();
  expect(ui.queryByText('Steps')).toBeNull();
});

test('engine cover message', async () => {
  const ui = await run('Engine air filter', { helper_status: 'engine_cover', found: false, engine_cover: true,
    message: "There's a plastic cover over the engine. It usually pops off by pulling up, or has a few clips/bolts.",
    marks: [{ n: 1, text: '1. Pull up here', label: 'Pull up here', x: 0.4, y: 0.3, radius: 0.05, confidence: 0.8 }], steps: [] });
  expect(ui.getByText(/plastic cover over the engine/)).toBeTruthy();
  expect(ui.getByText('1. Pull up here')).toBeTruthy();
});
