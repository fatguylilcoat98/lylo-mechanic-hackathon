/*
 * LYLO Mechanic hackathon build (Oct 26, 2026 onward).
 * Pure view-model for scan.serverDiagnosis (no React), tested in Node.
 * Returns null when there is nothing to show, so screens render nothing.
 */
'use strict';

const LEVELS = {
  EMERGENCY_STOP_IMMEDIATELY: { label: 'Stop now: emergency', tone: 'red' },
  DO_NOT_DRIVE:               { label: 'Do not drive', tone: 'red' },
  TOW_RECOMMENDED:            { label: 'Tow recommended', tone: 'red' },
  DRIVE_SHORT_DISTANCE_ONLY:  { label: 'Short trips only', tone: 'amber' },
  INSPECT_SOON:               { label: 'Get it inspected soon', tone: 'amber' },
  SAFE_TO_DRIVE:              { label: 'Safe to drive', tone: 'green' },
};

function diagnosisView(scan) {
  const d = scan && scan.serverDiagnosis;
  if (!d || typeof d !== 'object') return null;
  if (d.source === 'server') {
    const level = d.result && d.result.safety && d.result.safety.level;
    const known = LEVELS[level];
    return {
      sourceLabel: 'LYLO server (full diagnostic pipeline)',
      levelCode: level || null,
      levelLabel: known ? known.label : (level ? String(level).replace(/_/g, ' ').toLowerCase() : 'No safety level'),
      tone: known ? known.tone : 'info',
      reason: null,
    };
  }
  return {
    sourceLabel: 'On-phone engine (server not used)',
    levelCode: null,
    levelLabel: 'No server safety level',
    tone: 'info',
    reason: d.error ? String(d.error) : 'Server result unavailable.',
  };
}

module.exports = { diagnosisView, LEVELS };
