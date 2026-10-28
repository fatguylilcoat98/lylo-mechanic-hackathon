/*
 * LYLO Mechanic UI v2 design tokens (flag EXPO_PUBLIC_LYLO_UI_V2=1).
 * Dark, high-contrast automotive look. ONE accent (electric blue) for actions.
 * Red / amber / green are RESERVED for safety level and evidence status, never decoration.
 * Pure CommonJS so Node tests can check WCAG contrast of every text/background pair.
 */
'use strict';

const color = {
  bg: '#0B0E12',          // near-black dash
  surface: '#141A21',     // cards
  surfaceHi: '#1C242E',   // pressed / nested
  line: '#2A3542',        // hairlines
  text: '#F2F5F8',        // primary text
  textDim: '#B4C0CC',     // secondary text (still >= 7:1 on bg)
  accent: '#3DA9FF',      // the one accent: primary actions, links
  onAccent: '#04121F',
  // status (safety + evidence only)
  red: '#FF5A52', redFill: '#B3121F', onRed: '#FFFFFF',
  amber: '#FFB020', amberFill: '#FFB020', onAmber: '#1A1000',
  green: '#2BD47D', greenFill: '#2BD47D', onGreen: '#03170C',
  replay: '#C9A6FF',      // replay/demo badge (not a status color)
};

const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
const radius = { sm: 8, md: 14, lg: 20, pill: 999 };
const type = {
  hero: { fontSize: 34, lineHeight: 40, fontWeight: '900' },
  title: { fontSize: 26, lineHeight: 32, fontWeight: '800' },
  h: { fontSize: 20, lineHeight: 26, fontWeight: '800' },
  body: { fontSize: 18, lineHeight: 26, fontWeight: '500' },
  small: { fontSize: 15, lineHeight: 21, fontWeight: '500' },
  label: { fontSize: 13, lineHeight: 16, fontWeight: '800', letterSpacing: 1 },
};
const touch = { min: 56 }; // >= 48dp Android guideline, bigger for in-car use

/* Evidence vocabulary: the Evidence Ledger, in three words. */
const EVIDENCE = {
  car: { label: 'From your car', icon: '\u25CF', fg: color.green, testID: 'evidence-car' },
  guess: { label: "AI's guess", icon: '\u25D0', fg: color.amber, testID: 'evidence-guess' },
  unknown: { label: 'Unknown', icon: '\u25CB', fg: color.textDim, testID: 'evidence-unknown' },
};
const CAR_TYPES = new Set(['dtc', 'pid', 'codes_cleared_counter', 'readiness_monitor', 'codes_cleared', 'codes_cleared_evidence', 'freeze_frame', 'vehicle', 'rule_safety']);

/** Ledger item (or null when a cited id is missing) -> 'car' | 'guess' | 'unknown'. */
function evidenceKind(item) {
  if (!item || typeof item !== 'object') return 'unknown';
  if (item.source === 'photo' || item.source === 'user' || item.type === 'rule_hypothesis') return 'guess';
  if (CAR_TYPES.has(item.type) || String(item.id || '').startsWith('pid:') || String(item.id || '').startsWith('mon:') || String(item.id || '').startsWith('dtc:')) return 'car';
  return 'unknown';
}

/** Safety tone -> fill/foreground. */
const TONE = {
  green: { bg: color.greenFill, fg: color.onGreen },
  yellow: { bg: color.amberFill, fg: color.onAmber },
  orange: { bg: color.amberFill, fg: color.onAmber },
  red: { bg: color.redFill, fg: color.onRed },
};

function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrast(a, b) { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }

/** Every text-on-background pair the v2 UI uses. Tests assert each is >= 4.5 (WCAG AA). */
const PAIRS = [
  ['text', 'bg'], ['textDim', 'bg'], ['text', 'surface'], ['textDim', 'surface'], ['accent', 'bg'], ['accent', 'surface'],
  ['onAccent', 'accent'], ['red', 'bg'], ['red', 'surface'], ['amber', 'surface'], ['green', 'surface'], ['onRed', 'redFill'],
  ['onAmber', 'amberFill'], ['onGreen', 'greenFill'], ['replay', 'bg'], ['textDim', 'surfaceHi'], ['text', 'surfaceHi'],
];

function uiV2On(env) {
  let on;
  if (env) on = env.EXPO_PUBLIC_LYLO_UI_V2; else { try { on = process.env.EXPO_PUBLIC_LYLO_UI_V2; } catch (e) { on = undefined; } }
  return String(on || '').trim() === '1';
}

module.exports = { color, space, radius, type, touch, EVIDENCE, TONE, evidenceKind, contrast, PAIRS, uiV2On };
