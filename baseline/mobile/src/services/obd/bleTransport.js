/*
 * LYLO Mechanic — BLE serial transport (OBDLink CX and other BLE adapters)
 *
 * OBDLink CX GATT layout, per OBDLink's own developer notes
 * (https://support.obdlink.com/support/solutions/articles/43000746707):
 *
 *   Service  0000FFF0-0000-1000-8000-00805F9B34FB  (custom UART)
 *     FFF1   Notification   -> adapter-to-phone data  (we LISTEN here)
 *     FFF2   Write / WriteNR -> phone-to-adapter data (we WRITE here)
 *
 * The previous build had these swapped (wrote to FFF1, listened on FFF2),
 * which is why the CX never answered. To be safe against other adapters
 * (and any future firmware), after matching a known service we also check
 * the characteristic *properties* reported by the device and pick the
 * notifiable one for RX and the writable one for TX.
 *
 * Pairing: the CX asks to pair when we first subscribe to FFF1 or write
 * to FFF2, and it only accepts NEW pairings during the first 5 minutes
 * after it is plugged in / powered on.
 *
 * Service discovery and the RX subscription happen ONCE per connection.
 */

'use strict';

// ── Hermes-safe Base64 (no atob/btoa in RN Hermes) ────────────────
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

function toBase64(input) {
  const str = String(input);
  let out = '';
  for (let i = 0; i < str.length; i += 3) {
    const a = str.charCodeAt(i) & 255;
    const b = i + 1 < str.length ? str.charCodeAt(i + 1) & 255 : 0;
    const c = i + 2 < str.length ? str.charCodeAt(i + 2) & 255 : 0;
    out += B64[(a >> 2) & 63];
    out += B64[((a << 4) | (b >> 4)) & 63];
    out += i + 1 < str.length ? B64[((b << 2) | (c >> 6)) & 63] : '=';
    out += i + 2 < str.length ? B64[c & 63] : '=';
  }
  return out;
}

function fromBase64(input) {
  const str = String(input || '').replace(/[^A-Za-z0-9+/]/g, '');
  let out = '';
  for (let i = 0; i < str.length; i += 4) {
    const a = B64.indexOf(str[i]);
    const b = B64.indexOf(str[i + 1]);
    const c = i + 2 < str.length ? B64.indexOf(str[i + 2]) : -1;
    const d = i + 3 < str.length ? B64.indexOf(str[i + 3]) : -1;
    if (a < 0 || b < 0) break;
    out += String.fromCharCode(((a << 2) | (b >> 4)) & 255);
    if (c !== -1) out += String.fromCharCode(((b << 4) | (c >> 2)) & 255);
    if (d !== -1) out += String.fromCharCode(((c << 6) | d) & 255);
  }
  return out;
}

const full = (short) => '0000' + short.toLowerCase() + '-0000-1000-8000-00805f9b34fb';

// Known BLE serial profiles. rx = notify (adapter -> phone), tx = write.
const BLE_UART_PROFILES = [
  {
    label: 'OBDLink CX (FFF0)',
    service: full('fff0'),
    rx: full('fff1'), // NOTIFY  — listen here
    tx: full('fff2'), // WRITE   — send commands here
  },
  {
    label: 'Generic FFE0',
    service: full('ffe0'),
    rx: full('ffe1'),
    tx: full('ffe1'), // single characteristic for write + notify
  },
  {
    label: 'vLinker 18F0',
    service: full('18f0'),
    rx: full('2af0'),
    tx: full('2af1'),
  },
  {
    label: 'Nordic UART',
    service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    rx: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
    tx: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
  },
];

const lc = (u) => String(u || '').toLowerCase();
const canWrite = (c) => !!(c && (c.isWritableWithResponse || c.isWritableWithoutResponse));
const canNotify = (c) => !!(c && (c.isNotifiable || c.isIndicatable));

/**
 * Pure helper (unit-tested): given a profile and the characteristics the
 * device actually reported for that service, decide which UUID to listen
 * on and which to write to. Prefers the documented UUIDs when their
 * properties agree; otherwise falls back to properties.
 */
function resolveCharacteristics(profile, chars) {
  const byUuid = {};
  (chars || []).forEach((c) => { byUuid[lc(c.uuid)] = c; });
  let rx = byUuid[lc(profile.rx)];
  let tx = byUuid[lc(profile.tx)];
  if (!canNotify(rx)) rx = (chars || []).find(canNotify) || null;
  if (!canWrite(tx)) tx = (chars || []).find(canWrite) || null;
  if (!rx || !tx) return null;
  return {
    rx: lc(rx.uuid),
    tx: lc(tx.uuid),
    writeWithResponse: !!tx.isWritableWithResponse,
  };
}

class BleTransport {
  constructor(bleManager, deviceId, options = {}) {
    this._mgr = bleManager;
    this._deviceId = deviceId;
    this._device = null;
    this._profile = null;
    this._sub = null;
    this._disconnectSub = null;
    this._onData = null;
    this._logger = options.logger || function () {};
    this._mtu = options.mtu || 247;
  }

  get kind() { return 'ble'; }
  get profileLabel() { return this._profile ? this._profile.label : null; }
  get deviceName() { return this._device ? this._device.name : null; }

  async connect(onData) {
    this._onData = onData;
    const log = this._logger;

    log('ble: connecting to ' + this._deviceId);
    this._device = await this._mgr.connectToDevice(this._deviceId, {
      requestMTU: this._mtu,
      timeout: 15000,
    });
    log('ble: connected, discovering services...');
    await this._device.discoverAllServicesAndCharacteristics();

    const services = await this._device.services();
    const uuids = services.map((s) => lc(s.uuid));
    log('ble: services = ' + uuids.join(', '));

    let profile = null;
    // 1. Known profile, with property check (fixes the FFF1/FFF2 swap).
    for (const p of BLE_UART_PROFILES) {
      const svc = services.find((s) => lc(s.uuid) === lc(p.service));
      if (!svc) continue;
      const chars = await svc.characteristics();
      const r = resolveCharacteristics(p, chars);
      if (r) {
        profile = { label: p.label, service: lc(svc.uuid), rx: r.rx, tx: r.tx, writeWithResponse: r.writeWithResponse };
        break;
      }
    }
    // 2. Autodetect: any non-standard service with a writable + notifiable pair.
    if (!profile) {
      log('ble: no known profile, auto-detecting...');
      for (const s of services) {
        const u = lc(s.uuid);
        if (u.startsWith('00001800') || u.startsWith('00001801') || u.startsWith('0000180a')) continue;
        const chars = await s.characteristics();
        const r = resolveCharacteristics({ rx: '', tx: '' }, chars);
        if (r) {
          profile = { label: 'Auto ' + u.slice(0, 8), service: u, rx: r.rx, tx: r.tx, writeWithResponse: r.writeWithResponse };
          break;
        }
      }
    }

    if (!profile) {
      try { await this._device.cancelConnection(); } catch (_) {}
      this._device = null;
      throw new Error('Connected, but this device has no OBD data channel. Services: ' + uuids.join(', '));
    }

    this._profile = profile;
    log('ble: using ' + profile.label + ' listen=' + profile.rx + ' write=' + profile.tx);

    this._disconnectSub = this._device.onDisconnected(() => {
      log('ble: adapter disconnected');
    });

    // Subscribe to RX (FFF1 on the CX) once. On first use this is what
    // makes Android show the "Pair with OBDLink CX?" prompt.
    this._sub = this._device.monitorCharacteristicForService(
      profile.service,
      profile.rx,
      (error, characteristic) => {
        if (error) {
          log('ble: listen error: ' + (error.message || error));
          return;
        }
        if (characteristic && characteristic.value) {
          const decoded = fromBase64(characteristic.value);
          if (this._onData) this._onData(decoded);
        }
      }
    );
    log('ble: listening for adapter data');
  }

  async write(data) {
    if (!this._device || !this._profile) throw new Error('BLE adapter not connected');
    const log = this._logger;
    const CHUNK = 20; // safe ATT payload; ELM commands are tiny anyway
    for (let i = 0; i < data.length; i += CHUNK) {
      const b64 = toBase64(data.slice(i, i + CHUNK));
      const svc = this._profile.service;
      const tx = this._profile.tx;
      if (this._profile.writeWithResponse) {
        try {
          await this._device.writeCharacteristicWithResponseForService(svc, tx, b64);
          continue;
        } catch (e) {
          log('ble: write-with-response failed (' + (e.message || e) + '), retrying without response');
        }
      }
      await this._device.writeCharacteristicWithoutResponseForService(svc, tx, b64);
    }
  }

  async disconnect() {
    if (this._sub) { try { this._sub.remove(); } catch (_) {} this._sub = null; }
    if (this._disconnectSub) { try { this._disconnectSub.remove(); } catch (_) {} this._disconnectSub = null; }
    if (this._device) { try { await this._device.cancelConnection(); } catch (_) {} this._device = null; }
    this._profile = null;
    this._onData = null;
    this._logger('ble: disconnected');
  }
}

module.exports = { BleTransport, BLE_UART_PROFILES, resolveCharacteristics, toBase64, fromBase64 };
