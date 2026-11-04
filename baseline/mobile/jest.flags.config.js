/* v0.7.7 (Vera condition 3): flags-on jest run.
 * babel-preset-expo inlines process.env.EXPO_PUBLIC_* at COMPILE time, so the flags must be in the environment
 * before jest transforms any file. This config file is loaded by the jest parent process before workers start,
 * so setting them here reaches every worker's transform. Own cacheDirectory so flags-off transforms are never reused.
 * Run: npx jest -c jest.flags.config.js [--no-cache] */
process.env.EXPO_PUBLIC_LYLO_SESSION_V2 = '1';
process.env.EXPO_PUBLIC_LYLO_ONE_VERDICT = '1';
const base = require('./package.json').jest;
module.exports = {
  ...base,
  displayName: 'flags-on',
  testMatch: ['<rootDir>/ui-tests/v076hotfix.test.js', '<rootDir>/ui-tests/v077codes.test.js'],
  testPathIgnorePatterns: ['/node_modules/'],
  cacheDirectory: '<rootDir>/.jest-cache-flags-on',
  setupFiles: [...(base.setupFiles || []), '<rootDir>/ui-tests/env/flagsOn.js'],
};
