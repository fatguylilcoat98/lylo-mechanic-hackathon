/* UI v2 (flag EXPO_PUBLIC_LYLO_UI_V2=1): home with one primary action, results with evidence badges,
 * safety override banner, prediction banner, replay badge. Synthetic data only. Flag off = old UI. */
import React from 'react';
import { render, fireEvent, act } from './testUtils';
jest.mock('react-native-ble-plx', () => ({ BleManager: jest.fn().mockImplementation(() => ({ state: jest.fn().mockResolvedValue('PoweredOn'), startDeviceScan: jest.fn(), stopDeviceScan: jest.fn() })) }), { virtual: true });
jest.mock('react-native-bluetooth-classic', () => ({ __esModule: true, default: { getBondedDevices: jest.fn().mockResolvedValue([]) } }), { virtual: true });
// Expo inlines EXPO_PUBLIC_* at build time, so stand in for the flag the same way noAdapterHome.test does.
let mockV2 = false;
jest.mock('../../../hackathon/mobile-bridge/src/ui2/theme', () => {
  const real = jest.requireActual('../../../hackathon/mobile-bridge/src/ui2/theme');
  return { ...real, uiV2On: () => mockV2 };
});
import App from '../src/App';
import SimpleResults from '../../../hackathon/mobile-bridge/src/SimpleResults';
import { EvidenceBadge, PredictionBanner, ReplayBadge, SafetyBanner, BigActionButton, CauseCard } from '../../../hackathon/mobile-bridge/src/ui2/components';

const truck = () => JSON.parse(JSON.stringify(require('../../../hackathon/mobile-bridge/test/fixtures/truck.json').scan));
const memStore = () => ({ getItem: async () => null, setItem: async () => {} });
const mount = async (el) => { const ui = render(el); await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); return ui; };
const count = (ui, re) => { try { return ui.getAllByText(re).length; } catch (e) { return 0; } };

afterEach(() => { mockV2 = false; });

test('flag off: old home; flag on: v2 home with one primary action and three choices', async () => {
  let ui = await mount(<App />);
  expect(ui.getByText(/TEST BUILD v0.5.1/)).toBeTruthy();
  expect(ui.queryByTestId('primary-action')).toBeNull();
  mockV2 = true;
  ui = await mount(<App />);
  expect(ui.getByText('The car AI that shows its proof.')).toBeTruthy();
  expect(ui.getAllByText('Scan with adapter').length).toBe(1);
  expect(ui.getByText('No adapter? Start here')).toBeTruthy();
  expect(ui.getByText('Try a demo')).toBeTruthy();
  expect(ui.queryByText('Debug log')).toBeNull();
  await act(async () => { fireEvent.press(ui.getByText(/More tools/)); });
  expect(ui.getByText('Debug log')).toBeTruthy();
});

test('v2 home: Try a demo (demo flag off) opens the bundled check-engine demo', async () => {
  mockV2 = true;
  const ui = await mount(<App />);
  await act(async () => { fireEvent.press(ui.getByText('Try a demo')); });
  expect(await ui.findByText('Check-engine light is ON')).toBeTruthy();
});

test('results v2: one verdict, proof section with typed evidence, mechanic details on demand', async () => {
  const ui = await mount(<SimpleResults uiV2 scan={truck()} screen="codes" storage={memStore()} />);
  expect(count(ui, /Get it checked soon/)).toBe(1);
  expect(ui.queryByText('Simple view')).toBeNull();
  expect(ui.getByText('WHAT TO DO NEXT')).toBeTruthy();
  expect(ui.getByTestId('evidence-summary')).toBeTruthy();
  expect(ui.getAllByText(/FROM YOUR CAR/).length).toBeGreaterThan(0);
  expect(ui.getAllByText(/AI'S GUESS/).length).toBeGreaterThan(0);
  expect(ui.getByText(/Hide proof/)).toBeTruthy(); // first cause open
  expect(ui.queryByText('SHORT_TERM_FUEL_TRIM_B1')).toBeNull();
  await act(async () => { fireEvent.press(ui.getByText(/Mechanic details/)); });
  expect(ui.getByText('SHORT_TERM_FUEL_TRIM_B1')).toBeTruthy();
  expect(ui.getByText('Powered by Meta AI')).toBeTruthy();
});

test('results v2: AI tries to lower a red level, banner says Pull over now and rules overruled the AI', async () => {
  const s = truck(); const r = s.serverDiagnosis.result;
  r.safety.level = 'EMERGENCY_STOP_IMMEDIATELY'; r.safety.triggering_conditions = ['Coolant 260 F (synthetic)'];
  r.detective.safety_action = 'detective_lower_ignored'; r.detective.safety_opinion.level = 'SAFE_TO_DRIVE';
  r.detective.prediction = { text: 'Coolant stays above 240 F at idle', status: 'held', measured: '258 F' };
  s.demoLabel = 'Synthetic overheat';
  const ui = await mount(<SimpleResults uiV2 scan={s} screen="codes" storage={memStore()} />);
  expect(ui.getByText('Pull over now')).toBeTruthy();
  expect(ui.getByText(/OVERRULED THE AI/)).toBeTruthy();
  expect(ui.getByText(/Coolant 260 F/)).toBeTruthy();
  expect(ui.getByTestId('safety-red')).toBeTruthy();
  expect(ui.getByTestId('prediction-held')).toBeTruthy();
  expect(ui.getByTestId('replay-badge')).toBeTruthy();
  expect(count(ui, /REPLAY \u00B7/)).toBe(1); // exactly one badge
  expect(ui.getByTestId('replay-pin')).toBeTruthy(); // pinned as a sticky header
  expect(ui.queryByText(/REPLAY \u00B7 REPLAY/)).toBeNull();
});

test('components render with synthetic data', async () => {
  const press = jest.fn();
  const ui = await mount(<>
    <EvidenceBadge kind="car" /><EvidenceBadge kind="guess" /><EvidenceBadge kind="bogus" />
    <ReplayBadge label="Recorded drive" /><ReplayBadge label={null} />
    <SafetyBanner tone="green" title="Good to drive" why="Nothing found." />
    <PredictionBanner prediction={{ text: 'Trim drops below 10%', status: 'failed' }} /><PredictionBanner prediction={null} />
    <BigActionButton title="Go" subtitle="now" onPress={press} />
    <CauseCard open cause={{ key: 'a', rank: 1, title: 'Vacuum leak', likely: 'Possible', nextCheck: 'Spray test', evidence: [{ id: 'x', kind: 'unknown', label: 'Not in this scan' }] }} onToggle={() => {}} />
  </>);
  expect(ui.getByTestId('evidence-car')).toBeTruthy();
  expect(ui.getAllByText(/UNKNOWN/).length).toBeGreaterThan(0);
  expect(ui.getByText(/REPLAY · Recorded drive/)).toBeTruthy();
  expect(count(ui, /REPLAY/)).toBe(1);
  expect(ui.getByText('PREDICTION FAILED')).toBeTruthy();
  expect(ui.getByText('Next check: Spray test')).toBeTruthy();
  await act(async () => { fireEvent.press(ui.getByText('Go')); });
  expect(press).toHaveBeenCalled();
});

test('v0.5.0 wiring: a prove replay goes prove.asScan -> ReplayBadge label, and the PredictionBanner shows the server detective.prediction', async () => {
  const P = require('../../../hackathon/mobile-bridge/src/prove');
  const r = truck().serverDiagnosis.result;
  r.detective.prediction = { text: 'Cylinder 3 misfire count goes above 10 within 60 s', status: 'HELD', measured: 'MISFIRE_COUNT_CYL3 = 22 at +12 s' };
  r.detective.prediction_replay = true;
  r.replay = { badge: 'REPLAY', label: 'SYNTHETIC misfire session (made-up data)' };
  const s = P.asScan(r);
  expect(s.demoLabel).toBe('SYNTHETIC misfire session (made-up data)');
  expect(s.serverDiagnosis.source).toBe('server'); // resultsView.serverResult needs it, or the screen is blank
  const ui = await mount(<SimpleResults uiV2 scan={s} screen="codes" storage={memStore()} />);
  expect(ui.getByTestId('replay-pin')).toBeTruthy();
  expect(ui.getByText(/REPLAY \u00B7 SYNTHETIC misfire session/)).toBeTruthy();
  expect(count(ui, /REPLAY \u00B7/)).toBe(1);
  expect(ui.queryByText(/REPLAY \u00B7 REPLAY/)).toBeNull();
  expect(ui.getByTestId('prediction-held')).toBeTruthy();
  expect(ui.getByText(/Cylinder 3 misfire count goes above 10 within 60 s/)).toBeTruthy();
  expect(ui.getByText(/MISFIRE_COUNT_CYL3 = 22 at \+12 s/)).toBeTruthy();
  r.detective.prediction.status = 'LOCKED'; r.detective.prediction.measured = null;
  const ui2 = await mount(<SimpleResults uiV2 scan={P.asScan(r)} screen="codes" storage={memStore()} />);
  expect(ui2.getByTestId('prediction-pending')).toBeTruthy();
});
