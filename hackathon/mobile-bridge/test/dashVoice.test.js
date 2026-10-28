const test = require('node:test');
const assert = require('node:assert');
const D = require('../src/dashVoice');
const vision = require('../../server/evidence/vision_usedcar_dash.json').response;
const voice = require('../../server/evidence/voice_usedcar_question.json').response;

global.FormData = class { constructor() { this.f = []; } append(k, v) { this.f.push([k, v]); } get(k) { const x = this.f.find((e) => e[0] === k); return x ? x[1] : null; } };
const scan = { stored: [], pending: ['P0420'], permanent: ['P0171'], pids: {}, vin: null,
  serverDiagnosis: { source: 'server', result: { safety: { level: 'DRIVE_SHORT_DISTANCE_ONLY' }, detective: {} } } };
const reply = (status, body) => async (url, init) => { reply.last = { url, init }; return { ok: status < 400, status, json: async () => body }; };

test('flags: unset or no server = no buttons (old behavior)', () => {
  assert.deepStrictEqual(D.features({}), { dash: false, voice: false });
  assert.deepStrictEqual(D.features({ EXPO_PUBLIC_LYLO_DASH_PHOTO: '1', EXPO_PUBLIC_LYLO_VOICE_ASK: '1' }), { dash: false, voice: false });
  assert.deepStrictEqual(D.features({ EXPO_PUBLIC_LYLO_SERVER_URL: 'https://x', EXPO_PUBLIC_LYLO_DASH_PHOTO: '1', EXPO_PUBLIC_LYLO_VOICE_ASK: '0' }), { dash: true, voice: false });
  assert.deepStrictEqual(D.features({ EXPO_PUBLIC_LYLO_SERVER_URL: 'https://x', EXPO_PUBLIC_LYLO_VOICE_ASK: ' 1 ' }), { dash: false, voice: true });
});

test('requestDash posts photo + scan + detective=0 with app key; live evidence raises to DO_NOT_DRIVE', async () => {
  const res = await D.requestDash({ baseUrl: 'https://x/', appKey: 'k', fetchImpl: reply(200, vision), scan, photo: { uri: 'file:///d.jpg' } });
  assert.strictEqual(reply.last.url, 'https://x/api/v1/vision/dash');
  assert.strictEqual(reply.last.init.headers['X-LYLO-App-Key'], 'k');
  const f = reply.last.init.body;
  assert.strictEqual(f.get('detective'), '0');
  assert.ok(JSON.parse(f.get('scan')).raw_dtcs.length === 2);
  assert.strictEqual(f.get('photo').uri, 'file:///d.jpg');
  const v = D.dashView(res, 'DRIVE_SHORT_DISTANCE_ONLY');
  assert.ok(v.ok && v.raised && v.level === 'DO_NOT_DRIVE');
  assert.strictEqual(v.findings.length, 3);
  assert.match(v.raisedText, /raised the safety level from "drive short distance only|from ".*" to "do not drive"/i);
  const next = D.applyDash(scan, v);
  assert.strictEqual(next.serverDiagnosis.result.safety.level, 'DO_NOT_DRIVE');
  assert.strictEqual(next.serverDiagnosis.result.safety.photo_raised_from, 'DRIVE_SHORT_DISTANCE_ONLY');
  assert.strictEqual(scan.serverDiagnosis.result.safety.level, 'DRIVE_SHORT_DISTANCE_ONLY', 'input not mutated');
});

test('a photo never lowers the level', () => {
  const tow = { ...scan, serverDiagnosis: { source: 'server', result: { safety: { level: 'TOW_RECOMMENDED' } } } };
  const v = D.dashView({ ok: true, body: { ...vision, final_safety_level: 'SAFE_TO_DRIVE', photo_safety_floor: 'SAFE_TO_DRIVE' } }, 'TOW_RECOMMENDED');
  assert.strictEqual(v.level, 'TOW_RECOMMENDED'); assert.strictEqual(v.raised, false);
  assert.strictEqual(D.applyDash(tow, v), tow);
  const none = D.dashView({ ok: true, body: { vision_status: 'ok', photo_evidence: [], final_safety_level: null, is_vehicle_photo: true } }, 'INSPECT_SOON');
  assert.strictEqual(none.level, 'INSPECT_SOON'); assert.match(none.message, /did not see any warning lights/);
  const notDash = D.dashView({ ok: true, body: { vision_status: 'ok', photo_evidence: [], is_vehicle_photo: false } }, 'INSPECT_SOON');
  assert.match(notDash.message, /does not look like a dashboard/);
});

test('failures: offline, timeout, 503 off, 429, 424 upstream, 400 message; level untouched', async () => {
  const off = await D.requestDash({ baseUrl: null, scan, photo: { uri: 'x' } });
  assert.strictEqual(off.error, D.MSG.offline);
  const thrower = async () => { throw new Error('Network request failed'); };
  assert.strictEqual((await D.requestDash({ baseUrl: 'https://x', fetchImpl: thrower, scan, photo: { uri: 'x' } })).error, D.MSG.offline);
  const hang = (url, init) => new Promise((_, rej) => { init.signal.addEventListener('abort', () => rej(new Error('aborted'))); });
  const to = await D.requestDash({ baseUrl: 'https://x', fetchImpl: hang, scan, photo: { uri: 'x' }, timeoutMs: 30 });
  assert.ok(to.timeout); assert.strictEqual(to.error, D.MSG.timeout);
  for (const [st, msg] of [[503, D.MSG.off], [429, D.MSG.limited], [424, D.MSG.upstream], [502, D.MSG.upstream], [500, D.MSG.offline]]) {
    const r = await D.requestDash({ baseUrl: 'https://x', fetchImpl: reply(st, { error: 'x' }), scan, photo: { uri: 'x' } });
    assert.strictEqual(r.error, msg, String(st));
    const v = D.dashView(r, 'INSPECT_SOON');
    assert.strictEqual(v.ok, false); assert.strictEqual(D.applyDash(scan, v), scan);
  }
  const bad = await D.requestDash({ baseUrl: 'https://x', fetchImpl: reply(400, { error: 'Photo too large.' }), scan, photo: { uri: 'x' } });
  assert.strictEqual(bad.error, 'Photo too large.');
  const html = async () => ({ ok: false, status: 502, json: async () => { throw new Error('html'); } });
  assert.strictEqual((await D.requestDash({ baseUrl: 'https://x', fetchImpl: html, scan, photo: { uri: 'x' } })).error, D.MSG.upstream);
});

test('requestVoice posts scan + audio + photo evidence; live evidence -> notice, transcript, verified answer, cites', async () => {
  const res = await D.requestVoice({ baseUrl: 'https://x', appKey: 'k', fetchImpl: reply(200, voice), scan, audio: D.audioFile('file:///q.aac'), photoEvidence: vision.photo_evidence });
  assert.strictEqual(reply.last.url, 'https://x/api/v1/voice/ask');
  const f = reply.last.init.body;
  assert.deepStrictEqual(f.get('audio'), { uri: 'file:///q.aac', type: 'audio/aac', name: 'question.aac' });
  assert.strictEqual(JSON.parse(f.get('photo_evidence')).length, 3);
  const v = D.voiceView(res);
  assert.ok(v.ok);
  assert.match(v.safetyNotice, /do not drive.*outranks/i);
  assert.match(v.transcript, /safe to drive this car home/);
  assert.match(v.answer, /Do not drive this car home/);
  assert.ok(v.cites.includes('rule:safety'));
  assert.ok(v.followUps.length >= 1);
  assert.deepStrictEqual(D.audioFile('file:///q.wav'), { uri: 'file:///q.wav', type: 'audio/wav', name: 'question.wav' });
});

test('voice: unverified answer withheld, no speech, errors', () => {
  const w = D.voiceView({ ok: true, body: { ...voice, answer: { text: 'x', cites: [], status: 'unverified' } } });
  assert.strictEqual(w.answer, null); assert.ok(w.withheld); assert.match(w.withheldText, /not shown/);
  assert.match(w.safetyNotice, /outranks/);
  assert.strictEqual(D.voiceView({ ok: true, body: { voice_status: 'no speech recognized', transcript: '' } }).message, D.MSG.noSpeech);
  assert.strictEqual(D.voiceView({ ok: false, error: D.MSG.limited }).message, D.MSG.limited);
  assert.strictEqual(D.voiceView({ ok: true, body: { voice_status: 'error: 500' } }).message, D.MSG.upstream);
});

test('voice without a usable scan is not sent', async () => {
  let called = false;
  const r = await D.requestVoice({ baseUrl: 'https://x', fetchImpl: async () => { called = true; }, scan: null, audio: { uri: 'x' } });
  assert.strictEqual(called, false); assert.strictEqual(r.ok, false);
});

test('recording options: Android AAC/ADTS 16 kHz mono, iOS 16-bit WAV; under server caps', () => {
  const o = D.recordingOptions({ AndroidOutputFormat: { AAC_ADTS: 6 }, AndroidAudioEncoder: { AAC: 3 }, IOSOutputFormat: { LINEARPCM: 'lpcm' }, IOSAudioQuality: { HIGH: 96 } });
  assert.deepStrictEqual([o.android.extension, o.android.outputFormat, o.android.audioEncoder, o.android.sampleRate, o.android.numberOfChannels], ['.aac', 6, 3, 16000, 1]);
  assert.deepStrictEqual([o.ios.extension, o.ios.linearPCMBitDepth, o.ios.sampleRate], ['.wav', 16, 16000]);
  assert.ok(D.MAX_RECORD_MS <= 60000);
  assert.ok(D.DASH_TIMEOUT_MS < 60000 && D.VOICE_TIMEOUT_MS < 60000, 'client gives up before gunicorn --timeout 60');
});
