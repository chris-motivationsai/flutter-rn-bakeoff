// Composition root for a phone build: real adapters + the core + the screens.
import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { FetchHttp } from './src/adapters/fetchHttp';
import { BlePlxThermometer } from './src/adapters/real/blePlxThermometer';
import { ExpoStripCamera } from './src/adapters/real/expoCamera';
import { openExpoSqlite } from './src/adapters/real/expoSqlite';
import { IapStore } from './src/adapters/real/iapStore';
import { nativeStripEngine } from './src/adapters/real/nativeStripEngine';
import { cryptoIds, systemClock } from './src/adapters/real/system';
import { AppCore } from './src/core/app';
import { parsePack } from './src/core/pack';
import { AppRoot } from './src/ui/AppRoot';

function createApp() {
  const extra = Constants.expoConfig?.extra ?? {};
  const pack = parsePack(JSON.parse(String(extra.packJson)));
  const camera = new ExpoStripCamera();
  const core = new AppCore({
    pack,
    db: openExpoSqlite(`${pack.packId}.db`),
    http: new FetchHttp(String(extra.serverUrl), String(extra.apiToken)),
    clock: systemClock,
    ids: cryptoIds,
    stripEngine: nativeStripEngine,
    camera,
    thermometer: new BlePlxThermometer(),
    store: new IapStore(),
  });
  return { core, CameraPreview: camera.Preview };
}

export default function App() {
  const [app] = useState(createApp);
  return (
    <>
      <AppRoot core={app.core} CameraPreview={app.CameraPreview} />
      <StatusBar style="auto" />
    </>
  );
}
