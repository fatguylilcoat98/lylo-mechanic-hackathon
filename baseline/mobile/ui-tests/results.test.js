/*
 * v0.4.1 results screen (hackathon/mobile-bridge/src/SimpleResults): one verdict,
 * each traffic-light color, Simple view | Mechanic view toggle persisted under lylo.viewMode.
 */
import React from 'react';
import { render, fireEvent, act } from './testUtils';
import SimpleResults from '../../../hackathon/mobile-bridge/src/SimpleResults';

const truck = () => JSON.parse(JSON.stringify(require('../../../hackathon/mobile-bridge/test/fixtures/truck.json').scan));
const used = () => JSON.parse(JSON.stringify(require('../../../hackathon/mobile-bridge/test/fixtures/usedcar_cleared.json').scan));
const at = (lv) => { const s = truck(); s.serverDiagnosis.result.safety.level = lv; return s; };
const memStore = (init = {}) => {
  const mem = { ...init }; const writes = [];
  return { mem, writes, getItem: async (k) => (k in mem ? mem[k] : null), setItem: async (k, v) => { writes.push([k, v]); mem[k] = v; } };
};
const VERDICTS = [/Good to drive/, /Get it checked soon/, /Drive only short trips/, /Don't drive it/];
const countVerdicts = (ui) => VERDICTS.reduce((n, re) => n + ui.queryAllCount(re), 0);
const mount = async (el) => { const ui = render(el); await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); ui.queryAllCount = (re) => { try { return ui.getAllByText(re).length; } catch (e) { return 0; } }; return ui; };

test.each([
  ['SAFE_TO_DRIVE', /Good to drive/], ['INSPECT_SOON', /Get it checked soon/],
  ['DRIVE_SHORT_DISTANCE_ONLY', /Drive only short trips/], ['DO_NOT_DRIVE', /Don't drive it/],
])('%s renders exactly one verdict', async (lv, re) => {
  const ui = await mount(<SimpleResults scan={at(lv)} screen="codes" storage={memStore()} />);
  expect(ui.getAllByText(re).length).toBe(1);
  expect(countVerdicts(ui)).toBe(1);
});

test('simple view (default): plain words, cold recheck, See why expands, Powered by Meta AI', async () => {
  const ui = await mount(<SimpleResults scan={truck()} screen="usedcar" storage={memStore()} />);
  expect(ui.getByText('Simple view')).toBeTruthy();
  expect(ui.getByText('Mechanic view')).toBeTruthy();
  expect(ui.getByText('What to do next')).toBeTruthy();
  expect(ui.getByText(/Scan again after a 15-minute drive/)).toBeTruthy();
  expect(ui.queryByText(/Detective|pipeline|ledger|ypothes|SHORT_TERM_FUEL_TRIM/)).toBeNull();
  expect(ui.queryByText(/Fuel adjustment: \+27%/)).toBeNull();
  await act(async () => { fireEvent.press(ui.getByText(/See why/)); });
  expect(ui.getAllByText(/Fuel adjustment: \+27%/).length).toBeGreaterThan(0);
  expect(ui.queryByText(/SHORT_TERM_FUEL_TRIM/)).toBeNull();
  expect(ui.getByText('Powered by Meta AI')).toBeTruthy();
  expect(ui.getByText(/muse-spark-1.3/)).toBeTruthy();
});

test('used car with erased codes shows the big warning', async () => {
  const ui = await mount(<SimpleResults scan={used()} screen="usedcar" storage={memStore()} />);
  expect(ui.getByText(/Someone recently erased this car's warning codes. Be careful buying it./)).toBeTruthy();
  expect(countVerdicts(ui)).toBe(1);
});

test('Mechanic view: raw PID names, confidence, monitors; still one verdict; choice saved', async () => {
  const store = memStore();
  const ui = await mount(<SimpleResults scan={truck()} screen="codes" storage={store} />);
  await act(async () => { fireEvent.press(ui.getByText('Mechanic view')); });
  expect(ui.getByText('SHORT_TERM_FUEL_TRIM_B1')).toBeTruthy();
  expect(ui.getAllByText(/confidence/i).length).toBeGreaterThan(0);
  expect(ui.getByText('Readiness monitors')).toBeTruthy();
  expect(ui.getByText(/Not read by this app version/)).toBeTruthy();
  expect(countVerdicts(ui)).toBe(1);
  expect(store.writes).toEqual([['lylo.viewMode', 'mechanic']]);
});

test('saved Mechanic choice is restored on next open', async () => {
  const ui = await mount(<SimpleResults scan={truck()} screen="codes" storage={memStore({ 'lylo.viewMode': 'mechanic' })} />);
  expect(ui.getByText('SHORT_TERM_FUEL_TRIM_B1')).toBeTruthy();
});

test('no server result renders nothing (baseline screen is the fallback)', async () => {
  const ui = await mount(<SimpleResults scan={{ serverDiagnosis: { source: 'offline' } }} screen="codes" storage={memStore()} />);
  expect(ui.queryByText('Simple view')).toBeNull();
});
