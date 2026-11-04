/* v0.7.6 guided tours (flag EXPO_PUBLIC_LYLO_TOUR=1). Every tour: own screen, car named, exactly one headline
 * at every step, never lower than anything on screen, "Step i of N", "Try it yourself" at the end.
 * Synthetic / replay data only; fetch is stubbed to throw so any network call fails the test. */
import React from 'react';
import { render, fireEvent, act } from './testUtils';
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useFocusEffect: () => {} }));
import { TourListScreen, TourScreen } from '../../../hackathon/mobile-bridge/src/TourScreens';
const { TOURS } = require('../../../hackathon/mobile-bridge/src/tours');
const T = require('../../../hackathon/mobile-bridge/src/tours/common');
const OV = require('../../../hackathon/mobile-bridge/src/oneVerdict');

global.fetch = jest.fn(() => { throw new Error('tours must not use the network'); });
const nav = () => ({ navigate: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => () => {}) });
function textOf(n) { if (typeof n === 'string') return n; if (!n || !n.children) return ''; return n.children.map(textOf).join(''); }
const texts = (ui) => ui._root().findAll((n) => n.type === 'Text').map(textOf);
const heads = (ui) => ui.testIdOrder().filter((id) => /^one-headline-(green|yellow|orange|red)$/.test(id));
const TITLE_RX = Object.keys(OV.TITLES).map((lv) => [lv, new RegExp(OV.TITLES[lv].title.replace(/[.']/g, (c) => (c === '.' ? '\\.' : "['’]")), 'i')]);
const levelsIn = (t) => TITLE_RX.filter(([, rx]) => rx.test(t)).map(([lv]) => lv);
const RAW = /SAFE_TO_DRIVE|INSPECT_SOON|DRIVE_SHORT_DISTANCE_ONLY|DO_NOT_DRIVE|TOW_RECOMMENDED|EMERGENCY_STOP/;

function assertScreen(ui, tour, part, where) {
  const ids = heads(ui);
  expect({ where, n: ids.length }).toEqual({ where, n: 1 });
  const head = textOf(ui.getByTestId('one-headline'));
  const want = T.verdictOf(tour, part);
  expect({ where, head }).toEqual({ where, head: want.title.title });
  expect(textOf(ui.getByTestId('one-car')).length).toBeGreaterThan(5);
  expect(OV.rank(want.level)).toBeGreaterThanOrEqual(OV.rank(OV.decide(undefined, {}).level));
  // never lower: the only verdict words on screen are the headline's own
  texts(ui).forEach((t) => {
    if (t === head) return;
    expect({ where, t, other: levelsIn(t) }).toEqual({ where, t, other: [] }); // stricter than never-lower: no second verdict at all
  });
  // raw enums may appear only inside the mechanic "More detail" box
  texts(ui).forEach((t) => { if (RAW.test(t)) expect({ where, inDeep: ui.queryByTestId('tour-deep') && textOf(ui.getByTestId('tour-deep')) === t }).toEqual({ where, inDeep: true }); });
}

test('there are the tours in build order, all synthetic/replay, verdicts fail closed', () => {
  expect(TOURS.length).toBeGreaterThan(0);
  TOURS.forEach((t) => {
    expect(t.tryIt && t.tryIt.route).toBeTruthy();
    (t.parts || [t]).forEach((p, i) => {
      const v = T.verdictOf(t, i);
      expect(OV.rank(v.level)).toBeGreaterThanOrEqual(OV.rank('INSPECT_SOON')); // no tour data is "all clear"
      if (p.body && p.body.safety) expect(OV.rank(v.level)).toBeGreaterThanOrEqual(OV.rank(p.body.safety.level)); // never below the rules
    });
    t.steps.forEach((s) => { expect(levelsIn(s.t + ' ' + s.say)).toEqual([]); expect(s.say.length).toBeLessThan(200); expect(s.deep.length).toBeGreaterThan(10); });
  });
});

test('tour list: every tour listed, no verdict on the list, opens the tour', () => {
  const n = nav();
  const ui = render(<TourListScreen navigation={n} />);
  TOURS.forEach((t) => expect(ui.getByTestId('tour-' + t.id)).toBeTruthy());
  expect(heads(ui)).toEqual([]);
  fireEvent.press(ui.getByTestId('tour-' + TOURS[0].id));
  expect(n.navigate).toHaveBeenLastCalledWith('Tour', { id: TOURS[0].id });
});

for (const tour of TOURS) {
  test(`tour ${tour.n} ${tour.id}: one headline at every step (plain + detail), never lower, Try it yourself`, async () => {
    const n = nav();
    const ui = render(<TourScreen route={{ params: { id: tour.id } }} navigation={n} />);
    const parts = tour.parts ? tour.parts.length : 1;
    for (let part = 0; part < parts; part++) {
      const steps = T.stepsFor(tour, part);
      if (tour.parts) expect(textOf(ui.getByTestId('tour-part'))).toBe(`Part ${part + 1} of ${parts}`);
      for (let i = 0; i < steps.length; i++) {
        expect(textOf(ui.getByTestId('tour-stepno'))).toBe(`Step ${i + 1} of ${steps.length}`);
        assertScreen(ui, tour, part, `${tour.id} p${part} s${i + 1}`);
        fireEvent.press(ui.getByTestId('tour-more'));
        expect(textOf(ui.getByTestId('tour-deep'))).toBe(steps[i].deep);
        assertScreen(ui, tour, part, `${tour.id} p${part} s${i + 1} detail`);
        fireEvent.press(ui.getByTestId('tour-more'));
        fireEvent.press(ui.getByTestId('tour-next'));
      }
      assertScreen(ui, tour, part, `${tour.id} p${part} end`);
      if (part < parts - 1) fireEvent.press(ui.getByTestId('tour-next-part'));
    }
    expect(ui.getByText('Try it yourself')).toBeTruthy();
    fireEvent.press(ui.getByTestId('tour-try'));
    expect(n.navigate).toHaveBeenLastCalledWith(tour.tryIt.route, tour.tryIt.params);
    expect(global.fetch).not.toHaveBeenCalled();
  });
}

// ---- Home entry ----
jest.mock('react-native-ble-plx', () => ({ BleManager: jest.fn().mockImplementation(() => ({ state: jest.fn().mockResolvedValue('PoweredOn'), startDeviceScan: jest.fn(), stopDeviceScan: jest.fn() })) }), { virtual: true });
jest.mock('react-native-bluetooth-classic', () => ({ __esModule: true, default: { getBondedDevices: jest.fn().mockResolvedValue([]) } }), { virtual: true });
import HomeV2 from '../../../hackathon/mobile-bridge/src/ui2/HomeV2';
const memStore = (init = {}) => { const m = { ...init }; return { m, getItem: async (k) => m[k] ?? null, setItem: async (k, v) => { m[k] = v; } }; };
test('Home "Try a Demo" opens the tour list only when EXPO_PUBLIC_LYLO_TOUR is exactly "1"', async () => {
  for (const [tour, want] of [['1', 'Tours'], [undefined, 'Demo'], ['true', 'Demo']]) {
    const env = { EXPO_PUBLIC_LYLO_HOME_V3: '1', EXPO_PUBLIC_LYLO_VIEW_MODE: '1', ...(tour ? { EXPO_PUBLIC_LYLO_TOUR: tour } : {}) };
    const n = nav();
    const ui = render(<HomeV2 navigation={n} noAdapterOn demoOn env={env} storage={memStore({ 'lylo.viewMode': 'mechanic' })} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    fireEvent.press(ui.getByTestId('card-demo'));
    expect({ tour, to: n.navigate.mock.calls.slice(-1)[0][0] }).toEqual({ tour, to: want });
  }
});
