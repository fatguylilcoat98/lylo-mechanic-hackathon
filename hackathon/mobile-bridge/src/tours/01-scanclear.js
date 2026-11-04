'use strict';
const { HONDA } = require('./common');
const { DEMO_SCANS } = require('../../../../baseline/mobile/src/data/demoScans');
module.exports = {
  id: 'scanclear', n: 1, title: 'Scan, clear, and scan again', car: HONDA, scan: DEMO_SCANS.checkengine,
  short: 'Read the codes, learn why clearing is not fixing, and scan again later.',
  sub: 'This car has a misfire code and a lean code.',
  steps: [
    { t: 'Plug in and scan', say: 'The little sensor plugs in under the steering wheel. Tap Scan and LYLO asks the car\'s computer what is wrong.',
      deep: 'Mode 03 stored, Mode 07 pending, Mode 0A permanent, Mode 01 PID 01 readiness. This car: stored P0302, P0171; pending P0302; permanent P0302; MIL on.' },
    { t: 'Read the codes', say: 'A code is like a note the car wrote: "cylinder 2 is skipping" and "too much air, not enough fuel".',
      deep: 'P0302 = cylinder 2 misfire detected. P0171 = system too lean, bank 1. LTFT +18.0 %, STFT +6.3 % at 195 °F (warm, so the trim reading counts).' },
    { t: 'Why clearing is not fixing', say: 'Clearing turns the light off, but the problem is still there. It is like erasing a note without doing what it says.',
      deep: 'Mode 04 erases stored and pending codes and resets readiness monitors and freeze frame. Permanent codes (Mode 0A) stay until the car re-tests itself. LYLO blocks clearing in demo mode and asks you to confirm on a real car.' },
    { t: 'Scan again later', say: 'After a few days of driving, scan again. If the same code comes back, the problem is real.',
      deep: 'Rescan after 2-3 drive cycles. Look for the same DTC returning (pending, then stored), monitors completing, and distance since clear (PID 31) growing.' },
  ],
  tryIt: { label: 'Scan my car', route: 'Connect', params: { then: 'scan' } },
};
