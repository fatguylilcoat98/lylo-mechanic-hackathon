'use strict';
const MISFIRE = require('../tourData/prove_misfire_synthetic.json');
const LEAN = require('../tourData/prove_lean_fail_synthetic.json');
module.exports = {
  id: 'proof', n: 9, title: 'Locked-guess proof: one holds, one fails',
  short: 'A guess is locked before the readings come in. One guess holds, one fails, and LYLO says so.',
  parts: [
    { car: 'Demo car A (made-up, misfire replay)', body: MISFIRE, sub: 'Saved replay. The locked guess holds.' },
    { car: 'Demo car B (made-up, lean replay)', body: LEAN, sub: 'Saved replay. The locked guess fails.' },
  ],
  steps: [
    { part: 0, t: 'Make a guess first', say: 'Before looking at new readings, LYLO writes down a guess and locks it: "cylinder 3 is skipping".',
      deep: 'Locked prediction: MISFIRE_COUNT_CYL3 above 10 within 90 s (lock_sha256 5a7c2330…). In this saved replay the guess came from the safety rules; no AI was called.' },
    { part: 0, t: 'Check the guess', say: 'Then it watches the engine. Cylinder 3 skipped 17 times, so the guess was right.',
      deep: 'Deterministic checker: HELD, MISFIRE_COUNT_CYL3 = 17 at +25 s. Hash chain ok. Pending P0303.' },
    { part: 1, t: 'A second car, a second guess', say: 'A new car. The guess: "the engine is getting too much air".',
      deep: 'Locked prediction: SHORT_TERM_FUEL_TRIM_BANK_1 above 10 % within 60 s (lock_sha256 fd619c47…). Engine cold: 120 °F, trim +14 %.' },
    { part: 1, t: 'This guess fails, and that is good', say: 'As the engine warmed up, the reading went back to normal. LYLO says the guess failed instead of pretending.',
      deep: 'Checker: FAILED. Hypothesis confidence -> low: "Fuel trim settled under 10 %, so the lean reading was likely a cold-engine effect." The cold reading still keeps the answer at "check", per the cold-trim rule.' },
  ],
  tryIt: { label: 'See the proof demos', route: 'Demo' },
};
