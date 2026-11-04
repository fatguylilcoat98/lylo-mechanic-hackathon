'use strict';
const { quiet } = require('./common');
module.exports = {
  id: 'crashguard', n: 5, title: 'Crash Guard', car: '2019 Subaru Outback (made-up demo car)', scan: quiet(),
  short: 'Watch a drive. A hard stop is not a crash, and LYLO knows the difference.',
  sub: 'A quick stop at a red light. This tour has no rule check, so LYLO plays it safe.',
  steps: [
    { t: 'Turn it on before you drive', say: 'Crash Guard watches how the phone moves while you drive.', deep: 'Phone motion sensors only; nothing is uploaded in this tour.' },
    { t: 'A hard stop', say: 'You stop fast at a red light. That is a big jolt, but not a crash. LYLO waits and checks.', deep: 'Synthetic: peak 0.8 g, normal motion resumes within 2 s -> false alarm.' },
    { t: 'If it looks like a crash', say: 'LYLO asks "Are you OK?" and counts down. You can cancel. It never calls anyone by itself in this tour.',
      deep: 'Crash candidate: large spike followed by no motion. Countdown with cancel. The tour never dials.' },
    { t: 'Why the answer says "check"', say: 'This tour does not run the full safety rules on the car, so LYLO plays it safe.', deep: 'No rule level in this tour -> decide() fails closed to INSPECT_SOON.' },
  ],
  tryIt: { label: 'Open Crash Guard', route: 'CrashGuard' },
};
