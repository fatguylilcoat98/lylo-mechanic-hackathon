'use strict';
/**
 * v0.7.8 EXPO_PUBLIC_LYLO_DEMO_NO_CONNECT (must equal exactly '1'; unset = old behavior).
 * In demos/tours, never show connect/pair/scan-with-adapter prompts. Live (non-demo) paths unchanged.
 */
const ADAPTER_ROUTES = ['Connect', 'Scan'];
function on(env) {
  let v;
  if (env) v = env.EXPO_PUBLIC_LYLO_DEMO_NO_CONNECT; else { try { v = process.env.EXPO_PUBLIC_LYLO_DEMO_NO_CONNECT; } catch (e) { v = undefined; } }
  return v === '1';
}
const isDemoScan = (scan) => !!(scan && scan.demoLabel);
/** Tour end button: null when it would open an adapter screen (flag on). */
function tryIt(tour, env) {
  const t = tour && tour.tryIt;
  if (!t) return null;
  return on(env) && ADAPTER_ROUTES.includes(t.route) ? null : t;
}
/** Results screens: hide adapter actions (Scan another -> Connect, Clear codes) for demo scans (flag on). */
const hideAdapterActions = (scan, env) => on(env) && isDemoScan(scan);
const NOTE = 'This is a demo using sample data. No adapter needed.';
module.exports = { on, isDemoScan, tryIt, hideAdapterActions, NOTE, ADAPTER_ROUTES };
