/* v0.5.2: fixes from Chris's Nov 2 LX scan (1998 E-450). Synthetic / saved fixtures only. */
import React from 'react';
import { Linking } from 'react-native';
import { render, fireEvent, act } from './testUtils';
import ResultsV2 from '../../../hackathon/mobile-bridge/src/ui2/ResultsV2';
import DashVoicePanel from '../../../hackathon/mobile-bridge/src/DashVoicePanel';

const truck = () => JSON.parse(JSON.stringify(require('../../../hackathon/mobile-bridge/test/fixtures/truck.json').scan));
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const mem = () => ({ getItem: async () => null, setItem: async () => {} });
const ON = { EXPO_PUBLIC_LYLO_SERVER_URL: 'https://x', EXPO_PUBLIC_LYLO_VOICE_ASK: '1', EXPO_PUBLIC_LYLO_APP_KEY: 'k' };
const audio = (perm) => ({ getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => perm), setAudioModeAsync: async () => {},
  Recording: { createAsync: async () => ({ recording: { stopAndUnloadAsync: async () => {}, getURI: () => 'file:///q.aac' } }) } });

test('proof header renders a real middle dot, and the counts say what they count', async () => {
  const ui = render(<ResultsV2 scan={truck()} storage={mem()} dashVoice={{ env: {} }} prove={{ env: {} }} />);
  await settle();
  expect(ui.getByText('THE PROOF · MUSE DETECTIVE')).toBeTruthy();
  expect(ui.queryByText(/\\u00B7/)).toBeNull();
  const n = truck().serverDiagnosis.result.detective.hypotheses.length;
  expect(ui.getByTestId('causes-count').props.children).toMatch(new RegExp(`^${n} possible causes?, all AI's guesses\\. The counts below are the evidence behind them`));
});

test('mic: asks in-app on tap; granted starts listening', async () => {
  const a = audio({ granted: true });
  const ui = render(<DashVoicePanel scan={truck()} env={ON} audio={a} />);
  await act(async () => { fireEvent.press(ui.getAllByText('Ask out loud')[0]); });
  await settle();
  expect(a.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(ui.getByText(/Listening/)).toBeTruthy();
});

test('mic: denied once -> ask again note, no settings button', async () => {
  const ui = render(<DashVoicePanel scan={truck()} env={ON} audio={audio({ granted: false, canAskAgain: true })} />);
  await act(async () => { fireEvent.press(ui.getAllByText('Ask out loud')[0]); });
  expect(ui.getByText(/choose Allow/)).toBeTruthy();
  expect(ui.queryByTestId('mic-settings')).toBeNull();
});

test('mic: never ask again -> Open settings button opens app settings', async () => {
  const spy = jest.spyOn(Linking, 'openSettings').mockImplementation(async () => {});
  const ui = render(<DashVoicePanel scan={truck()} env={ON} audio={audio({ granted: false, canAskAgain: false })} />);
  await act(async () => { fireEvent.press(ui.getAllByText('Ask out loud')[0]); });
  expect(ui.getByText(/Open settings/, { exact: false })).toBeTruthy();
  fireEvent.press(ui.getByTestId('mic-settings'));
  expect(spy).toHaveBeenCalled();
});
