/*
 * LYLO Mechanic hackathon (v0.4.2): Photo Helper client logic (pure, testable).
 * The server (POST /api/v1/photo/helper) decides marks; this file only validates
 * again, lays marks out on the shown photo, and words things for Simple view.
 */
const DISCLAIMER = 'This is not a guarantee. It gives you an idea of where to look.';
const NOT_FOUND = "I can't see it in this photo. Try a closer picture or check your owner's manual.";
const GET_A_PRO = 'Get a pro for this one.';
const COVER = "There's a plastic cover over the engine. It usually pops off by pulling up, or has a few clips/bolts.";
const OFFLINE = "Photo Helper needs the internet. Try again when you have signal, or check your owner's manual.";

// Same list and photo instructions as the server (hackathon/server/lylo_hack/helper.py JOBS).
const JOBS = [
  { id: 'engine_air_filter', title: 'Engine air filter', icon: '\uD83C\uDF2C\uFE0F', photo: 'Open the hood and take a picture of the whole engine from the front.' },
  { id: 'cabin_air_filter', title: 'Cabin air filter', icon: '\uD83D\uDE97', photo: 'Open the glove box, empty it, and take a picture of the inside from the passenger seat.' },
  { id: 'battery', title: 'Battery check or replacement', icon: '\uD83D\uDD0B', photo: 'Open the hood and take a picture of the battery from above.' },
  { id: 'wiper_blades', title: 'Wiper blades', icon: '\uD83C\uDF27\uFE0F', photo: 'Lift one wiper arm off the windshield and take a picture where the blade meets the arm.' },
  { id: 'bulb', title: 'Headlight or taillight bulb', icon: '\uD83D\uDCA1', photo: 'Take a picture of the light that is out, from a few steps back. If you can, also open the hood or trunk behind it.' },
  { id: 'tires', title: 'Tire tread and sidewall check', icon: '\uD83D\uDEDE', photo: 'Take a picture of the driver-side front wheel, close enough to see the tread.' },
];
const PRO_JOBS = { id: 'pro', title: 'Brakes, fuel, airbags, hybrid or EV battery', icon: '\uD83D\uDED1' };
const BATTERY_WARNING = 'Battery safety: take off the negative (\u2212, black) cable first and put it back last. Never let a metal tool touch both terminals or the terminal and the car body. No sparks or flames nearby.';

const clamp = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : null; };

/** Re-validate server marks and convert to pixel circles for a photo shown at w x h. */
function layoutMarks(marks, w, h) {
  const out = [];
  for (const m of Array.isArray(marks) ? marks : []) {
    const x = clamp(m && m.x, 0, 1); const y = clamp(m && m.y, 0, 1);
    if (x === null || y === null || !m.text) continue;
    const r = Math.max(14, (clamp(m.radius, 0.02, 0.3) || 0.06) * w);
    out.push({ n: m.n, text: String(m.text), cx: x * w, cy: y * h, r,
      badgeX: Math.min(Math.max(16, x * w - r * 0.72), w - 16), badgeY: Math.min(Math.max(16, y * h - r * 0.72), h - 16) });
  }
  return out.slice(0, 6);
}

/** Server JSON (or error) -> what each view shows. Always carries the disclaimer. */
function viewModel(res, jobId) {
  const job = JOBS.find((j) => j.id === jobId) || {};
  const r = res && typeof res === 'object' ? res : {};
  const status = String(r.helper_status || 'error');
  const refused = status === 'refused';
  const found = !!r.found && !refused && Array.isArray(r.marks) && r.marks.length > 0;
  const warnings = Array.isArray(r.warnings) ? r.warnings.slice() : [];
  if (jobId === 'battery' && !warnings.some((w) => /negative/i.test(w))) warnings.unshift(BATTERY_WARNING);
  let message = null;
  const cover = status === 'engine_cover';
  if (refused) message = GET_A_PRO;
  else if (cover) message = r.message || COVER;
  else if (!found) message = status.startsWith('error') && r.offline ? OFFLINE : NOT_FOUND;
  const rec = r.receipt || {};
  const u = rec.usage || {};
  return {
    title: r.title || job.title || 'Photo Helper', found, refused, message,
    cover, marks: found || cover ? (Array.isArray(r.marks) ? r.marks : []) : [], steps: found && Array.isArray(r.steps) ? r.steps : [],
    warnings, disclaimer: DISCLAIMER, poweredBy: 'Powered by Meta AI',
    mechanic: {
      status, minConfidence: r.min_confidence, dropped: r.dropped_low_confidence || 0,
      imageQuality: r.image_quality || null, showsArea: r.shows_requested_area,
      marks: (Array.isArray(r.marks) ? r.marks : []).map((m) => ({ n: m.n, label: m.label, confidence: m.confidence, x: m.x, y: m.y, radius: m.radius, seen: m.seen })),
      receipt: rec.model ? `${rec.model} \u00B7 ${(Number(rec.latency_ms || 0) / 1000).toFixed(1)} s \u00B7 ${u.prompt_tokens || '?'} in / ${u.completion_tokens || '?'} out \u00B7 image ${rec.image_sha256_16 || ''} \u00B7 EXIF stripped, not stored` : null,
    },
  };
}

/** POST the photo. Never throws; returns server JSON or {helper_status:'error...'}. */
async function requestHelper({ baseUrl, appKey, fetchImpl, job, photo, timeoutMs = 45000 }) {
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!baseUrl || !f) return { helper_status: 'error: offline', offline: true };
  const form = new FormData();
  form.append('job', job);
  form.append('photo', { uri: photo.uri, type: photo.type || 'image/jpeg', name: photo.name || 'photo.jpg' });
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const t = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const r = await f(baseUrl.replace(/\/$/, '') + '/api/v1/photo/helper', {
      method: 'POST', body: form, headers: appKey ? { 'X-LYLO-App-Key': appKey } : {}, signal: ctrl ? ctrl.signal : undefined,
    });
    let j = null;
    try { j = await r.json(); } catch (e) { j = null; }
    if (j && typeof j === 'object' && (j.helper_status || j.found !== undefined)) return j;
    return { helper_status: `error: HTTP ${r.status}`, offline: r.status === 0, message: j && j.error };
  } catch (e) {
    return { helper_status: 'error: offline', offline: true };
  } finally { if (t) clearTimeout(t); }
}

module.exports = { COVER, JOBS, PRO_JOBS, DISCLAIMER, NOT_FOUND, GET_A_PRO, OFFLINE, BATTERY_WARNING, layoutMarks, viewModel, requestHelper };
