// Thermometer: run one Bluetooth session and log its final reading.
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import type { AppCore } from '../core/app';
import type { Result } from '../core/types';
import { Button, Outcome, styles } from './kit';
import { displayText, timeText } from './text';
import { useSnapshot } from './useSnapshot';

export function ThermometerScreen({ core, type }: { core: AppCore; type: string }) {
  const snapshot = useSnapshot(core);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const readings = snapshot.observations.filter((observation) => observation.type === type && observation.source === 'thermometer');
  const latest = readings[readings.length - 1];

  const start = async () => {
    setBusy(true);
    try {
      setResult(await core.readThermometer(type));
    } catch {
      setResult({ ok: false, error: 'thermo_no_final_reading' }); // Bluetooth itself failed
    }
    setBusy(false);
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Thermometer</Text>
      <Text style={styles.muted}>Turn on your thermometer and take your temperature.</Text>
      <Button testID="thermo-button" label={busy ? 'Waiting for thermometer…' : 'Start'} disabled={busy} onPress={start} />
      <Outcome result={result} success="Temperature saved" />
      {latest ? <Text testID="latest-temperature">{`Latest: ${displayText(latest)} · ${timeText(latest.observedAt)}`}</Text> : null}
    </View>
  );
}
