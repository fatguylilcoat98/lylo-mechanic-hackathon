// v0.5.1: V10 misfire support (Mode 06 cylinders 9/10). Synthetic bytes only.
const test = require('node:test');
const assert = require('node:assert');
const M = require('../src/mode06');

test('mode06: cylinders 9 and 10 (MIDs AA/AB) decode on a V10', () => {
  const rec = (mid, v) => [mid, 0x0b, 0x24, v >> 8, v & 255, 0, 0, 0xff, 0xff];
  const bytes = [0x46, ...rec(0xa2, 0), ...rec(0xaa, 3), ...rec(0xab, 41), ...rec(0xa9, 0)];
  const r = M.decodeMisfire(bytes);
  assert.strictEqual(r.supported, true);
  assert.deepStrictEqual(r.misfire_counts, { 1: 0, 8: 0, 9: 3, 10: 41 });
  assert.strictEqual(M.midFor(9), 0xaa);
  assert.strictEqual(M.midFor(10), 0xab);
  assert.strictEqual(M.midFor(13), null);
});

test('mode06: other TIDs, out-of-range MIDs and junk are ignored; nothing = not supported', () => {
  assert.deepStrictEqual(M.decodeMisfire([0x46, 0xab, 0x0c, 0x24, 0, 9, 0, 0, 0, 0]).supported, false);
  assert.deepStrictEqual(M.decodeMisfire([0x46, 0xae, 0x0b, 0x24, 0, 9, 0, 0, 0, 0]).supported, false);
  assert.deepStrictEqual(M.decodeMisfire('NO DATA').supported, false);
  assert.deepStrictEqual(M.decodeMisfire([0x46, 0xab, 0x0c, 0x24, 0, 9, 0, 0, 0, 0], { tid: 0x0c }).misfire_counts, { 10: 9 });
});
