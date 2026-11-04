/* v0.7.5 one verdict (flag EXPO_PUBLIC_LYLO_ONE_VERDICT=1): every demo on its own screen, exactly one headline,
 * and the headline is never lower than anything else on screen, in Simple AND Mechanic view; plus a stubbed live scan.
 * Server replies are recorded replay fixtures (Muse off, synthetic/replay data). No network. */
process.env.EXPO_PUBLIC_LYLO_ONE_VERDICT = '1';
import React from 'react';
import { render, fireEvent, act } from './testUtils';
import DemoScreen from '../../../hackathon/mobile-bridge/src/DemoScreen';
import ResultsV2 from '../../../hackathon/mobile-bridge/src/ui2/ResultsV2';
const OV = require('../../../hackathon/mobile-bridge/src/oneVerdict');

jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useFocusEffect: () => {} }));
const ON = { EXPO_PUBLIC_LYLO_ONE_VERDICT: '1' };
const FX = (n) => require('../../../hackathon/mobile-bridge/test/fixtures/v075/' + n + '.json');
const BODY = {
  truck: () => ({ ...FX('truck') }), usedcar: () => ({ ...FX('usedcar') }), overheat: () => ({ ...FX('overheat') }),
  proof: () => FX('proof'), 'prove-prove_misfire_synthetic': () => FX('prove_misfire_synthetic'), 'prove-prove_lean_fail_synthetic': () => FX('prove_lean_fail_synthetic'),
};
const DEMOS = ['truck', 'usedcar', 'overheat', 'proof', 'checkengine', 'prove-prove_misfire_synthetic', 'prove-prove_lean_fail_synthetic'];
const HEADLINE_IDS = /^(one-headline-(green|yellow|orange|red)$|safety-(green|yellow|orange|red)$|vm-verdict-|proof-final$|proof-ai$|proof-rules$|demo-verdict$)/;
const RAW = /SAFE_TO_DRIVE|INSPECT_SOON|DRIVE_SHORT_DISTANCE_ONLY|DO_NOT_DRIVE|EMERGENCY_STOP|kept_rule_level|detective_lower_ignored|LYLO_HACK_MUSE/;

function textOf(n) { if (typeof n === 'string') return n; if (!n || !n.children) return ''; return n.children.map(textOf).join(''); }
function screenTexts(ui) {
  const root = ui._root();
  return root.findAll((n) => n.type === 'Text').map(textOf);
}
function headlineIds(ui) { return ui.testIdOrder().filter((id) => HEADLINE_IDS.test(id)); }

// The level a piece of on-screen text claims (null = none).
function levelOf(t) {
  let lv = null;
  for (const [k, v] of Object.entries(OV.TITLES)) if (t.includes(v.title)) lv = OV.maxLevel(lv || 'SAFE_TO_DRIVE', k);
  if (/short distance|short way|short trips/i.test(t)) lv = OV.maxLevel(lv || 'SAFE_TO_DRIVE', 'DRIVE_SHORT_DISTANCE_ONLY');
  if (/Leave it parked|Have it towed|Pull over/i.test(t)) lv = OV.maxLevel(lv || 'SAFE_TO_DRIVE', 'DO_NOT_DRIVE');
  return lv;
}

function assertOneVerdict(ui, label) {
  const ids = headlineIds(ui);
  expect({ label, ids }).toEqual({ label, ids: [ids.find((x) => x.startsWith('one-headline-') || x.startsWith('safety-') || x.startsWith('vm-verdict-'))].filter(Boolean) });
  expect(ids.length).toBe(1);
  const head = ui.queryByTestId('one-headline') ? textOf(ui.getByTestId('one-headline')) : null;
  const headLevel = head ? levelOf(head) : null;
  const texts = screenTexts(ui);
  const headRank = OV.rank(headLevel || 'SAFE_TO_DRIVE');
  texts.forEach((t) => {
    if (/^The (AI|safety rules) \(?simulated\)? said|^1\. The AI|^2\. The safety rules|^Rule level|^AI action|Meta AI suggested less serious|AI suggested it was less serious/.test(t)) return; // labeled inputs to the merge, shown as lower-or-equal by design
    const lv = levelOf(t);
    if (lv) expect({ label, t, lv, ok: OV.rank(lv) <= headRank }).toEqual({ label, t, lv, ok: true });
    expect({ label, t, raw: RAW.test(t) }).toEqual({ label, t, raw: false });
    expect({ label, t, ai: /Powered by Meta AI/.test(t) }).toEqual({ label, t, ai: false }); // Muse off in every fixture
  });
  return { head, texts };
}

const reply = (id) => jest.fn(async () => ({ ok: true, status: 200, json: async () => (BODY[id] ? BODY[id]() : {}) }));
const mount = (f) => render(<DemoScreen navigation={{ navigate: jest.fn() }} fetchImpl={f} baseUrl="https://x" appKey="k" oneEnv={ON} />);
const wait = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });

test('the list shows every demo and no verdict at all', () => {
  const ui = mount(reply('truck'));
  DEMOS.forEach((id) => expect(ui.getByTestId('demo-' + id)).toBeTruthy());
  expect(headlineIds(ui)).toEqual([]);
});

for (const id of DEMOS) {
  test(`${id}: own screen, car named, one headline, never lower than the screen (Simple + Mechanic)`, async () => {
    const ui = mount(reply(id));
    await act(async () => { fireEvent.press(ui.getByTestId('demo-' + id)); });
    await wait();
    expect(textOf(ui.getByTestId('one-car')).length).toBeGreaterThan(3);
    const a = assertOneVerdict(ui, id + ' simple');
    if (ui.queryByTestId('vm-toggle-mechanic')) {
      fireEvent.press(ui.getByTestId('vm-toggle-mechanic'));
      const b = assertOneVerdict(ui, id + ' mechanic');
      expect(b.head).toBe(a.head);
    }
    fireEvent.press(ui.getByTestId('demo-back'));
    expect(headlineIds(ui)).toEqual([]); // switching demos clears the last result
  });
}

test('proof title comes from the server, not hard-coded', async () => {
  const ui = mount(reply('proof'));
  await act(async () => { fireEvent.press(ui.getByTestId('demo-proof')); }); await wait();
  expect(textOf(ui.getByTestId('one-car'))).toBe(FX('proof').proof.title);
  expect(textOf(ui.getByTestId('one-headline'))).toBe('Pull over now');
});

test('truck: cold engine + high trim reads "Get it checked soon", with the recheck-warm note', async () => {
  const ui = mount(reply('truck'));
  await act(async () => { fireEvent.press(ui.getByTestId('demo-truck')); }); await wait();
  expect(textOf(ui.getByTestId('one-headline'))).toBe('Get it checked soon');
  expect(ui.getByText(/still cold, so this reading is not reliable yet/)).toBeTruthy();
});

test('stubbed LIVE scan, results screen: one headline, raised by a pending misfire, never lower than the screen', async () => {
  const live = { safety: { level: 'SAFE_TO_DRIVE', triggering_conditions: [] }, session_id: 'STUB',
    detective: { muse_status: 'off', ledger: [
      { id: 'dtc:P0171', type: 'dtc', code: 'P0171', status: 'stored' }, { id: 'dtc:P0303', type: 'dtc', code: 'P0303', status: 'pending' },
      { id: 'pid:ENGINE_COOLANT_TEMP', name: 'ENGINE_COOLANT_TEMP', value: 190, unit: '°F' }] } };
  const scan = { serverDiagnosis: { source: 'server', result: live }, stored: ['P0171'], pending: ['P0303'], permanent: [], pids: { coolant_temp_f: 190 } };
  for (const vm of ['simple', 'mechanic']) {
    const store = { getItem: async (k) => (k === 'lylo.viewMode' ? vm : null), setItem: async () => {} };
    const ui = render(<ResultsV2 scan={scan} screen="codes" storage={store} viewEnv={{ EXPO_PUBLIC_LYLO_VIEW_MODE: '1' }} homeEnv={{ EXPO_PUBLIC_LYLO_HOME_V3: '1' }} oneEnv={ON} />);
    await wait();
    const ids = headlineIds(ui);
    expect({ vm, ids, n: ids.length }).toEqual({ vm, ids, n: 1 });
    const headNode = ui.queryByTestId('vm-verdict-orange') || ui.queryByTestId('safety-orange');
    expect({ vm, orange: !!headNode }).toEqual({ vm, orange: true });
    screenTexts(ui).forEach((t) => { const lv = levelOf(t); if (lv && !/^Rule level|^AI action/.test(t)) expect({ vm, t, ok: OV.rank(lv) <= OV.rank('DRIVE_SHORT_DISTANCE_ONLY') }).toEqual({ vm, t, ok: true }); });
  }
});

// ---- r2 (Vera conditions) ----
import MetaAiCard from '../../../hackathon/mobile-bridge/src/MetaAiCard';

test('C2: lean-fail replay (cold 120 °F, +14 % short-term trim, BANK_1 name) is no longer "Good to drive"', async () => {
  const f = OV.factsFromResult(FX('prove_lean_fail_synthetic'));
  expect({ coolantF: f.coolantF, trim: f.trim }).toEqual({ coolantF: 120, trim: 14 });
  const ui = mount(reply('prove-prove_lean_fail_synthetic'));
  await act(async () => { fireEvent.press(ui.getByTestId('demo-prove-prove_lean_fail_synthetic')); }); await wait();
  const h = textOf(ui.getByTestId('one-headline'));
  expect(h).not.toBe('Good to drive');
  expect(h).toBe('Get it checked soon');
});

const metaScan = (det, demoLabel) => ({ demoLabel: demoLabel || null, serverDiagnosis: { source: 'server', result: { safety: { level: 'INSPECT_SOON' }, detective: det } } });
const allText = (ui) => screenTexts(ui).join(' | ');

test('Meta AI card: flag off renders nothing (unchanged)', () => {
  const ui = render(<MetaAiCard scan={metaScan({ muse_status: 'ok' })} env={{}} />);
  expect(ui.queryByTestId('meta-ai-on')).toBeNull(); expect(ui.queryByTestId('meta-ai-off')).toBeNull();
});

test('Meta AI card: muse_status "off" and missing -> "didn\'t run ... safety rules only"', () => {
  for (const det of [{ muse_status: 'off' }, {}]) {
    const ui = render(<MetaAiCard scan={metaScan(det)} env={ON} />);
    expect(ui.getByTestId('meta-ai-off')).toBeTruthy();
    expect(allText(ui)).toMatch(/Meta AI didn't run on this scan\. This answer comes from the safety rules only\./);
    expect(ui.queryByTestId('meta-ai-timeout')).toBeNull();
  }
});

test('Meta AI card: "error: TIMEOUT" (muse.py:65) -> "didn\'t answer in time"', () => {
  for (const st of ['error: TIMEOUT', 'error: TIMEOUT; deterministic result returned unchanged']) {
    const ui = render(<MetaAiCard scan={metaScan({ muse_status: st })} env={ON} />);
    expect(allText(ui)).toMatch(/Meta AI didn't answer in time, so this is the safety rules' answer\./);
    expect(allText(ui)).not.toMatch(/didn't run|had a problem/);
  }
});

for (const code of ['NO_KEY', 'HTTP_500', 'HTTP_401', 'RATE_LIMIT', 'NETWORK', 'BAD_JSON', 'BAD_SHAPE']) {
  test(`Meta AI card: "error: ${code}" -> "had a problem"`, () => {
    const ui = render(<MetaAiCard scan={metaScan({ muse_status: `error: ${code}; deterministic result returned unchanged` })} env={ON} />);
    expect(allText(ui)).toMatch(/Meta AI had a problem on this scan, so this is the safety rules' answer\./);
    expect(allText(ui)).not.toMatch(/in time|didn't run/);
  });
}

test('Meta AI card: "off (...)" and "skipped (...)" server strings -> "didn\'t run"', () => {
  for (const st of ['off (LYLO_HACK_MUSE is not 1)', 'skipped (deterministic rebuild)']) {
    const ui = render(<MetaAiCard scan={metaScan({ muse_status: st })} env={ON} />);
    expect(allText(ui)).toMatch(/Meta AI didn't run on this scan\./);
  }
});

const OKDET = { muse_status: 'ok', receipt: { model: 'Llama-4-Maverick', latency_ms: 4200 }, explanation: { text: 'Cylinder 3 coil is the likeliest cause.' }, hypotheses: [{}, {}] };
test('Meta AI card: muse_status "ok" -> model and explanation shown; live says "readings from your car"', () => {
  const ui = render(<MetaAiCard scan={metaScan(OKDET)} env={ON} />);
  const t = allText(ui);
  expect(ui.getByTestId('meta-ai-on')).toBeTruthy();
  expect(t).toMatch(/Model: Llama-4-Maverick · 4.2s/); expect(t).toMatch(/Cylinder 3 coil is the likeliest cause\./);
  expect(t).toMatch(/readings from your car/); expect(t).not.toMatch(/saved scan/);
});

test('Meta AI card: on a replay says "from this saved scan", never "readings from your car"', () => {
  const ui = render(<MetaAiCard scan={metaScan(OKDET, 'REPLAY: saved scan')} env={ON} />);
  const t = allText(ui);
  expect(t).toMatch(/from this saved scan/); expect(t).not.toMatch(/readings from your car/);
});

test('Meta AI card appears on the results screen only with the flag on', async () => {
  const scan = metaScan({ muse_status: 'off', ledger: [] });
  for (const [env, want] of [[ON, true], [{}, false]]) {
    const store = { getItem: async (k) => (k === 'lylo.viewMode' ? 'mechanic' : null), setItem: async () => {} };
    const ui = render(<ResultsV2 scan={scan} screen="codes" storage={store} viewEnv={{ EXPO_PUBLIC_LYLO_VIEW_MODE: '1' }} homeEnv={{ EXPO_PUBLIC_LYLO_HOME_V3: '1' }} oneEnv={env} />);
    await wait();
    expect({ env, shown: !!ui.queryByTestId('meta-ai-off') }).toEqual({ env, shown: want });
  }
});
