/*
 * Simulated OBDLink (STN/ELM327) adapter + car, for Node tests.
 * Mimics: echo until ATE0, spaces until ATS0, "\r\r>" prompt,
 * responses split into 20-byte chunks like BLE notifications.
 */
'use strict';

function makeCar(overrides) {
  return Object.assign({
    can: true,
    ignitionOn: true,
    answers: {
      // supported PIDs: 01-20 bitmap includes 01,04,05,06,07,0C,0D,0F,11,1F,20
      '0100': '4100BE3FA813',
      '0120': '4120A0059001',  // includes 21,30? (computed in test)
      '0140': '4140C4000000',
      '0101': '4101000765A5', // MIL off, spark, cat/evap/O2 incomplete
      '0902': ['014', '0:490201314847', '1:434D3832363333', '2:41303034333532'],
      '03': ['4300'],
      '07': ['47010420'],
      '0A': ['4A010171'],
      '0121': '41210000',
      '0130': '413003',
      '0131': '41310013',
      '014D': '414D0000',
      '014E': '414E0029',
      '0142': '41423714',
      '0105': '410564',
      '010C': '410C0B40',
      '04': '44',
    },
  }, overrides || {});
}

class FakeTransport {
  constructor(car, opts) {
    this.car = car;
    this.echo = true;
    this.spaces = true;
    this.onData = null;
    this.sent = [];
    this.silentFirst = (opts && opts.silentFirst) || 0; // drop N first writes (pairing delay)
  }
  get kind() { return 'ble'; }
  get profileLabel() { return 'FAKE'; }
  get deviceName() { return 'OBDLink CX (fake)'; }
  async connect(onData) { this.onData = onData; }
  async disconnect() { this.onData = null; }
  _emit(text) {
    // Deliver in 20-byte chunks asynchronously.
    const chunks = [];
    for (let i = 0; i < text.length; i += 20) chunks.push(text.slice(i, i + 20));
    chunks.forEach((c, i) => setTimeout(() => this.onData && this.onData(c), 2 + i));
  }
  async write(data) {
    const cmd = data.replace(/\r/g, '').trim().toUpperCase();
    this.sent.push(cmd);
    if (this.silentFirst > 0) { this.silentFirst--; return; }
    let reply;
    if (cmd === 'ATZ') { this.echo = true; this.spaces = true; reply = '\r\rELM327 v1.4b'; }
    else if (cmd === 'ATE0') { this.echo = false; reply = 'OK'; }
    else if (cmd === 'ATS0') { this.spaces = false; reply = 'OK'; }
    else if (/^AT(L0|H0|AT1|SP0)$/.test(cmd)) reply = 'OK';
    else if (cmd === 'STI') reply = 'STN2255 v5.10.3';
    else if (cmd === 'ATDPN') reply = this.car.can ? 'A6' : 'A3';
    else if (!this.car.ignitionOn && /^0/.test(cmd)) reply = 'SEARCHING...\rUNABLE TO CONNECT';
    else {
      const a = this.car.answers[cmd];
      reply = a === undefined ? 'NO DATA' : (Array.isArray(a) ? a.join('\r') : a);
      if (this.spaces && a !== undefined) reply = reply.split('\r').map((l) => l.replace(/(..)(?=.)/g, '$1 ')).join('\r');
    }
    const out = (this.echo ? cmd + '\r' : '') + reply + '\r\r>';
    this._emit(out);
  }
}

module.exports = { FakeTransport, makeCar };
