'use strict';
const { HONDA } = require('./common');
const { DEMO_SCANS } = require('../../../../baseline/mobile/src/data/demoScans');
module.exports = {
  id: 'views', n: 2, title: 'Simple view vs Mechanic view', car: HONDA, scan: DEMO_SCANS.checkengine,
  short: 'Same car, same answer, two ways to read it.',
  sub: 'Same car, same answer, two ways to read it.',
  steps: [
    { t: 'Two ways to see one answer', say: 'Simple view uses everyday words. Mechanic view shows every number. Both show the same answer at the top.',
      deep: 'The pinned verdict is computed once (rules level, raised by any code or unfinished self-test); both views render under it.' },
    { t: 'Simple view', say: 'It tells you what is wrong, how worried to be, and what to do next, worst problem first.',
      deep: 'Codes sorted by severity (library urgency color), plain names, one next step each.' },
    { live: 'repair', t: 'Mechanic view', say: 'It shows the raw codes, live sensor numbers, and the snapshot the car saved when the light came on.',
      deep: 'DTCs with status (stored/pending/permanent), readiness monitors, PIDs (RPM 690, coolant 195 °F, LTFT +18.0 %, STFT +6.3 %, module 14.3 V), freeze frame.' },
    { t: 'Switch any time', say: 'Tap the switch at the top of Home to change views. The answer does not change.', deep: 'Saved on the phone under lylo.viewMode.' },
  ],
  tryIt: { label: 'Open Home and switch views', route: 'Home' },
};
