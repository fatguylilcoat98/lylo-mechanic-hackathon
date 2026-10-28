/* v0.4.4 hackathon: "Snap the dash" + "Ask out loud" on the results screen (hackathon/mobile-bridge/src/DashVoicePanel). */
import React from 'react';
import { render, fireEvent, act } from './testUtils';
import SimpleResults from '../../../hackathon/mobile-bridge/src/SimpleResults';
import DashVoicePanel from '../../../hackathon/mobile-bridge/src/DashVoicePanel';

const vision = require('../../../hackathon/server/evidence/vision_usedcar_dash.json').response;
const voice = require('../../../hackathon/server/evidence/voice_usedcar_question.json').response;
const truck = () => JSON.parse(JSON.stringify(require('../../../hackathon/mobile-bridge/test/fixtures/truck.json').scan));
const at = (lv) => { const s = truck(); s.serverDiagnosis.result.safety.level = lv; return s; };
const mem = () => { const m = {}; return { getItem: async (k) => m[k] ?? null, setItem: async (k, v) => { m[k] = v; } }; };
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
global.FormData = class { append() {} };
const ON = { EXPO_PUBLIC_LYLO_SERVER_URL: 'https://x', EXPO_PUBLIC_LYLO_DASH_PHOTO: '1', EXPO_PUBLIC_LYLO_VOICE_ASK: '1', EXPO_PUBLIC_LYLO_APP_KEY: 'k' };
const picker = (granted = true) => ({ MediaTypeOptions: { Images: 'Images' },
  requestCameraPermissionsAsync: async () => ({ granted }), requestMediaLibraryPermissionsAsync: async () => ({ granted }),
  launchCameraAsync: async () => ({ canceled: false, assets: [{ uri: 'file:///dash.jpg', width: 1280, height: 720 }] }),
  launchImageLibraryAsync: async () => ({ canceled: true }) });
const audio = (granted = true) => ({ requestPermissionsAsync: async () => ({ granted }), setAudioModeAsync: async () => {},
  AndroidOutputFormat: { AAC_ADTS: 6 }, AndroidAudioEncoder: { AAC: 3 },
  Recording: { createAsync: async () => ({ recording: { stopAndUnloadAsync: async () => {}, getURI: () => 'file:///q.aac' } }) } });
const fetchOf = (status, body) => async () => ({ ok: status < 400, status, json: async () => body });
const mount = async (scan, dv) => { const ui = render(<SimpleResults scan={scan} screen="usedcar" storage={mem()} dashVoice={dv} />); await settle(); return ui; };

test('flags unset: no buttons, results screen unchanged', async () => {
  const ui = await mount(at('DRIVE_SHORT_DISTANCE_ONLY'));
  expect(ui.queryByText('Snap the dash')).toBeNull();
  expect(ui.queryByText('Ask out loud')).toBeNull();
  expect(ui.queryByText(/Add more to this check/)).toBeNull();
});

test('snap the dash: findings shown and the verdict is raised (live evidence, mocked fetch)', async () => {
  const ui = await mount(at('DRIVE_SHORT_DISTANCE_ONLY'), { env: ON, picker: picker(), fetchImpl: fetchOf(200, vision) });
  expect(ui.getAllByText(/Drive only short trips/).length).toBe(1);
  await act(async () => { fireEvent.press(ui.getAllByText('Snap the dash')[0]); });
  await settle();
  expect(ui.getByText(/raised the safety level from "[^"]+" to "do not drive"/i)).toBeTruthy();
  expect(ui.getByText(/Red oil pressure warning light/)).toBeTruthy();
  expect(ui.getAllByText(/Don't drive it/).length).toBe(1);
  expect(ui.queryByText(/Drive only short trips/)).toBeNull();
  expect(ui.getByText(/never lower it/)).toBeTruthy();
});

test('a photo never lowers: TOW stays TOW', async () => {
  const ui = await mount(at('TOW_RECOMMENDED'), { env: ON, picker: picker(), fetchImpl: fetchOf(200, { ...vision, final_safety_level: 'SAFE_TO_DRIVE', photo_safety_floor: 'SAFE_TO_DRIVE' }) });
  await act(async () => { fireEvent.press(ui.getAllByText('Snap the dash')[0]); });
  await settle();
  expect(ui.queryByText(/raised the safety level/)).toBeNull();
  expect(ui.queryByText(/Good to drive/)).toBeNull();
});

test('camera permission denied and server offline give plain messages', async () => {
  const s = at('INSPECT_SOON');
  let ui = render(<DashVoicePanel scan={s} env={ON} picker={picker(false)} />);
  await act(async () => { fireEvent.press(ui.getAllByText('Snap the dash')[0]); });
  expect(ui.getByText(/needs camera permission/)).toBeTruthy();
  ui = render(<DashVoicePanel scan={s} env={ON} picker={picker()} fetchImpl={async () => { throw new Error('Network request failed'); }} />);
  await act(async () => { fireEvent.press(ui.getAllByText('Snap the dash')[0]); });
  await settle();
  expect(ui.getByText(/Could not reach the LYLO server/)).toBeTruthy();
  ui = render(<DashVoicePanel scan={s} env={ON} picker={picker()} fetchImpl={fetchOf(503, { error: 'off' })} />);
  await act(async () => { fireEvent.press(ui.getAllByText('Snap the dash')[0]); });
  await settle();
  expect(ui.getByText(/turned off on the LYLO server/)).toBeTruthy();
});

test('ask out loud: record, stop, transcript + safety notice + cited answer', async () => {
  const ui = render(<DashVoicePanel scan={at('DO_NOT_DRIVE')} env={ON} audio={audio()} fetchImpl={fetchOf(200, voice)} />);
  await act(async () => { fireEvent.press(ui.getAllByText('Ask out loud')[0]); });
  await settle();
  expect(ui.getByText(/Listening/)).toBeTruthy();
  await act(async () => { fireEvent.press(ui.getByText('Stop and send')); });
  await settle();
  expect(ui.getByText(/This always outranks the spoken answer/)).toBeTruthy();
  expect(ui.getByText(/safe to drive this car home/)).toBeTruthy();
  expect(ui.getByText(/^Do not drive this car home/)).toBeTruthy();
  expect(ui.getByText(/Based on: rule:safety/)).toBeTruthy();
});

test('microphone denied, and an unverified answer is withheld', async () => {
  let ui = render(<DashVoicePanel scan={at('INSPECT_SOON')} env={ON} audio={audio(false)} />);
  await act(async () => { fireEvent.press(ui.getAllByText('Ask out loud')[0]); });
  expect(ui.getByText(/needs microphone permission/)).toBeTruthy();
  ui = render(<DashVoicePanel scan={at('INSPECT_SOON')} env={ON} audio={audio()} fetchImpl={fetchOf(200, { ...voice, answer: { text: 'guess', cites: [], status: 'unverified' } })} />);
  await act(async () => { fireEvent.press(ui.getAllByText('Ask out loud')[0]); });
  await settle();
  await act(async () => { fireEvent.press(ui.getByText('Stop and send')); });
  await settle();
  expect(ui.queryByText('guess')).toBeNull();
  expect(ui.getByText(/could not back up an answer/)).toBeTruthy();
});
