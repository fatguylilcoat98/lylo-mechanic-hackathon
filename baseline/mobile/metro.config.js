// Hackathon (Oct 26, 2026): let Metro bundle ../../hackathon/mobile-bridge,
// which ScanScreen imports. Otherwise the stock Expo config, unchanged.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../../hackathon/mobile-bridge')];
// Hackathon files live outside this folder, so tell Metro where react/react-native are.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
module.exports = config;
