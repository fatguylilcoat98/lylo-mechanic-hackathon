'use strict';
module.exports = {
  id: 'noadapter', n: 10, title: 'No adapter? Still works', car: '2012 Chevy Malibu (made-up demo car)',
  short: 'The light is on and you have no sensor. Here is what you can still do.',
  sub: 'The check-engine light is on and there is no sensor.',
  steps: [
    { t: 'No sensor at home', say: 'No plug-in sensor? You can still get help.', deep: 'No-adapter path: symptom questions, light color, photo, code lookup.' },
    { t: 'What is the light doing?', say: 'A steady light means "have it checked". A blinking light means "slow down and stop somewhere safe".',
      deep: 'Flashing MIL = active misfire that can overheat the catalytic converter.' },
    { t: 'Get a free code read', say: 'Many auto parts stores read codes for free. Type the code into LYLO to learn what it means.', deep: 'Lookup uses the on-phone code library (SAE J2012 meanings).' },
  ],
  tryIt: { label: 'Open No adapter help', route: 'NoAdapter' },
};
