/*
 * LYLO Mechanic — app-level OBD service (holds the live adapter session).
 */

import * as BT from './BluetoothService';
import { setLogger } from './obd/session';
import { runFullScan, clearCodes, setScanLogger } from './obd/obdScan';

// Verbose session logs go to the in-app debug log.
setLogger((m) => BT.log('obd: ' + m));
setScanLogger((m) => BT.log('scan: ' + m));

let _session = null;
let _device = null;

const OBDService = {
  get connected() { return !!(_session && _session.ready); },
  get device() { return _device; },

  async connect(device) {
    await this.disconnect();
    _session = await BT.connect(device);
    _device = device;
    return _session;
  },

  async disconnect() {
    if (_session) {
      try { await _session.close(); } catch (_) {}
    }
    _session = null;
    _device = null;
  },

  async fullScan(onProgress) {
    if (!_session) throw new Error('Not connected to an adapter.');
    const scan = await runFullScan(_session, onProgress);
    scan.deviceName = _device ? _device.name : null;
    scan.deviceModel = _device ? _device.model : null;
    return scan;
  },

  async clearCodes() {
    if (!_session) throw new Error('Not connected to an adapter.');
    return clearCodes(_session);
  },
};

export default OBDService;
