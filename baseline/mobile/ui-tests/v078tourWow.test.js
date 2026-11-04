/* v0.7.8: EXPO_PUBLIC_LYLO_DEMO_NO_CONNECT and EXPO_PUBLIC_LYLO_TOUR_WOW (each must equal exactly '1').
 * Synthetic tour data only; fetch throws so any network call fails. */
import React from 'react';
import { render, fireEvent, act } from './testUtils';
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useFocusEffect: () => {} }));
import { TourScreen } from '../../../hackathon/mobile-bridge/src/TourScreens';
const { TOURS } = require('../../../hackathon/mobile-bridge/src/tours');
const T = require('../../../hackathon/mobile-bridge/src/tours/common');
const OV = require('../../../hackathon/mobile-bridge/src/oneVerdict');

jest.useFakeTimers(); // Animated loops must not outlive the test env
global.fetch = jest.fn(() => { throw new Error('no network'); });
const nav = () => ({ navigate: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => () => {}) });
function textOf(n) { if (typeof n === 'string') return n; if (!n || !n.children) return ''; return n.children.map(textOf).join(''); }
const allText = (ui) => ui._root().findAll((n) => n.type === 'Text').map(textOf).join('\n');
const PROMPT = /connect|pair |pair\b|bluetooth|scan my car|scan your own car/i;

function walk(tour, flags, each) {
  const n = nav();
  const ui = render(<TourScreen route={{ params: { id: tour.id } }} navigation={n} env={flags} />);
  const parts = tour.parts ? tour.parts.length : 1;
  for (let part = 0; part < parts; part++) {
    const steps = T.stepsFor(tour, part);
    for (let i = 0; i < steps.length; i++) { each(ui, 'step', steps[i], part, i); act(() => { fireEvent.press(ui.getByTestId('tour-next')); }); }
    each(ui, 'done', null, part);
    if (part < parts - 1) act(() => { fireEvent.press(ui.getByTestId('tour-next-part')); });
  }
  return { ui, n };
}

test('NO_CONNECT=1: no tour screen shows a connect/pair/scan-my-car prompt and none navigates to Connect/Scan', () => {
  TOURS.forEach((t) => {
    const { ui, n } = walk(t, { EXPO_PUBLIC_LYLO_DEMO_NO_CONNECT: '1' }, (ui, kind) => {
      if (kind !== 'done') return;
      const btn = ui.queryByTestId('tour-try');
      if (btn) expect({ t: t.id, label: textOf(btn) }).toEqual({ t: t.id, label: expect.not.stringMatching(PROMPT) });
    });
    const tryB = ui.queryByTestId('tour-try'); if (tryB) act(() => { fireEvent.press(tryB); });
    n.navigate.mock.calls.forEach(([r]) => expect({ t: t.id, r }).toEqual({ t: t.id, r: expect.not.stringMatching(/^(Connect|Scan)$/) }));
  });
});

test('flags off: scan-clear tour still ends with "Scan my car" to Connect (unchanged)', () => {
  const t = TOURS.find((x) => x.id === 'scanclear');
  const { ui, n } = walk(t, {}, () => {});
  expect(textOf(ui.getByTestId('tour-try'))).toBe('Scan my car');
  act(() => { fireEvent.press(ui.getByTestId('tour-try')); });
  expect(n.navigate).toHaveBeenCalledWith('Connect', { then: 'scan' });
  expect(ui.queryByTestId('wow-progress')).toBeNull();
  expect(ui.queryByTestId('wow-payoff')).toBeNull();
});

test('NO_CONNECT="true" (not exactly 1) = old behavior', () => {
  const t = TOURS.find((x) => x.id === 'scanclear');
  const { ui } = walk(t, { EXPO_PUBLIC_LYLO_DEMO_NO_CONNECT: 'true' }, () => {});
  expect(textOf(ui.getByTestId('tour-try'))).toBe('Scan my car');
});

const NO_PAYOFF = ['photo', 'rules', 'collision', 'crashguard', 'noadapter'];

test('TOUR_WOW=1: progress bar, code chips, payoff, one verdict only, every tour', () => {
  TOURS.forEach((t) => {
    walk(t, { EXPO_PUBLIC_LYLO_TOUR_WOW: '1' }, (ui, kind, st, part) => {
      const heads = ui.testIdOrder().filter((id) => /^one-headline-(green|yellow|orange|red)$/.test(id));
      expect({ t: t.id, n: heads.length }).toEqual({ t: t.id, n: 1 });
      const want = T.verdictOf(t, part).title.title;
      const txt = allText(ui).split('\n').filter((x) => x === want);
      expect({ t: t.id, n: txt.length }).toEqual({ t: t.id, n: 1 }); // payoff never repeats the verdict
      if (kind === 'step') expect(ui.queryByTestId('wow-progress')).toBeTruthy();
      if (kind === 'done' && !(t.parts && part < t.parts.length - 1)) { expect(ui.getByTestId('wow-sweep')).toBeTruthy(); if (!NO_PAYOFF.includes(t.id)) expect(ui.getByTestId('wow-payoff')).toBeTruthy(); }
    });
  });
});

test('TOUR_WOW=1: scan-clear shows its sample codes as chips; used car flashes recently cleared', () => {
  const sc = TOURS.find((x) => x.id === 'scanclear');
  let saw = false;
  walk(sc, { EXPO_PUBLIC_LYLO_TOUR_WOW: '1' }, (ui, kind) => { if (kind === 'step' && ui.queryByTestId('wow-codes')) { saw = true; expect(allText(ui)).toMatch(/P0302/); } });
  expect(saw).toBe(true);
  const uc = TOURS.find((x) => x.id === 'usedcar');
  let flash = false;
  walk(uc, { EXPO_PUBLIC_LYLO_TOUR_WOW: '1' }, (ui) => { if (ui.queryByTestId('wow-cleared')) flash = true; });
  expect(flash).toBe(true);
});

test('TOUR_WOW=1: Mechanic view + price steps show the real Watch-how YouTube button from the app code', () => {
  const PL = require('../../../hackathon/mobile-bridge/src/priceLinks');
  ['views', 'vinprice'].forEach((id) => {
    const t = TOURS.find((x) => x.id === id);
    let seen = false;
    walk(t, { EXPO_PUBLIC_LYLO_TOUR_WOW: '1' }, (ui, kind, st) => {
      if (st && st.live === 'repair') {
        seen = true;
        expect(ui.getByTestId('wow-live-repair')).toBeTruthy();
        expect(ui.getByTestId('watch-how')).toBeTruthy();
      }
    });
    expect({ id, seen }).toEqual({ id, seen: true });
  });
  expect(PL.youtubeUrl('P0302 x')).toMatch(/^https:\/\/www\.youtube\.com\/results\?search_query=/);
});

test('TOUR_WOW=1: tours with no reasons/codes render no payoff, and the why sentence is never repeated (Headline line exactly once)', () => {
  NO_PAYOFF.forEach((id) => {
    const t = TOURS.find((x) => x.id === id);
    expect({ id, found: !!t }).toEqual({ id, found: true });
    walk(t, { EXPO_PUBLIC_LYLO_TOUR_WOW: '1' }, (ui, kind, st, part) => {
      const why = T.verdictOf(t, part).title.why;
      const all = allText(ui);
      const sub = T.partOf(t, part).sub;
      const n = all.split(why).length - 1; // Headline shows sub || why (DemoScreenOne.js:41)
      expect({ id, kind, n }).toEqual({ id, kind, n: sub && !sub.includes(why) ? 0 : 1 }); // never a second copy
      const line = sub || why;
      expect({ id, kind, line: all.split(line).length - 1 }).toEqual({ id, kind, line: 1 });
      if (kind === 'done') expect({ id, payoff: ui.queryByTestId('wow-payoff') }).toEqual({ id, payoff: null });
    });
  });
});
