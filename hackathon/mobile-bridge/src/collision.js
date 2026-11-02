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

function flagOn(v) { return String(v || '').trim() === '1'; }
function features(env) {
  let v; try { v = env ? env.EXPO_PUBLIC_LYLO_COLLISION : process.env.EXPO_PUBLIC_LYLO_COLLISION; } catch (e) { v = undefined; }
  return { on: flagOn(v) };
}

/** Build the email: { subject, body, attachments: [uri] }. photos: { stepId: [uri] }. */
function buildReport({ at, loc, photos, fields, vehicle }) {
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
  lines.push('', NOT_ADVICE);
  return { subject: `Collision report ${when.toISOString().slice(0, 10)}`, body: lines.filter((x) => x !== null).join('\n'), attachments };
}

module.exports = { NOT_ADVICE, SAFETY, PHOTO_STEPS, FIELDS, features, buildReport };
