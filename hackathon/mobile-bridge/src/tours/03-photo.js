'use strict';
module.exports = {
  id: 'photo', n: 3, title: 'Take a photo and circle a spot', car: '2014 Toyota Camry (made-up demo car)',
  short: 'See a drip or a worn tire? Snap it and circle it. No sensor needed.',
  sub: 'A green drip under the front. No scan, so LYLO plays it safe.',
  steps: [
    { t: 'Take a photo', say: 'See something odd, like a drip or a worn tire? Take a picture of it.', deep: 'Photo Helper opens the camera or the gallery. In this tour no photo is taken or sent.' },
    { t: 'Circle the spot', say: 'Draw a circle with your finger around the part you are worried about.', deep: 'The circle is kept as a region on the image so the answer can focus on that area.' },
    { t: 'Say what you see', say: 'Tell LYLO in your own words, like "green drip under the front".', deep: 'Color helps: green/orange = coolant, red = transmission or power steering, brown/black = oil, clear = water from the A/C (normal).' },
    { t: 'What it means', say: 'A green drip is often coolant. Coolant keeps the engine from getting too hot, so have it looked at.',
      deep: 'No scan means no rule level, so the verdict fails closed. Check the coolant level with the engine cold; watch the temperature gauge.' },
  ],
  tryIt: { label: 'Open Photo Helper', route: 'PhotoHelper' },
};
