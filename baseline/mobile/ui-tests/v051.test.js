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
  const f = reply({ prediction: { text: 'Cylinder 3 is misfiring', status: 'FAILED', measured: 'not proven yet' }, prove: { chain_ok: true, head_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } });
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

describe('prove record integrity (chain_ok / head_sha256)', () => {
  const tamper = (patch) => { const j = JSON.parse(JSON.stringify(rec)); Object.assign(j.detective.prove, patch); if (patch.head_sha256 === undefined && 'head_sha256' in patch) delete j.detective.prove.head_sha256; return j; };
  const runDemo = async (body) => {
    const ui = render(<DemoScreen navigation={{ navigate: jest.fn() }} fetchImpl={reply(body)} baseUrl="https://x" appKey="k" />);
    await act(async () => { fireEvent.press(ui.getByTestId('prove-prove_misfire_synthetic')); });
    return ui;
  };
  test('verified record still shows HELD', async () => {
    const ui = await runDemo(rec);
    expect(ui.getByText('The car proved it right')).toBeTruthy();
    expect(ui.queryByText(/integrity check failed/i)).toBeNull();
  });
  test.each([[{ chain_ok: false }], [{ head_sha256: undefined }], [{ head_sha256: '' }]])('replay %j: integrity failed, never "proved it right"', async (patch) => {
    const ui = await runDemo(tamper(patch));
    expect(ui.queryByText('The car proved it right')).toBeNull();
    expect(ui.getAllByText(/RECORD INTEGRITY CHECK FAILED/).length).toBe(1);
    expect(ui.getByTestId('prediction-integrity')).toBeTruthy();
  });
  test('results ProveCheck: chain_ok false -> integrity failed', async () => {
    const f = reply({ prediction: { text: 'Cylinder 3 is misfiring', status: 'HELD', measured: 'x' }, prove: { chain_ok: false, head_sha256: 'abc' } });
    const on = render(<ProveCheck scan={asScan(rec)} env={{ EXPO_PUBLIC_LYLO_PROVE: '1' }} opts={{ baseUrl: 'https://x', fetchImpl: f }} />);
    await act(async () => { fireEvent.press(on.getByTestId('prove-check-btn')); });
    expect(on.queryByText('The car proved it right')).toBeNull();
    expect(on.getByTestId('prediction-integrity')).toBeTruthy();
  });
  test('replay {"chain_ok":"true"} (not boolean true): unverified, never "proved it right"', async () => {
    const ui = await runDemo(tamper({ chain_ok: 'true' }));
    expect(ui.queryByText('The car proved it right')).toBeNull();
    expect(ui.getByTestId('prediction-unverified')).toBeTruthy();
  });
  test('results ProveCheck: verified reply shows HELD', async () => {
    const f = reply({ prediction: { text: 'Cylinder 3 is misfiring', status: 'HELD', measured: 'x' }, prove: { chain_ok: true, head_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } });
    const on = render(<ProveCheck scan={asScan(rec)} env={{ EXPO_PUBLIC_LYLO_PROVE: '1' }} opts={{ baseUrl: 'https://x', fetchImpl: f }} />);
    await act(async () => { fireEvent.press(on.getByTestId('prove-check-btn')); });
    expect(on.getByText('The car proved it right')).toBeTruthy();
  });
});

describe('v0.5.1 Vera r2: just-locked prediction is pending, one shared banner rule', () => {
  const lockShape = require('../../../hackathon/server/evidence/prove/lock_shape_synthetic.json').detective;
  const { bannerStatus } = require('../../../hackathon/mobile-bridge/src/prove');
  const { buildV2 } = require('../../../hackathon/mobile-bridge/src/ui2/model');
  const scanOf = (det) => { const r = JSON.parse(JSON.stringify(truck)); r.detective = { ...r.detective, ...det }; return { serverDiagnosis: { source: 'server', result: r } }; };
  const status = (det) => buildV2(scanOf(det), { screen: 'codes' }).prediction.status;

  test('exact lock() shape -> pending (LOCKED), never integrity failure', async () => {
    expect(lockShape.prediction.status).toBe('LOCKED');
    expect(lockShape.prove.chain_ok).toBe(true);
    expect(status(lockShape)).toBe('pending');
    const ui = render(<SimpleResults uiV2 scan={scanOf(lockShape)} screen="codes" storage={memStore()} />);
    await act(async () => {});
    expect(ui.getByTestId('prediction-pending')).toBeTruthy();
    expect(ui.queryByText(/INTEGRITY CHECK FAILED/)).toBeNull();
  });
  test('lock() shape from an older server (no chain fields) -> still pending', () => {
    const p = { ...lockShape.prove }; delete p.chain_ok; delete p.head_sha256;
    expect(status({ prediction: lockShape.prediction, prove: p })).toBe('pending');
  });
  test('chain_ok === false -> integrity, even while LOCKED', () => {
    expect(status({ prediction: lockShape.prediction, prove: { ...lockShape.prove, chain_ok: false } })).toBe('integrity');
  });
  test('HELD without det.prove (missing or null) -> unverified, never "proved"', () => {
    const held = { ...lockShape.prediction, status: 'HELD', measured: 'P0310 at +3 s' };
    expect(status({ prediction: held, prove: undefined })).toBe('unverified');
    expect(status({ prediction: held, prove: null })).toBe('unverified');
    expect(status({ prediction: held, prove: { ...lockShape.prove } })).toBe('held');
  });
  test('HELD/FAILED with an invalid head -> integrity', () => {
    ['HELD', 'FAILED'].forEach((st) => {
      const p = { ...lockShape.prediction, status: st };
      expect(status({ prediction: p, prove: { ...lockShape.prove, head_sha256: undefined } })).toBe('integrity');
      expect(status({ prediction: p, prove: { ...lockShape.prove, head_sha256: 'zz' } })).toBe('integrity');
    });
  });
  test('model.js and ProvePanel agree: same helper, same answer on every case', () => {
    const preds = ['LOCKED', 'HELD', 'FAILED', 'weird', undefined].map((s) => ({ text: 't', status: s }));
    const proves = [undefined, null, {}, lockShape.prove, { ...lockShape.prove, chain_ok: false }, { ...lockShape.prove, chain_ok: undefined }, { chain_ok: true }];
    preds.forEach((p) => proves.forEach((pr) => expect(status({ prediction: p, prove: pr })).toBe(bannerStatus(p, pr))));
  });
  test('results ProveCheck: HELD reply without prove -> unverified banner, no "proved it right"', async () => {
    const f = reply({ prediction: { text: 'x', status: 'HELD', measured: 'm' } });
    const on = render(<ProveCheck scan={asScan(rec)} env={{ EXPO_PUBLIC_LYLO_PROVE: '1' }} opts={{ baseUrl: 'https://x', fetchImpl: f }} />);
    await act(async () => { fireEvent.press(on.getByTestId('prove-check-btn')); });
    expect(on.getByTestId('prediction-unverified')).toBeTruthy();
    expect(on.queryByText('The car proved it right')).toBeNull();
  });
});
