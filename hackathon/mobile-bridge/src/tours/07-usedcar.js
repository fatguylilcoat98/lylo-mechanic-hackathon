'use strict';
const { ruleOf } = require('./common');
const { DEMO_SCANS } = require('../../../../baseline/mobile/src/data/demoScans');
const USED = require('../tourData/usedcar.json');
module.exports = {
  id: 'usedcar', n: 7, title: 'Used-car check', car: '2003 Honda (made-up seller car)', scan: DEMO_SCANS.usedcar, rule: ruleOf(USED),
  short: 'The light is off. Was it just cleared? Spot the trick before you buy.',
  sub: 'The light is off, but the codes were cleared 19 km ago.',
  steps: [
    { t: 'The light is off', say: 'The seller says "no lights, it is perfect". LYLO checks anyway.', deep: 'MIL off, dtcCount 0.' },
    { t: 'Codes were just cleared', say: 'The car was driven only 19 km since someone erased the codes. That is a warning sign.', deep: 'PID 31 distance since clear 19 km, 3 warm-ups, 41 min.' },
    { t: 'Tests not finished', say: 'Three self-tests have not finished, so the car cannot tell yet if they pass.', deep: 'Incomplete: Catalyst, EVAP, O2 sensor. Pending P0420; permanent P0171 survived the clear.' },
    { t: 'What to do', say: 'Ask the seller why the codes were cleared, and have a mechanic look before you buy.', deep: 'Rule level from the recorded server replay: DRIVE_SHORT_DISTANCE_ONLY.' },
  ],
  tryIt: { label: 'Start a used-car check', route: 'UsedCar' },
};
