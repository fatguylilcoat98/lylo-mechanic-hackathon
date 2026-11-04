'use strict';
const PROOF = require('../tourData/proof.json');
module.exports = {
  id: 'rules', n: 8, title: 'Safety rules beat the AI', body: PROOF, car: 'Overheating demo car (made-up, coolant 260 °F)',
  short: 'A pretend AI says the car is fine. Watch the safety rules overrule it.',
  sub: 'Engine at 260 °F. The safety rules decide, not the AI.',
  steps: [
    { t: 'The engine is too hot', say: 'The engine is at 260 °F. That is far too hot, and hot engines can break badly.', deep: 'ENGINE_COOLANT_TEMP 260 °F. Rule: coolant critical -> EMERGENCY_STOP_IMMEDIATELY.' },
    { t: 'A pretend AI guesses wrong', say: 'For this test we made up an AI answer that says the car is fine. No real AI was asked.',
      deep: 'Simulated AI verdict SAFE_TO_DRIVE. Receipt: model "simulated (no model call)", latency 0 ms.' },
    { t: 'The rules win', say: 'LYLO never lets an AI make the answer less serious than the safety rules. So the answer at the top stays.',
      deep: 'merge(): final = max(rules, AI). safety_action detective_lower_ignored. Final EMERGENCY_STOP_IMMEDIATELY.' },
  ],
  tryIt: { label: 'See the proof demo', route: 'Demo' },
};
