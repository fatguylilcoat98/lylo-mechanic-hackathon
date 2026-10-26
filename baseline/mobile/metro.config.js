// Hackathon (Oct 26, 2026): let Metro bundle ../../hackathon/mobile-bridge,
// which ScanScreen imports. Otherwise the stock Expo config, unchanged.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../../hackathon/mobile-bridge')];
module.exports = config;
