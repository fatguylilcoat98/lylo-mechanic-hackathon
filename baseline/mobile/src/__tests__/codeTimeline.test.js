// v0.7 EXPO_PUBLIC_LYLO_CODE_TIMELINE: Mode 02 freeze frame. Synthetic adapter only. Flag off = no extra commands.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const D = require('../services/obd/decoders');
const { AdapterSession, setLogger } = require('../services/obd/session');
const { runFullScan } = require('../services/obd/obdScan');
const { FakeTransport, makeCar } = require('./fakeAdapter');
setLogger(() => {});

test('decode freeze DTC and PIDs', () => {
  assert.strictEqual(D.decodeFreezeDtc(['42020001 71']), 'P0171');
  assert.strictEqual(D.decodeFreezeDtc(['4202000000']), null);
  assert.strictEqual(D.decodeFreezeDtc(['NO DATA']), null);
  assert.strictEqual(D.decodeFreezePid(['420C001AF8'], '0C'), 1726);
  assert.strictEqual(D.decodeFreezePid(['42050086'], '05'), 201);
  assert.strictEqual(D.decodeFreezePid(['410C1AF8'], '0C'), null); // Mode 01 reply is not a freeze frame
  assert.strictEqual(D.decodeFreezePid(['42FF0001'], 'FF'), null);
});

const ff = { '020200': '4202000171', '020C00': '420C001AF8', '020500': '42050086', '020D00': '420D0050' };
async function scanWith(answers, opts) {
  const car = makeCar(); Object.assign(car.answers, answers);
  const t = new FakeTransport(car); const s = new AdapterSession(t);
  await s.open();
  const scan = await runFullScan(s, null, opts);
  await s.close();
  return { scan, sent: t.sent };
}

test('flag off: no Mode 02 commands, no freezeFrame key', async () => {
  const { scan, sent } = await scanWith(ff, { env: {} });
  assert.ok(!sent.some((c) => /^02/.test(c)));
  assert.ok(!('freezeFrame' in scan));
});

test('flag on: freeze frame read; unsupported PIDs skipped', async () => {
  const { scan } = await scanWith(ff, { env: { EXPO_PUBLIC_LYLO_CODE_TIMELINE: '1' } });
  assert.strictEqual(scan.freezeFrame.code, 'P0171');
  assert.strictEqual(scan.freezeFrame.values.rpm, 1726);
  assert.strictEqual(scan.freezeFrame.values.coolant_temp_f, 201);
  assert.strictEqual(scan.freezeFrame.values.speed_mph, 50);
  assert.ok(!('throttle' in scan.freezeFrame.values));
  assert.deepStrictEqual(scan.pending, ['P0420']);
});

test('flag on, car with no freeze frame: null, scan still completes', async () => {
  const { scan, sent } = await scanWith({}, { env: { EXPO_PUBLIC_LYLO_CODE_TIMELINE: '1' } });
  assert.strictEqual(scan.freezeFrame, null);
  assert.strictEqual(sent.filter((c) => /^02/.test(c)).length, 1);
  assert.strictEqual(scan.vin, '1HGCM82633A004352');
});
