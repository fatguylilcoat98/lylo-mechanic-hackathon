/* v0.4.7 hackathon: "Try a demo scan" + AI vs rules proof. Server mocked with recorded/real-shaped replies. */
import React from 'react';
import { render, fireEvent, act } from './testUtils';
import DemoScreen from '../../../hackathon/mobile-bridge/src/DemoScreen';
import HomeScreen from '../src/screens/HomeScreen';

jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useFocusEffect: () => {} }));
// Same as a build with EXPO_PUBLIC_LYLO_DEMO=1 (Expo inlines env at build time).
jest.mock('../../../hackathon/mobile-bridge/src/demo', () => ({ ...jest.requireActual('../../../hackathon/mobile-bridge/src/demo'), features: () => ({ on: true }) }));

const truck = require('../../../hackathon/server/evidence/detective_cold_engine_truck_like.json').response;
const reply = (body, status = 200) => jest.fn(async () => ({ ok: status < 400, status, json: async () => body }));
const mount = (f, url = 'https://x') => render(<DemoScreen navigation={{ navigate: jest.fn() }} fetchImpl={f} baseUrl={url} appKey="k" />);

test('lists the three demo scans', () => {
  const ui = mount(reply({}));
  ['demo-truck', 'demo-usedcar', 'demo-overheat', 'demo-proof'].forEach((id) => expect(ui.getByTestId(id)).toBeTruthy());
});

test('truck replay shows the server verdict, causes and receipt', async () => {
  const f = reply({ ...truck, demo: { title: "Chris's truck", source: 'Readings from Chris\'s own truck scan', replay: true } });
  const ui = mount(f);
  await act(async () => { fireEvent.press(ui.getByTestId('demo-truck')); });
  expect(f.mock.calls[0][0]).toBe('https://x/api/v1/demo/replay');
  expect(ui.getByTestId('demo-result')).toBeTruthy();
  expect(ui.getByText(/Receipt: muse-spark-1.3, 7.4 s, 15 of 19 evidence items cited/)).toBeTruthy();
  expect(ui.getByText(/Engine was still cold/)).toBeTruthy();
});

test('AI vs rules: simulated label, both verdicts, rules won', async () => {
  const f = reply({ proof: { label: 'Simulated AI answer for this test (no AI model was called)', simulated: true, ai_verdict: 'SAFE_TO_DRIVE',
    rules_verdict: 'EMERGENCY_STOP_IMMEDIATELY', final_verdict: 'EMERGENCY_STOP_IMMEDIATELY', winner: 'rules', safety_action: 'detective_lower_ignored',
    explain: 'The AI proposed a lower level. LYLO never lowers the rule level, so the rules won.' } });
  const ui = mount(f);
  await act(async () => { fireEvent.press(ui.getByTestId('demo-proof')); });
  expect(ui.getByText(/Simulated AI answer for this test/)).toBeTruthy();
  expect(ui.getByTestId('proof-ai')).toBeTruthy();
  expect(ui.getByTestId('proof-rules')).toBeTruthy();
  expect(ui.getByText(/Rules won/)).toBeTruthy();
});

test('no server: plain message, no crash', async () => {
  const ui = mount(reply({}), null);
  await act(async () => { fireEvent.press(ui.getByTestId('demo-overheat')); });
  expect(ui.getByText(/needs the LYLO server/)).toBeTruthy();
});

test('Home: "Try a demo scan" opens the demo', () => {
  const nav = { navigate: jest.fn() };
  const ui = render(<HomeScreen navigation={nav} />);
  fireEvent.press(ui.getByText('Try a demo scan'));
  expect(nav.navigate).toHaveBeenCalledWith('Demo');
});
