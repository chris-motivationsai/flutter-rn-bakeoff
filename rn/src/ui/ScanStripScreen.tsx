// Scan strip: take a photo, run it through the engine, show the level (and the number when unlocked).
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import type { AppCore } from '../core/app';
import type { Result } from '../core/types';
import { Button, Outcome, styles } from './kit';
import { displayText } from './text';
import { useSnapshot } from './useSnapshot';

export function ScanStripScreen({ core, type, CameraPreview }: { core: AppCore; type: string; CameraPreview?: React.ComponentType }) {
  const snapshot = useSnapshot(core);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const strips = snapshot.observations.filter((observation) => observation.type === type);
  const latest = strips[strips.length - 1];

  const scan = async () => {
    setBusy(true);
    try {
      setResult(await core.scanStrip(type));
    } catch {
      setResult({ ok: false, error: 'strip_bad_input' }); // the camera itself failed
    }
    setBusy(false);
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Scan strip</Text>
      {CameraPreview ? <CameraPreview /> : null}
      <Button testID="scan-button" label={busy ? 'Reading…' : 'Scan'} disabled={busy} onPress={scan} />
      <Outcome result={result} success="Strip read" />
      {latest ? <Text testID="latest-strip">{`Latest: ${displayText(latest)}`}</Text> : <Text style={styles.muted}>No strip results yet.</Text>}
    </View>
  );
}
