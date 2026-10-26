/*
 * LYLO Mechanic hackathon: remembers Simple view vs Mechanic view (results screen).
 * NEW AsyncStorage key only ('lylo.viewMode'); no existing key is read or written.
 * storage is injected (AsyncStorage in the app, a fake in tests). Never throws.
 */
'use strict';

const VIEW_MODE_KEY = 'lylo.viewMode';
const MODES = ['simple', 'mechanic'];
const MODE_LABELS = { simple: 'Simple view', mechanic: 'Mechanic view' };
const DEFAULT_MODE = 'simple';

async function loadViewMode(storage) {
  try {
    const v = storage ? await storage.getItem(VIEW_MODE_KEY) : null;
    return MODES.includes(v) ? v : DEFAULT_MODE;
  } catch (e) { return DEFAULT_MODE; }
}

async function saveViewMode(storage, mode) {
  if (!MODES.includes(mode)) return false;
  try { if (storage) await storage.setItem(VIEW_MODE_KEY, mode); return true; } catch (e) { return false; }
}

module.exports = { VIEW_MODE_KEY, MODES, MODE_LABELS, DEFAULT_MODE, loadViewMode, saveViewMode };
