'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../src/showMe');
const C = require('../src/collision');

test('flags off by default', () => {
  assert.deepStrictEqual(S.features({}), { home: false, showMe: false });
  assert.strictEqual(C.features({}).on, false);
});
test('causes sorted and labeled as guesses', () => {
  const c = S.causesFrom({ hypotheses: [{ cause: 'x', confidence: 'low' }, { cause: 'faulty mass air flow sensor', confidence: 'medium' }] });
  assert.strictEqual(c[0].confidence, 'medium'); assert.match(c[0].label, /^Guess/);
});
test('follow-up answer appended in owner words, capped', () => {
  const t = S.appendAnswer('rough idle', 'Does it happen when cold?', 'yes');
  assert.match(t, /Asked: "Does it happen when cold\?" Owner answered: yes/);
  assert.ok(S.appendAnswer('x'.repeat(2000), 'q', 'no').length <= 1000);
  assert.strictEqual(S.followUps({ followUps: ['a', 'b', 'c', 'd'] }).length, 3);
});
test('fix-it: part named -> links + DIY hint; vague cause -> diagnose search only', () => {
  const f = S.fixIt([{ cause: 'clogged air filter', label: 'Guess (medium confidence)' }], { year: 2012, make: 'Honda', model: 'Civic' });
  assert.strictEqual(f.part, 'air filter'); assert.ok(f.links.buttons.length); assert.match(f.diy, /do-it-yourself/);
  const g = S.fixIt([{ cause: 'vacuum leak', label: 'Guess' }], null);
  assert.strictEqual(g.part, null); assert.strictEqual(g.links, null); assert.match(g.watchUrl, /youtube/);
  assert.strictEqual(S.fixIt([], null), null);
});
test('collision report: fields, photo counts, attachments, GPS, not-advice', () => {
  const r = C.buildReport({ at: Date.UTC(2026, 10, 2, 20), loc: { lat: 38.1, lon: -121.2 }, photos: { plates: ['file:///a.jpg', 'file:///b.jpg'] }, fields: { police_report: '123' } });
  assert.deepStrictEqual(r.attachments, ['file:///a.jpg', 'file:///b.jpg']);
  assert.match(r.body, /Police report number \/ officer: 123/); assert.match(r.body, /License plates of every car involved: 2/);
  assert.match(r.body, /38\.10000, -121\.20000/); assert.match(r.body, /not legal or insurance advice/);
  assert.match(r.subject, /2026-11-02/);
});
