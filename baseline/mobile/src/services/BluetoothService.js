/*
 * LYLO Mechanic — Bluetooth device discovery + connection
 *
 *  - BLE scan (OBDLink CX and other BLE adapters) via react-native-ble-plx
 *  - Classic Bluetooth (OBDLink MX+ / LX, Android only) via
 *    react-native-bluetooth-classic — lists adapters already paired in
 *    Android settings, plus an optional discovery scan.
 *
 * Native modules are required lazily so this file can't crash the app at
 * import time if a module is missing.
 */

import { PermissionsAndroid, Platform } from 'react-native';
import { identifyAdapter, sortDevices } from './deviceInfo';
import { BleTransport } from './obd/bleTransport';
import { ClassicTransport } from './obd/classicTransport';
import { AdapterSession } from './obd/session';

let _bleManager = null;
let _classic; // undefined = not tried, null = unavailable

function bleManager() {
  if (!_bleManager) {
    const { BleManager } = require('react-native-ble-plx');
    _bleManager = new BleManager();
  }
  return _bleManager;
}

function classicModule() {
  if (_classic === undefined) {
    try {
      const mod = require('react-native-bluetooth-classic');
      _classic = mod.default || mod;
    } catch (e) {
      _classic = null;
    }
  }
  return _classic;
}

const _logLines = [];
let _logListener = null;
export function log(msg) {
  const ts = new Date().toTimeString().slice(0, 8);
  const line = '[' + ts + '] ' + msg;
  _logLines.push(line);
  if (_logLines.length > 400) _logLines.shift();
  console.log('[LYLO]', msg);
  if (_logListener) { try { _logListener(line); } catch (_) {} }
}
export function getLog() { return _logLines.slice(); }
export function onLog(fn) { _logListener = fn; return () => { if (_logListener === fn) _logListener = null; }; }

export async function requestPermissions() {
  if (Platform.OS !== 'android') return { ok: true };
  const P = PermissionsAndroid.PERMISSIONS;
  const api = Platform.Version;
  const required = api >= 31 ? [P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT] : [P.ACCESS_FINE_LOCATION];
  // Location is also requested on Android 12+ because some phones only return
  // BLE scan results when it is granted. Not fatal if denied.
  const ask = api >= 31 ? required.concat([P.ACCESS_FINE_LOCATION]) : required;
  const res = await PermissionsAndroid.requestMultiple(ask);
  const ok = required.every((p) => res[p] === PermissionsAndroid.RESULTS.GRANTED);
  const locationOk = res[P.ACCESS_FINE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED;
  log('permissions: ' + JSON.stringify(res));
  return { ok, locationOk };
}

export async function isBluetoothOn() {
  try {
    const st = await bleManager().state();
    return st === 'PoweredOn';
  } catch (e) {
    return true; // unknown — don't block
  }
}

function toEntry(raw, kind) {
  const name = raw.name || raw.localName || '(no name)';
  const info = identifyAdapter(name);
  return {
    key: kind + ':' + (raw.id || raw.address),
    id: raw.id || raw.address,
    name,
    kind, // 'ble' | 'classic'
    rssi: raw.rssi || null,
    bonded: !!raw.bonded,
    ...info,
  };
}

/**
 * Scan for adapters. Calls onUpdate(list) as devices are found.
 * Returns a stop() function. Stops automatically after `seconds`.
 */
export function scan(onUpdate, { seconds = 12, includeAll = false } = {}) {
  const found = new Map();
  let stopped = false;
  const emit = () => {
    const list = Array.from(found.values()).filter((d) => includeAll || d.isOBD);
    onUpdate(sortDevices(list));
  };

  // Classic: paired (bonded) devices first — that's how MX+ / LX show up.
  const classic = Platform.OS === 'android' ? classicModule() : null;
  if (classic) {
    classic.getBondedDevices().then((devs) => {
      (devs || []).forEach((d) => {
        const e = toEntry({ ...d, bonded: true }, 'classic');
        // A paired CX is a BLE device — don't offer it as Classic.
        if (e.preferredLink === 'ble') return;
        found.set(e.key, e);
      });
      log('classic: ' + (devs || []).length + ' paired device(s)');
      emit();
    }).catch((e) => log('classic: paired list failed: ' + (e.message || e)));
  } else {
    log('classic: module unavailable');
  }

  // BLE scan.
  try {
    bleManager().startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error) { log('ble scan error: ' + (error.message || error)); return; }
      if (!device) return;
      const e = toEntry(device, 'ble');
      if (e.preferredLink === 'classic') return; // MX+/LX use Classic
      const prev = found.get(e.key);
      if (!prev || (e.name !== '(no name)' && prev.name === '(no name)')) {
        found.set(e.key, e);
        if (e.isOBD) log('ble: found ' + e.name + ' (' + e.rssi + ' dBm)');
        emit();
      }
    });
  } catch (e) {
    log('ble scan failed to start: ' + (e.message || e));
  }

  const stop = () => {
    if (stopped) return;
    stopped = true;
    try { bleManager().stopDeviceScan(); } catch (_) {}
    log('scan stopped (' + found.size + ' device(s) seen)');
  };
  setTimeout(stop, seconds * 1000);
  return stop;
}

/** Connect and open a command session. Returns an AdapterSession. */
export async function connect(device) {
  log('connecting to ' + device.name + ' via ' + device.kind);
  let transport;
  if (device.kind === 'classic') {
    const mod = classicModule();
    if (!mod) throw new Error('Classic Bluetooth is not available on this phone.');
    transport = new ClassicTransport(mod, device.id, { logger: log });
  } else {
    try { bleManager().stopDeviceScan(); } catch (_) {}
    transport = new BleTransport(bleManager(), device.id, { logger: log });
  }
  const session = new AdapterSession(transport);
  await session.open();
  return session;
}
