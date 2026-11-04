'use strict';
const { HONDA } = require('./common');
const { DEMO_SCANS } = require('../../../../baseline/mobile/src/data/demoScans');
module.exports = {
  id: 'vinprice', n: 11, title: 'VIN and price links', car: HONDA, scan: DEMO_SCANS.checkengine,
  short: 'Find the car\'s ID number, then compare part prices yourself.',
  sub: 'Know the car, then compare prices.',
  steps: [
    { t: 'Find the VIN', say: 'The VIN is the car\'s ID number. It is on the dashboard by the windshield and on the registration card.', deep: 'VIN 1HGCM82633A004352: WMI 1HG (Honda, USA), model year 2003 (10th character 3).' },
    { t: 'Why the VIN helps', say: 'It tells LYLO the exact car, so parts and prices fit.', deep: 'Decoded on the phone; the recall check is a link you open yourself.' },
    { t: 'Price links', say: 'LYLO gives you links to compare part prices. You choose. LYLO never buys anything.', deep: 'Search links such as "ignition coil 2003 Honda Accord" (for P0302) on parts sites, opened only when you tap.' },
  ],
  tryIt: { label: 'Enter my VIN', route: 'Vin' },
};
