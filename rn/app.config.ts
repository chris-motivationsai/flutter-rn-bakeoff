// One codebase, two apps. APP_PACK picks the stage pack (kit/packs/<id>.json); the app's name, ids and
// its whole catalog come from that file. Nothing about Polly or Premom is written in the source.
//   APP_PACK=polly npx expo start      APP_PACK=premom eas build ...
import type { ExpoConfig } from 'expo/config';
import fs from 'node:fs';
import path from 'node:path';

const packId = process.env.APP_PACK ?? 'premom';
const pack = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'kit', 'packs', `${packId}.json`), 'utf8'));
const appId = `com.example.family.${String(pack.packId).replace(/[^a-z0-9]/gi, '')}`;

const config: ExpoConfig = {
  name: pack.appName,
  slug: pack.packId,
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  ios: { supportsTablet: true, bundleIdentifier: appId },
  android: { package: appId },
  plugins: [
    'expo-sqlite',
    ['expo-build-properties', { ios: { deploymentTarget: '16.4' } }],
    ['react-native-ble-plx', { isBackgroundEnabled: false, neverForLocation: true, bluetoothAlwaysPermission: `Allow ${pack.appName} to read your thermometer` }],
    ['expo-camera', { cameraPermission: `Allow ${pack.appName} to photograph test strips` }],
  ],
  extra: {
    // As a string: Expo's config serialisation turns a null inside `extra` into {} (Polly's "numeric": null).
    packJson: JSON.stringify(pack),
    serverUrl: process.env.APP_SERVER_URL ?? 'http://127.0.0.1:8787',
    apiToken: process.env.APP_API_TOKEN ?? 'test-token',
  },
};

export default config;
