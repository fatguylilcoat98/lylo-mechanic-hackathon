'use strict';
const { HONDA } = require('./common');
const { DEMO_SCANS } = require('../../../../baseline/mobile/src/data/demoScans');
module.exports = {
  id: 'timeline', n: 6, title: 'Code timeline', car: HONDA, scan: DEMO_SCANS.checkengine,
  short: 'When did each code first show up, and did it come back?',
  sub: 'When did each code show up?',
  steps: [
    { t: 'Codes have a history', say: 'LYLO remembers each scan, so you can see when a code first showed up and if it came back.', deep: 'Scans are saved on the phone (codeTimeline). Demo scans are never saved.' },
    { t: 'Pending, then stored', say: 'A "pending" code is a maybe. If it happens again, it becomes "stored", which means it is for sure.',
      deep: 'P0302: pending -> stored after the second failed drive cycle. Freeze frame captured when it was first stored.' },
    { t: 'Permanent codes', say: 'Some codes stay even after clearing, until the car tests itself again.', deep: 'Mode 0A permanent P0302: only the engine computer clears it, after a passing monitor run.' },
  ],
  tryIt: { label: 'Look up a code', route: 'Lookup' },
};
