/* v0.7.7 (Vera condition 1): legacy CodesScreen / CodeDetail badge goes through oneVerdict.decide() behind
 * EXPO_PUBLIC_LYLO_ONE_VERDICT=1 (set before compile by ui-tests/env/flagsOn.js). It can only raise the level. */
import React from 'react';
import { render } from './testUtils';
jest.mock('react-native-ble-plx', () => ({ BleManager: jest.fn().mockImplementation(() => ({ state: jest.fn().mockResolvedValue('PoweredOn'), startDeviceScan: jest.fn(), stopDeviceScan: jest.fn() })) }), { virtual: true });
jest.mock('react-native-bluetooth-classic', () => ({ __esModule: true, default: { getBondedDevices: jest.fn().mockResolvedValue([]) } }), { virtual: true });
import CodesScreen from '../src/screens/CodesScreen';
import CodeDetailScreen from '../src/screens/CodeDetailScreen';
const OV = require('../../../hackathon/mobile-bridge/src/oneVerdict');
const { buildCodeResult } = require('../src/engine/diagnose');

const nav = { navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn(), popToTop: jest.fn(), addListener: jest.fn(() => () => {}) };
const scanOf = (stored) => ({ stored, pending: [], permanent: [], monitor: { milOn: true, incomplete: [] }, pids: {} });
const LIB = { green: 'SAFE_TO_DRIVE', yellow: 'INSPECT_SOON', orange: 'DRIVE_SHORT_DISTANCE_ONLY', red: 'DO_NOT_DRIVE' };

test('flag is on before compile (exactly "1")', () => { expect(OV.on()).toBe(true); });

test('stored P0171 on CodesScreen: no "SAFE TO DRIVE", badge raised to GET IT CHECKED SOON', () => {
  expect(buildCodeResult('P0171', 'stored').urgency.level).toBe('SAFE TO DRIVE'); // the library value that used to show
  const ui = render(<CodesScreen route={{ params: { scan: scanOf(['P0171']) } }} navigation={nav} />);
  expect(ui.queryByText(/SAFE TO DRIVE/i)).toBeNull();
  expect(ui.getAllByText('GET IT CHECKED SOON').length).toBeGreaterThanOrEqual(1);
});

test('CodeDetail for P0171: badge and message come from decide()', () => {
  const r = buildCodeResult('P0171', 'stored');
  const ui = render(<CodeDetailScreen route={{ params: { code: 'P0171', result: r } }} navigation={nav} />);
  expect(ui.queryByText(/SAFE TO DRIVE/i)).toBeNull();
  expect(ui.getAllByText('GET IT CHECKED SOON').length).toBeGreaterThanOrEqual(1);
  expect(ui.getAllByText(OV.TITLES.INSPECT_SOON.why).length).toBeGreaterThanOrEqual(1);
});

test('never lower: for every library code the badge level >= library level and >= INSPECT_SOON', () => {
  const codes = ['P0171', 'P0174', 'P0300', 'P0302', 'P0420', 'P0442', 'P0455', 'P0128', 'P0217', 'P0524', 'P9999'];
  codes.forEach((c) => {
    const r = buildCodeResult(c, 'stored'); const b = OV.codeBadge(r);
    expect(OV.rank(b.level)).toBeGreaterThanOrEqual(OV.rank(LIB[r.urgency.color]));
    expect(OV.rank(b.level)).toBeGreaterThanOrEqual(OV.rank('INSPECT_SOON'));
  });
});

test('flag off (env prop) or flag not exactly "1": legacy badge unchanged (codeBadge returns null)', () => {
  const r = buildCodeResult('P0171', 'stored');
  expect(OV.codeBadge(r, { EXPO_PUBLIC_LYLO_ONE_VERDICT: '0' })).toBeNull();
  expect(OV.codeBadge(r, { EXPO_PUBLIC_LYLO_ONE_VERDICT: 'true' })).toBeNull();
  expect(OV.codeBadge(r, { EXPO_PUBLIC_LYLO_ONE_VERDICT: '1' }).text).toBe('GET IT CHECKED SOON');
});

test('tour 9 renamed; no tour or demo title claims Meta AI ran', () => {
  const TOURS = require('../../../hackathon/mobile-bridge/src/tours');
  const list = TOURS.TOURS || TOURS.default || TOURS;
  const t9 = list.find((t) => t.n === 9);
  expect(t9.title).toBe('Locked-guess proof: one holds, one fails');
  list.filter((t) => t.id !== 'metaai').forEach((t) => {
    const txt = JSON.stringify([t.title, t.short, t.sub, t.steps, t.parts && t.parts.map((p) => [p.car, p.sub])]);
    expect(txt).not.toMatch(/Meta/);
  });
  const m = list.find((t) => t.id === 'metaai'); // only tour allowed to say Meta: it replays a REAL recorded answer
  if (m) { expect(m.sub).toMatch(/^Recorded real Meta AI answer \(/); expect(m.body.detective.muse_status).toBe('ok'); }
  const fs = require('fs'); const src = fs.readFileSync(require.resolve('../../../hackathon/mobile-bridge/src/DemoScreenOne.js'), 'utf8');
  expect(src).not.toMatch(/'Meta AI proof/);
  expect(src).toMatch(/'Locked-guess proof: ' \+ c\.title/);
});
