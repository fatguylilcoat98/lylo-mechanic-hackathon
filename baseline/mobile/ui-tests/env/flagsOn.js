/* v0.7.7: guard for jest.flags.config.js. The flags are set before compile by the config file; this only
 * fails loudly if someone runs these tests without that config (values would already be inlined as undefined). */
['EXPO_PUBLIC_LYLO_SESSION_V2', 'EXPO_PUBLIC_LYLO_ONE_VERDICT'].forEach((k) => {
  if (process.env[k] !== '1') throw new Error(k + " must be exactly '1' before compile: run `npx jest -c jest.flags.config.js`");
});
