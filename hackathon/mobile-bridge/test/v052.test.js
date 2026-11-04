// v0.5.2: client timeout above the server Muse cap; lean wording explains positive fuel trim once.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { DEFAULT_TIMEOUT_MS } = require('../src/uploadClient');

test('client waits longer than the server Muse cap (25 s) plus VIN lookup (6 s)', () => {
  assert.strictEqual(DEFAULT_TIMEOUT_MS, 75000);
  assert.ok(DEFAULT_TIMEOUT_MS > (45 + 6 + 6 + 5) * 1000); // .env LYLO_HACK_MUSE_TIMEOUT_S=45 + VIN + recalls
  const det = fs.readFileSync(path.join(__dirname, '../../server/lylo_hack/detective.py'), 'utf8');
  const cap = Number(/LYLO_HACK_MUSE_TIMEOUT_S", "(\d+)"/.exec(det)[1]);
  assert.ok(DEFAULT_TIMEOUT_MS > (cap + 6 + 5) * 1000);
});

test('lean wording: adding fuel because it reads lean, never only "adding extra fuel"', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/resultsView.js'), 'utf8');
  assert.ok(!src.includes('"The engine is adding extra fuel.'));
  assert.match(src, /adding extra fuel because the engine reads a little lean/);
});

test('no literal \\uXXXX escapes inside JSX attribute strings', () => {
  const dir = path.join(__dirname, '../src');
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') && files.push(path.join(d, e.name))));
  walk(dir);
  for (const f of files) assert.ok(!/=\s*"[^"{}\n]*\\u[0-9A-Fa-f]{4}/.test(fs.readFileSync(f, 'utf8')), f);
});
