/*
 * LYLO Mechanic hackathon (v0.4.4): "Snap the dash" + "Ask out loud" on the results screen.
 * Pure CommonJS (no React Native), tested in Node.
 *
 * Flags (build time, Expo inlines the literal process.env.EXPO_PUBLIC_* reads):
 *   EXPO_PUBLIC_LYLO_DASH_PHOTO=1  shows "Snap the dash"   (server needs LYLO_HACK_VISION=1)
 *   EXPO_PUBLIC_LYLO_VOICE_ASK=1   shows "Ask out loud"    (server needs LYLO_HACK_VOICE=1)
 * Unset / anything else = the buttons are not rendered and nothing is sent (old behavior).
 * Both also need EXPO_PUBLIC_LYLO_SERVER_URL; with no server the buttons are hidden.
 *
 * Safety rule: a photo can only RAISE the level shown on the results screen, never lower it.
 * Voice answers never change the level; the safety_notice is always shown above the answer.
 */
'use strict';

const { scanToLivePayload } = require('./scanToLive');
const { LEVELS } = require('./diagnosisView');

const ORDER = ['SAFE_TO_DRIVE', 'INSPECT_SOON', 'DRIVE_SHORT_DISTANCE_ONLY', 'DO_NOT_DRIVE', 'TOW_RECOMMENDED', 'EMERGENCY_STOP_IMMEDIATELY'];
const rank = (lv) => ORDER.indexOf(lv);
// Server gunicorn --timeout is 60 s; stay under it so the phone gives the message, not a hung spinner.
const DASH_TIMEOUT_MS = 45000;
const VOICE_TIMEOUT_MS = 50000;
const SLOW_MS = 12000; // after this, the UI says "still working"
const MAX_RECORD_MS = 30000; // server cap is 60 s / 4 MB; 30 s of AAC is ~250 KB

const MSG = {
  offline: 'Could not reach the LYLO server. Your scan result above still stands.',
  timeout: 'Meta AI took too long to answer. Your scan result above still stands. Try again in a minute.',
  off: 'This feature is turned off on the LYLO server right now. Your scan result above still stands.',
  limited: 'Too many requests right now. Try again in a minute. Your scan result above still stands.',
  upstream: 'Meta AI could not answer this time. Nothing was changed. Try again in a minute.',
  bad: 'The server could not use that. Please try again.',
  cameraDenied: 'LYLO needs camera permission to take the picture. You can choose a photo from your gallery instead.',
  micDenied: 'LYLO needs microphone permission to hear your question. You can turn it on in your phone settings.',
  noCamera: 'The camera is not available in this build.',
  noMic: 'Recording is not available in this build.',
  noSpeech: 'I did not catch a question in that recording. Please try again and speak a little closer.',
  slow: 'Still working. Meta AI can take up to 30 seconds.',
};

function flagOn(v) { return String(v || '').trim() === '1'; }

/** Which buttons to show. env is for tests; the app reads the literal process.env members. */
function features(env) {
  let dash; let voice; let url;
  if (env) { dash = env.EXPO_PUBLIC_LYLO_DASH_PHOTO; voice = env.EXPO_PUBLIC_LYLO_VOICE_ASK; url = env.EXPO_PUBLIC_LYLO_SERVER_URL; } else {
    try { dash = process.env.EXPO_PUBLIC_LYLO_DASH_PHOTO; } catch (e) { dash = undefined; }
    try { voice = process.env.EXPO_PUBLIC_LYLO_VOICE_ASK; } catch (e) { voice = undefined; }
    try { url = process.env.EXPO_PUBLIC_LYLO_SERVER_URL; } catch (e) { url = undefined; }
  }
  const hasUrl = !!String(url || '').trim();
  return { dash: hasUrl && flagOn(dash), voice: hasUrl && flagOn(voice) };
}

function higher(a, b) {
  if (rank(b) < 0) return a;
  if (rank(a) < 0) return b;
  return rank(b) > rank(a) ? b : a;
}

function errorFor(status, body) {
  if (status === 503) return MSG.off;
  if (status === 429) return MSG.limited;
  if (status === 424 || status === 502 || status === 504) return MSG.upstream;
  if (status >= 400 && status < 500) return (body && body.error) ? String(body.error) : MSG.bad;
  return MSG.offline;
}

async function post({ baseUrl, path, appKey, fetchImpl, form, timeoutMs }) {
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!baseUrl || !f) return { ok: false, error: MSG.offline, offline: true };
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => { rej(new Error('timeout')); if (ctrl) ctrl.abort(); }, timeoutMs); });
  try {
    const r = await Promise.race([f(baseUrl.replace(/\/$/, '') + path, {
      method: 'POST', body: form, headers: appKey ? { 'X-LYLO-App-Key': appKey } : {}, signal: ctrl ? ctrl.signal : undefined,
    }), timeout]);
    let body = null;
    try { body = await r.json(); } catch (e) { body = null; }
    if (!r.ok || !body || typeof body !== 'object') return { ok: false, status: r.status, error: errorFor(r.status || 0, body), body };
    return { ok: true, status: r.status, body };
  } catch (e) {
    const to = e && e.message === 'timeout';
    return { ok: false, error: to ? MSG.timeout : MSG.offline, timeout: to, offline: !to };
  } finally { clearTimeout(timer); }
}

function scanField(scan, opts) {
  try { return JSON.stringify(scanToLivePayload(scan, opts || {})); } catch (e) { return null; }
}

/** POST the dash photo (with the scan so the server applies the photo floor). detective=0: one model call, fast. */
async function requestDash({ baseUrl, appKey, fetchImpl, photo, scan, timeoutMs = DASH_TIMEOUT_MS }) {
  const form = new FormData();
  form.append('photo', { uri: photo.uri, type: photo.type || 'image/jpeg', name: photo.name || 'dash.jpg' });
  const s = scan ? scanField(scan) : null;
  if (s) form.append('scan', s);
  form.append('detective', '0');
  return post({ baseUrl, path: '/api/v1/vision/dash', appKey, fetchImpl, form, timeoutMs });
}

/** POST the recorded question with the scan (+ any dash-photo evidence) so the answer cites it. */
async function requestVoice({ baseUrl, appKey, fetchImpl, audio, scan, photoEvidence, timeoutMs = VOICE_TIMEOUT_MS }) {
  const s = scanField(scan);
  if (!s) return { ok: false, error: MSG.bad };
  const form = new FormData();
  form.append('scan', s);
  if (Array.isArray(photoEvidence) && photoEvidence.length) form.append('photo_evidence', JSON.stringify(photoEvidence));
  form.append('audio', { uri: audio.uri, type: audio.type || 'audio/aac', name: audio.name || 'question.aac' });
  return post({ baseUrl, path: '/api/v1/voice/ask', appKey, fetchImpl, form, timeoutMs });
}

const label = (lv) => (LEVELS[lv] ? LEVELS[lv].label : String(lv || '').replace(/_/g, ' ').toLowerCase());

/** /vision/dash reply -> what the card shows. */
function dashView(res, currentLevel) {
  if (!res || !res.ok) return { ok: false, message: (res && res.error) || MSG.offline, findings: [], raised: false };
  const b = res.body;
  if (String(b.vision_status || '') !== 'ok') return { ok: false, message: MSG.upstream, findings: [], raised: false };
  const findings = (Array.isArray(b.photo_evidence) ? b.photo_evidence : []).map((i) => ({
    id: i.id, text: String(i.description || i.name || ''), color: i.color, confidence: i.confidence,
  }));
  const proposed = b.final_safety_level || b.photo_safety_floor || null;
  const level = higher(currentLevel, proposed);
  const raised = rank(level) > rank(currentLevel) && rank(currentLevel) >= 0;
  let message = null;
  if (b.is_vehicle_photo === false) message = 'That does not look like a dashboard. Try a clear photo of the gauges and warning lights with the engine running.';
  else if (!findings.length) message = 'Meta AI did not see any warning lights in this photo. Your scan result above still stands.';
  const rec = b.receipt || {};
  return {
    ok: true, findings, level, raised, message,
    raisedText: raised ? `The dash photo raised the safety level from "${label(currentLevel).toLowerCase()}" to "${label(level).toLowerCase()}".` : null,
    reasons: Array.isArray(b.floor_reasons) ? b.floor_reasons : [],
    photoEvidence: Array.isArray(b.photo_evidence) ? b.photo_evidence : [],
    note: 'Photo findings are lower trust than sensor data. A photo can raise the safety level, never lower it.',
    receipt: rec.model ? `${rec.model} \u00B7 ${(Number(rec.latency_ms || 0) / 1000).toFixed(1)} s \u00B7 EXIF stripped, not stored` : null,
  };
}

/** Return a new scan whose server result carries the raised level (never lower). Same object if nothing to raise. */
function applyDash(scan, view) {
  const d = scan && scan.serverDiagnosis;
  if (!view || !view.ok || !view.raised || !d || !d.result || !d.result.safety) return scan;
  const cur = d.result.safety.level;
  const next = higher(cur, view.level);
  if (next === cur) return scan;
  const safety = { ...d.result.safety, level: next, photo_raised_from: cur, photo_reasons: view.reasons };
  return { ...scan, serverDiagnosis: { ...d, result: { ...d.result, safety } } };
}

/** /voice/ask reply -> what the card shows. safety_notice always first. */
function voiceView(res) {
  if (!res || !res.ok) return { ok: false, message: (res && res.error) || MSG.offline };
  const b = res.body;
  if (b.voice_status === 'no speech recognized') return { ok: false, message: MSG.noSpeech, transcript: b.transcript || '' };
  if (String(b.voice_status || '') !== 'ok') return { ok: false, message: MSG.upstream };
  const a = b.answer || null;
  const verified = !!(a && a.text && a.status === 'verified');
  const rec = b.receipt || {};
  return {
    ok: true,
    transcript: b.transcript || b.question || '',
    safetyNotice: b.safety_notice || ('Safety level for this car: ' + label(b.final_safety_level).toLowerCase() + '. This always outranks the spoken answer.'),
    answer: verified ? a.text : null,
    withheld: !verified,
    withheldText: verified ? null : 'Meta AI could not back up an answer with your scan data, so it is not shown. Ask a mechanic or try rewording.',
    cites: verified && Array.isArray(a.cites) ? a.cites : [],
    followUps: (Array.isArray(b.follow_up_checks) ? b.follow_up_checks : []).filter((x) => x && x.text).map((x) => ({ text: x.text, cites: x.cites || [] })),
    unverified: Array.isArray(b.unverified_claims) ? b.unverified_claims.length : 0,
    receipt: rec.model ? `${rec.model} \u00B7 ${(Number(rec.latency_ms || 0) / 1000).toFixed(1)} s \u00B7 audio not stored` : null,
  };
}

/** Recording options: Android AAC in an ADTS stream (ffmpeg can read it from a pipe); iOS 16 kHz mono 16-bit WAV. */
function recordingOptions(Audio) {
  const A = (Audio && Audio.AndroidOutputFormat) || {};
  const E = (Audio && Audio.AndroidAudioEncoder) || {};
  const I = (Audio && Audio.IOSOutputFormat) || {};
  const Q = (Audio && Audio.IOSAudioQuality) || {};
  return {
    isMeteringEnabled: false,
    android: { extension: '.aac', outputFormat: A.AAC_ADTS !== undefined ? A.AAC_ADTS : 6, audioEncoder: E.AAC !== undefined ? E.AAC : 3, sampleRate: 16000, numberOfChannels: 1, bitRate: 64000 },
    ios: { extension: '.wav', outputFormat: I.LINEARPCM !== undefined ? I.LINEARPCM : 'lpcm', audioQuality: Q.HIGH !== undefined ? Q.HIGH : 96, sampleRate: 16000, numberOfChannels: 1, bitRate: 256000, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
    web: {},
  };
}

function audioFile(uri) {
  const wav = /\.wav$/i.test(String(uri || ''));
  return { uri, type: wav ? 'audio/wav' : 'audio/aac', name: wav ? 'question.wav' : 'question.aac' };
}

module.exports = { MSG, ORDER, DASH_TIMEOUT_MS, VOICE_TIMEOUT_MS, SLOW_MS, MAX_RECORD_MS, features, higher, errorFor, requestDash, requestVoice, dashView, applyDash, voiceView, recordingOptions, audioFile };
