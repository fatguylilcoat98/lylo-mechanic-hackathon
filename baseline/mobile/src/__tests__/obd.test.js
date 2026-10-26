'use strict';
const test = require('node:test');
const assert = require('node:assert');
const D = require('../services/obd/decoders');
const { resolveCharacteristics, BLE_UART_PROFILES, toBase64, fromBase64 } = require('../services/obd/bleTransport');
const { AdapterSession, setLogger } = require('../services/obd/session');
const { runFullScan, clearCodes } = require('../services/obd/obdScan');
const { identifyAdapter, sortDevices } = require('../services/deviceInfo');
const { FakeTransport, makeCar } = require('./fakeAdapter');

setLogger(() => {});

test('OBDLink CX: listen on FFF1 (notify), write on FFF2', () => {
  const cx = BLE_UART_PROFILES[0];
  assert.match(cx.service, /^0000fff0-/);
  assert.match(cx.rx, /^0000fff1-/);
  assert.match(cx.tx, /^0000fff2-/);
  const chars = [
    { uuid: '0000fff1-0000-1000-8000-00805f9b34fb', isNotifiable: true },
    { uuid: '0000fff2-0000-1000-8000-00805f9b34fb', isWritableWithResponse: true, isWritableWithoutResponse: true },
  ];
  const r = resolveCharacteristics(cx, chars);
  assert.strictEqual(r.rx, '0000fff1-0000-1000-8000-00805f9b34fb');
  assert.strictEqual(r.tx, '0000fff2-0000-1000-8000-00805f9b34fb');
});

test('BLE char resolution falls back to properties if UUIDs disagree', () => {
  const p = { rx: '0000fff2-0000-1000-8000-00805f9b34fb', tx: '0000fff1-0000-1000-8000-00805f9b34fb' }; // the OLD swapped mapping
  const chars = [
    { uuid: '0000FFF1-0000-1000-8000-00805F9B34FB', isNotifiable: true },
    { uuid: '0000FFF2-0000-1000-8000-00805F9B34FB', isWritableWithoutResponse: true },
  ];
  const r = resolveCharacteristics(p, chars);
  assert.strictEqual(r.rx, '0000fff1-0000-1000-8000-00805f9b34fb');
  assert.strictEqual(r.tx, '0000fff2-0000-1000-8000-00805f9b34fb');
  assert.strictEqual(r.writeWithResponse, false);
});

test('base64 round trip', () => {
  for (const s of ['ATZ\r', '0100\r', '41 0C 1A F8\r\r>', 'x']) assert.strictEqual(fromBase64(toBase64(s)), s);
  assert.strictEqual(toBase64('ATZ\r'), Buffer.from('ATZ\r').toString('base64'));
});

test('DTC decoding: CAN single, CAN multi-frame, legacy, none', () => {
  assert.deepStrictEqual(D.decodeDTCs(['43020133D016'], '03', true), ['P0133', 'U1016']);
  assert.deepStrictEqual(D.decodeDTCs(['00A', '0:430401330420', '1:01710300000000'], '03', null), ['P0133', 'P0420', 'P0171', 'P0300']);
  assert.deepStrictEqual(D.decodeDTCs(['430133042001714300'.slice(0, 14)], '03', false), ['P0133', 'P0420', 'P0171']);
  assert.deepStrictEqual(D.decodeDTCs(['4300'], '03', null), []);
  assert.deepStrictEqual(D.decodeDTCs(['47010420'], '07', true), ['P0420']);
  assert.deepStrictEqual(D.decodeDTCs(['4A010171'], '0A', true), ['P0171']);
  assert.deepStrictEqual(D.decodeDTCs(['4A00', '4A010171'], '0A', true), ['P0171']); // two ECUs
  assert.strictEqual(D.bytesToDtc(0x41, 0x23), 'C0123');
  assert.strictEqual(D.bytesToDtc(0x81, 0x00), 'B0100');
});

test('Monitor status (0101)', () => {
  const m = D.decodeMonitorStatus(D.mode01Bytes(['4101000765A5'], '01'));
  assert.strictEqual(m.milOn, false);
  assert.strictEqual(m.engineType, 'gasoline');
  assert.deepStrictEqual(m.incomplete.sort(), ['Catalyst', 'Evaporative system (EVAP)', 'Oxygen sensor'].sort());
  const on = D.decodeMonitorStatus(D.mode01Bytes(['410182076500'], '01'));
  assert.strictEqual(on.milOn, true);
  assert.strictEqual(on.dtcCount, 2);
  assert.deepStrictEqual(on.incomplete, []);
});

test('Used-car PIDs and VIN', () => {
  assert.strictEqual(D.decodePid(['41310013'], '31'), 19);
  assert.strictEqual(D.decodePid(['414E0029'], '4E'), 41);
  assert.strictEqual(D.decodePid(['41210064'], '21'), 100);
  assert.strictEqual(D.decodePid(['413003'], '30'), 3);
  assert.strictEqual(D.decodePid(['41423714'], '42'), 14.1);
  assert.strictEqual(D.kmToMi(19), 12);
  assert.strictEqual(D.decodeVIN(['014', '0:490201314847', '1:434D3832363333', '2:41303034333532']), '1HGCM82633A004352');
  const legacy = ['490201000000' + '31', '49020248474D38', '49020332363333', '49020441303034', '49020533353200'.slice(0, 14)];
  assert.strictEqual(D.decodeVIN(['49020100000031', '49020248474D38', '49020332363333', '49020441303034', '49020533333532']).length, 17);
  const v = D.decodeVinOffline('1HGCM82633A004352');
  assert.strictEqual(v.year, 2003);
  assert.strictEqual(v.make, 'Honda');
  assert.strictEqual(D.decodeVinOffline('5YJ3E1EA7KF000000').year, 2019);
});

test('Supported-PID bitmap', () => {
  const s = D.decodeSupported(['4100BE3FA813'], '00');
  for (const p of ['01', '03', '04', '05', '06', '07', '0C', '0D', '0F', '11', '1F', '20']) assert.ok(s.has(p), p);
});

test('Device picker identifies OBDLink models and sorts them first', () => {
  assert.strictEqual(identifyAdapter('OBDLink CX').model, 'OBDLink CX');
  assert.strictEqual(identifyAdapter('OBDLink CX').preferredLink, 'ble');
  assert.strictEqual(identifyAdapter('OBDLink MX+ 12345').model, 'OBDLink MX+');
  assert.strictEqual(identifyAdapter('OBDLink LX').preferredLink, 'classic');
  assert.strictEqual(identifyAdapter('JBL Flip 5').isOBD, false);
  const sorted = sortDevices([
    { name: 'Vgate iCar', ...identifyAdapter('Vgate iCar'), rssi: -40 },
    { name: 'OBDLink CX', ...identifyAdapter('OBDLink CX'), rssi: -80 },
    { name: 'Speaker', ...identifyAdapter('Speaker'), rssi: -30 },
  ]);
  assert.deepStrictEqual(sorted.map((d) => d.name), ['OBDLink CX', 'Vgate iCar', 'Speaker']);
});

test('Full scan against simulated OBDLink adapter (CAN car, chunked BLE data)', async () => {
  const t = new FakeTransport(makeCar());
  const s = new AdapterSession(t);
  await s.open();
  const steps = [];
  const scan = await runFullScan(s, (i, n, m) => steps.push(m));
  assert.strictEqual(scan.vin, '1HGCM82633A004352');
  assert.strictEqual(scan.isCan, true);
  assert.match(scan.adapter, /STN/);
  assert.deepStrictEqual(scan.stored, []);
  assert.deepStrictEqual(scan.pending, ['P0420']);
  assert.deepStrictEqual(scan.permanent, ['P0171']);
  assert.strictEqual(scan.monitor.milOn, false);
  assert.strictEqual(scan.pids.dist_since_clear_km, 19);
  assert.strictEqual(scan.pids.time_since_clear_min, 41);
  assert.strictEqual(scan.pids.warmups_since_clear, 3);
  assert.strictEqual(scan.pids.dist_mil_on_km, 0);
  assert.strictEqual(steps.length, 8);
  assert.ok(t.sent.indexOf('0131') !== -1 && t.sent.indexOf('014E') !== -1 && t.sent.indexOf('0121') !== -1);
  assert.strictEqual(await clearCodes(s), true);
  await s.close();
});

test('Scan survives a slow first answer (CX pairing prompt)', async () => {
  const t = new FakeTransport(makeCar(), { silentFirst: 1 });
  const s = new AdapterSession(t);
  await s.open();
  const { initAdapter } = require('../services/obd/obdScan');
  const r = await initAdapter(s, { firstTimeoutMs: 200 });
  assert.match(r.adapter, /STN/);
  await s.close();
});

test('Ignition off gives a plain-English error', async () => {
  const t = new FakeTransport(makeCar({ ignitionOn: false }));
  const s = new AdapterSession(t);
  await s.open();
  await assert.rejects(runFullScan(s), /ignition ON/i);
  await s.close();
});
