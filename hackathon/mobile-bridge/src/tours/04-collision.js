'use strict';
module.exports = {
  id: 'collision', n: 4, title: 'I was in a collision', car: '2018 Ford F-150 (made-up demo car)',
  short: 'What to do after a bump: safety first, a walk-around, photos, and a summary.',
  sub: 'A small bump in a parking lot. No scan, so LYLO plays it safe.',
  steps: [
    { t: 'Safe first', say: 'Is anyone hurt? If yes, call 911 first. Turn on your hazard lights.', deep: 'The 911 button is above the fold. Move out of traffic only if it is safe.' },
    { t: 'Look at the car', say: 'Walk around it. Look for leaks, smoke, broken lights, or a bent wheel. If you see smoke or a leak, leave it parked and call for help.',
      deep: 'Checklist: fluid under the car, coolant smell, tire and wheel damage, lights, airbag (SRS) light, steering pull.' },
    { t: 'Take photos', say: 'Take pictures of both cars, the license plates, and the street.', deep: 'Photos stay on the phone, tagged with the time.' },
    { t: 'Get a summary', say: 'LYLO puts it all on one page you can show the insurance company.', deep: 'Summary: time, checklist answers, photo list, optional scan codes (B/C/U codes for body, chassis, network).' },
  ],
  tryIt: { label: 'Open the collision checklist', route: 'Collision' },
};
