/* v0.7 code timeline card. Synthetic scans, in-memory storage. */
import React from 'react';
import { render, act } from './testUtils';
import CodeTimelineCard from '../../../hackathon/mobile-bridge/src/CodeTimelineCard';
import { DEMO_SCANS } from '../src/data/demoScans';

const memStore = () => { const m = {}; return { m, getItem: async (k) => m[k] || null, setItem: async (k, v) => { m[k] = v; } }; };
const mount = async (el) => { const ui = render(el); await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); return ui; };
const ON = { EXPO_PUBLIC_LYLO_CODE_TIMELINE: '1' };

test('flag off renders nothing and stores nothing', async () => {
  const st = memStore();
  const ui = await mount(<CodeTimelineCard scan={{ timestamp: 't1', stored: ['P0300'] }} env={{}} storage={st} />);
  expect(ui.queryByTestId('code-timeline')).toBeNull();
  expect(Object.keys(st.m)).toHaveLength(0);
});

test('real scan: honest note, pending label, recorded locally', async () => {
  const st = memStore();
  const ui = await mount(<CodeTimelineCard scan={{ timestamp: 't1', vin: '1FAKEVIN000000002', stored: [], pending: ['P0420'], permanent: [], pids: {} }} env={ON} storage={st} />);
  expect(ui.getByTestId('code-timeline')).toBeTruthy();
  expect(ui.getByText(/doesn't record dates/)).toBeTruthy();
  expect(ui.getByText('Pending, not lit yet')).toBeTruthy();
  expect(ui.getAllByText('Not reported by this car').length).toBe(4);
  expect(ui.queryByTestId('ct-demo')).toBeNull();
  expect(Object.keys(st.m)).toEqual(['lylo.codeTimeline']);
});

test('demo scan: synthetic timeline + freeze frame, never stored', async () => {
  const st = memStore();
  const ui = await mount(<CodeTimelineCard scan={DEMO_SCANS.checkengine} env={ON} storage={st} />);
  expect(ui.getByTestId('ct-demo')).toBeTruthy();
  expect(ui.getByTestId('ct-freeze')).toBeTruthy();
  expect(ui.getByText('Permanent, survives a clear')).toBeTruthy();
  expect(Object.keys(st.m)).toHaveLength(0);
});
