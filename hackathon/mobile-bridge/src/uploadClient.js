/*
 * LYLO Mechanic hackathon build: send a scan to the Dell server's
 * /api/v1/live/live, with a hard client timeout and an offline fallback to
 * the existing on-phone engine (baseline analyzeCodes) when the server is
 * unreachable, slow, or rejects the payload.
 */
'use strict';

const { scanToLivePayload } = require('./scanToLive');

const DEFAULT_TIMEOUT_MS = 20000; // the baseline Layer-12 call alone could take 10 s+

function defaultOfflineEngine() {
  // Pre-existing offline engine (baseline, unchanged).
  return require('../../../baseline/mobile/src/engine/diagnose').analyzeCodes;
}

/**
 * @param scan runFullScan() output
 * @param opts.baseUrl e.g. "https://<dell-tunnel-host>" (no trailing slash)
 * @param opts.appKey sent as X-LYLO-App-Key (build-time value; extractable from the APK, so it is a speed bump, not a secret)
 * @param opts.fetchImpl fetch implementation (global fetch by default)
 * @param opts.timeoutMs client timeout
 * @param opts.offlineEngine (scan) => result, defaults to baseline analyzeCodes
 * @returns {source:'server'|'offline', result, payload, error?, status?}
 */
async function diagnoseScan(scan, opts = {}) {
  const payload = scanToLivePayload(scan, opts);
  const offline = opts.offlineEngine || defaultOfflineEngine();
  const fallback = (error, status) => ({ source: 'offline', result: offline(scan), payload, error, status });
  const fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!opts.baseUrl || !fetchImpl) return fallback('No server configured; used the on-phone engine.');

  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => { if (ctrl) ctrl.abort(); rej(new Error('timeout')); }, timeoutMs);
  });
  try {
    const res = await Promise.race([
      fetchImpl(opts.baseUrl.replace(/\/$/, '') + '/api/v1/live/live', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, opts.appKey ? { 'X-LYLO-App-Key': opts.appKey } : {}),
        body: JSON.stringify(payload),
        signal: ctrl ? ctrl.signal : undefined,
      }),
      timeout,
    ]);
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    if (!res.ok) {
      const detail = body && body.errors && body.errors.length ? ': ' + body.errors.join(' ') : '';
      // 401 (key), 413, 429 (rate limit), 5xx: all fall back to the on-phone engine.
      return fallback(`Server said ${res.status}${detail}`, res.status);
    }
    if (!body || !body.safety || !body.safety.level) return fallback('Server reply had no safety level.', res.status);
    return { source: 'server', result: body, payload, status: res.status };
  } catch (e) {
    return fallback(e && e.message === 'timeout' ? `Server took longer than ${timeoutMs} ms.` : 'Server unreachable: ' + (e && e.message));
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { diagnoseScan, DEFAULT_TIMEOUT_MS };
