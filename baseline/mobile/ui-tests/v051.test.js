/* v0.5.1: "Run the proof" (Demo + results under EXPO_PUBLIC_LYLO_PROVE=1) and results-screen fixes. Synthetic data. */
import React from 'react';
import { render, fireEvent, act } from './testUtils';
import DemoScreen from '../../../hackathon/mobile-bridge/src/DemoScreen';
import SimpleResults, { pidText } from '../../../hackathon/mobile-bridge/src/SimpleResults';
import { ProveCheck } from '../../../hackathon/mobile-bridge/src/ProvePanel';
import { asScan } from '../../../hackathon/mobile-bridge/src/prove';

jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useFocusEffect: () => {} }));

const rec = require('../../../hackathon/server/evidence/prove/replay_misfire_synthetic.json').response;
const truck = require('../../../hackathon/server/evidence/detective_cold_engine_truck_like.json').response;
const reply = (body, status = 200) => jest.fn(async () => ({ ok: status < 400, status, json: async () => body }));
const memStore = () => ({ getItem: async () => null, setItem: async () => {} });

test('Demo: Run the proof replays via /api/v1/prove/replay with REPLAY badge and HELD banner', async () => {
  const f = reply(rec);
  const ui = render(<DemoScreen navigation={{ navigate: jest.fn() }} fetchImpl={f} baseUrl="https://x" appKey="k" />);
  expect(ui.getByText('Run the proof')).toBeTruthy();
  await act(async () => { fireEvent.press(ui.getByTestId('prove-prove_misfire_synthetic')); });
  expect(f.mock.calls[0][0]).toBe('https://x/api/v1/prove/replay');
  expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ case: 'prove_misfire_synthetic' });
  expect(ui.getByTestId('prove-result')).toBeTruthy();
  expect(ui.getAllByText(/REPLAY/).length).toBeGreaterThan(0);
  expect(ui.getAllByText(/SYNTHETIC misfire replay/).length).toBeGreaterThan(0);
  expect(ui.getAllByText(/HELD/i).length).toBeGreaterThan(0);
});

test('Demo: server error is shown, nothing invented', async () => {
  const ui = render(<DemoScreen navigation={{ navigate: jest.fn() }} fetchImpl={reply({ error: 'x' }, 503)} baseUrl="https://x" appKey="k" />);
  await act(async () => { fireEvent.press(ui.getByTestId('prove-prove_misfire_synthetic')); });
  expect(ui.getByTestId('prove-msg')).toBeTruthy();
  expect(ui.queryByTestId('prove-result')).toBeNull();
});

test('results: ProveCheck hidden with flag off, posts /api/v1/prove/check with flag on', async () => {
  const scan = asScan(rec);
  const off = render(<ProveCheck scan={scan} env={{}} opts={{ baseUrl: 'https://x', fetchImpl: reply({}) }} />);
  expect(off.queryByTestId('prove-check')).toBeNull();
  const f = reply({ prediction: { text: 'Cylinder 3 is misfiring', status: 'FAILED', measured: 'not proven yet' } });
  const on = render(<ProveCheck scan={scan} env={{ EXPO_PUBLIC_LYLO_PROVE: '1' }} opts={{ baseUrl: 'https://x', fetchImpl: f }} />);
  await act(async () => { fireEvent.press(on.getByTestId('prove-check-btn')); });
  expect(f.mock.calls[0][0]).toBe('https://x/api/v1/prove/check');
  expect(JSON.parse(f.mock.calls[0][1].body).session_id).toBe(rec.detective.prove.session_id);
  expect(on.getAllByText(/FAILED|did not hold|failed/i).length).toBeGreaterThan(0);
});

test('results v2: no literal \\u00B7, no duplicate causes under Mechanic details', async () => {
  const ui = render(<SimpleResults uiV2 scan={{ serverDiagnosis: { source: 'server', result: truck } }} screen="codes" storage={memStore()} />);
  await act(async () => {});
  expect(ui.queryByText(/\\u00B7/)).toBeNull();
  expect(ui.getByText('THE PROOF \u00B7 MUSE DETECTIVE')).toBeTruthy();
  await act(async () => { fireEvent.press(ui.getByText(/Mechanic details/)); });
  expect(ui.queryByText(/Hypotheses \(Meta AI/)).toBeNull();
  expect(ui.queryByText(/^Possible causes \(Meta AI/)).toBeNull();
  expect(ui.queryByText(/ENGINE_COOLANT_TEMP = /)).toBeNull(); // proof list uses plain labels
});

test('mechanic view: human causes heading, plain monitor names, value shown once', async () => {
  const store = { getItem: async (k) => (k === 'lylo.viewMode' ? 'mechanic' : null), setItem: async () => {} };
  const ui = render(<SimpleResults uiV2={false} scan={{ serverDiagnosis: { source: 'server', result: truck } }} screen="codes" storage={store} />);
  await act(async () => {});
  expect(ui.queryByText(/Hypotheses/)).toBeNull();
  expect(ui.getAllByText(/^Possible causes \(Meta AI/).length).toBe(1);
  expect(ui.queryByText(/^catalyst: /)).toBeNull();
  expect(pidText({ name: 'X', value: 190, unit: '°F' })).toBe('190 °F');
  expect(pidText({ name: 'ENGINE_COOLANT_TEMP', value: 88, unit: '°C' })).toMatch(/°F \(88 °C\)$/);
});
