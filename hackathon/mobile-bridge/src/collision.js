/*
 * LYLO Mechanic v0.6: after-a-collision checklist (pure CommonJS). Flag EXPO_PUBLIC_LYLO_COLLISION=1.
 * Photos stay on the phone; the report goes out through the phone's own mail app (expo-mail-composer)
 * to the user's own email, so LYLO's server never sees it. Not legal or insurance advice.
 */
'use strict';

const NOT_ADVICE = 'This checklist is general information, not legal or insurance advice. Your safety comes first. Follow police and your insurer\'s instructions.';
const SAFETY = [
  'Is anyone hurt? Call 911 now. Do not move someone who may have a neck or back injury unless they are in danger.',
  'Turn on your hazard lights.',
  'If the car can move and it is safe, move out of traffic. If not, stay buckled in or get well away from the road.',
  'If there is smoke, fire or a fuel smell, get everyone away from the car and call 911.',
  'Do not argue about who was at fault. Stick to facts.',
];
const PHOTO_STEPS = [
  { id: 'my_damage', label: 'Damage to your car (close up and from a few steps back)' },
  { id: 'other_damage', label: "Damage to the other car(s)" },
  { id: 'plates', label: 'License plates of every car involved' },
  { id: 'scene', label: 'The whole scene: where the cars ended up' },
  { id: 'license', label: "Other driver's license (ask first)" },
  { id: 'insurance', label: "Other driver's insurance card" },
  { id: 'road', label: 'Road, signs, signals, skid marks, weather' },
];
const FIELDS = [
  ['other_name', 'Other driver name'], ['other_phone', 'Other driver phone'], ['other_insurer', 'Other driver insurance company'],
  ['other_policy', 'Policy number'], ['other_vehicle', 'Other vehicle (year, make, model, color)'], ['other_plate', 'Other plate'],
  ['witnesses', 'Witnesses (names and phones)'], ['police_report', 'Police report number / officer'], ['notes', 'What happened (your notes)'],
];

// v0.7.1 (flag EXPO_PUBLIC_LYLO_COLLISION_AI=1): fixed "don't admit fault" first screen + Meta AI summary. Static text, not AI.
const FAULT_TITLE = "Don't admit fault";
const FAULT_NOTE = 'General safety guidance, not legal advice.';
const SAY = [
  'Check if anyone is hurt, and call 911 if needed.',
  'Get to safety and turn on your hazard lights.',
  'Stick to the facts: what happened, where, and when.',
  'Exchange names, phone numbers, insurance and license plates.',
  'Ask for the police report number.',
  'Get contact info from any witnesses.',
];
const DONT_SAY = [
  '"I\'m sorry" or "It was my fault."',
  "Don't guess your speed or blame anyone.",
  '"I\'m fine" or "I\'m not hurt" (injuries can show up later).',
  "Don't agree to settle privately or accept cash.",
  "Don't sign anything except a police report.",
  "Don't post about it online.",
];
const AI_LABEL = 'Written by Meta AI: check it before sending';
const AI_PHOTO_STEPS = ['my_damage', 'other_damage', 'plates', 'scene', 'road']; // never ID documents (license, insurance)
const AI_MAX_PHOTOS = 3; // keeps the upload under the server's 6 MB request cap

function flagOn(v) { return String(v || '').trim() === '1'; }
function features(env) {
  let v; try { v = env ? env.EXPO_PUBLIC_LYLO_COLLISION : process.env.EXPO_PUBLIC_LYLO_COLLISION; } catch (e) { v = undefined; }
  let a; try { a = env ? env.EXPO_PUBLIC_LYLO_COLLISION_AI : process.env.EXPO_PUBLIC_LYLO_COLLISION_AI; } catch (e) { a = undefined; }
  return { on: flagOn(v), ai: flagOn(v) && flagOn(a) };
}

// Vera C2: other driver's name/phone/policy/plate never leave the phone; Meta AI only learns whether they were given.
const PRESENCE_ONLY = ['other_name', 'other_phone', 'other_policy', 'other_plate'];
function answersForAi(fields) {
  const a = {};
  FIELDS.forEach(([k]) => {
    const v = String((fields || {})[k] || '').trim().slice(0, 500);
    a[k] = PRESENCE_ONLY.indexOf(k) !== -1 ? (v ? 'provided' : 'not provided') : v;
  });
  return a;
}

/** First photo of each allowed step, up to AI_MAX_PHOTOS. */
function aiPhotos(photos) {
  const out = [];
  for (const id of AI_PHOTO_STEPS) { const u = ((photos || {})[id] || [])[0]; if (u && out.length < AI_MAX_PHOTOS) out.push({ id, uri: u }); }
  return out;
}

/** POST /api/v1/collision/summary. Never throws: returns { ok, ai?, error? }. Offline = { ok:false }. */
async function requestSummary({ baseUrl, appKey, fetchImpl, photos, fields, timeoutMs = 45000 }) {
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!f || !baseUrl) return { ok: false, error: 'No connection to LYLO. Your report still works without the AI part.' };
  try {
    const form = new FormData();
    const list = aiPhotos(photos);
    list.forEach((p, i) => form.append('photo', { uri: p.uri, type: 'image/jpeg', name: 'p' + i + '.jpg' }));
    form.append('labels', JSON.stringify(list.map((p) => p.id)));
    form.append('have', JSON.stringify(Object.keys(photos || {}).filter((k) => ((photos || {})[k] || []).length)));
    const a = answersForAi(fields);
    form.append('answers', JSON.stringify(a));
    const r = await Promise.race([
      f(baseUrl.replace(/\/$/, '') + '/api/v1/collision/summary', { method: 'POST', headers: { 'X-LYLO-App-Key': appKey || '' }, body: form }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
    ]);
    const b = await r.json().catch(() => ({}));
    if (r.ok && b.collision_ai_status === 'ok') return { ok: true, ai: { label: AI_LABEL, photos: b.photos || [], summary: b.summary || '', missing: b.missing || [] } };
    return { ok: false, error: 'Meta AI could not write a summary right now. Your report still works without it.', missing: b.missing || [] };
  } catch (e) {
    return { ok: false, error: 'No connection to Meta AI. Your report still works without the AI part.' };
  }
}

function aiSection(ai) {
  if (!ai) return [];
  const l = ['', '--- ' + AI_LABEL + ' ---'];
  (ai.photos || []).forEach((p) => l.push(`Photo ${p.photo} (${p.label}): ${p.damage}`));
  l.push('Summary: ' + (ai.summary || 'not provided'));
  if ((ai.missing || []).length) { l.push('Missing:'); ai.missing.forEach((m) => l.push('- ' + m)); }
  l.push('--- end of Meta AI section ---');
  return l;
}

/** Build the email: { subject, body, attachments: [uri] }. photos: { stepId: [uri] }. */
function buildReport({ at, loc, photos, fields, vehicle, ai }) {
  const when = new Date(at || Date.now());
  const f = fields || {};
  const ph = photos || {};
  const where = loc && Number.isFinite(loc.lat) ? `${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)} (https://maps.google.com/?q=${loc.lat.toFixed(5)},${loc.lon.toFixed(5)})` : 'not available';
  const lines = [
    'Collision report from LYLO Mechanic', '',
    `Date and time: ${when.toLocaleString('en-US', { timeZoneName: 'short' })} (${when.toISOString()})`,
    `Location (phone GPS): ${where}`,
    vehicle ? `My vehicle: ${vehicle}` : null, '',
  ];
  FIELDS.forEach(([k, label]) => { const v = String(f[k] || '').trim(); lines.push(`${label}: ${v || '(not entered)'}`); });
  lines.push('', 'Photos attached:');
  const attachments = [];
  PHOTO_STEPS.forEach((s) => {
    const list = (ph[s.id] || []).filter(Boolean);
    lines.push(`- ${s.label}: ${list.length}`);
    list.forEach((u) => attachments.push(u));
  });
  aiSection(ai).forEach((x) => lines.push(x)); // only when the user kept it
  lines.push('', NOT_ADVICE);
  return { subject: `Collision report ${when.toISOString().slice(0, 10)}`, body: lines.filter((x) => x !== null).join('\n'), attachments };
}

module.exports = { NOT_ADVICE, SAFETY, PHOTO_STEPS, FIELDS, features, buildReport, FAULT_TITLE, FAULT_NOTE, SAY, DONT_SAY, AI_LABEL, AI_MAX_PHOTOS, aiPhotos, requestSummary, aiSection, answersForAi, PRESENCE_ONLY };
