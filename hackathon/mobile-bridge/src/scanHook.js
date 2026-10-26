/*
 * LYLO Mechanic hackathon build (Oct 26, 2026 onward).
 * Hook called by the baseline ScanScreen after a scan finishes.
 * Flag: EXPO_PUBLIC_LYLO_SERVER_URL. Unset/empty = returns the scan object
 * untouched (exact pre-hackathon on-phone behavior, no network call).
 * Set = sends the scan to <url>/api/v1/live/live and attaches the outcome as
 * scan.serverDiagnosis = { source: 'server'|'offline', result, error?, status? }.
 * Never throws: any failure leaves the scan usable by the baseline screens.
 */
'use strict';

const { diagnoseScan } = require('./uploadClient');

function configuredUrl(env) {
  // Literal process.env.EXPO_PUBLIC_... access is required: Expo's Babel
  // preset only inlines that exact member expression into the app bundle.
  let raw;
  if (env) raw = env.EXPO_PUBLIC_LYLO_SERVER_URL;
  else { try { raw = process.env.EXPO_PUBLIC_LYLO_SERVER_URL; } catch (e) { raw = undefined; } }
  const v = String(raw || '').trim();
  return v || null;
}

async function afterScan(scan, opts = {}) {
  const baseUrl = opts.baseUrl !== undefined ? opts.baseUrl : configuredUrl(opts.env);
  if (!baseUrl || !scan) return scan;
  try {
    const out = await diagnoseScan(scan, { ...opts, baseUrl });
    return { ...scan, serverDiagnosis: { source: out.source, result: out.result, error: out.error, status: out.status } };
  } catch (e) {
    return { ...scan, serverDiagnosis: { source: 'offline', result: null, error: 'hook error: ' + (e && e.message) } };
  }
}

module.exports = { afterScan, configuredUrl };
