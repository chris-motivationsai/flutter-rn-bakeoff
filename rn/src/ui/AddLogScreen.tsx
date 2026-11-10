// Add log: a form built from the pack catalog. Only types that allow manual entry are offered.
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { AppCore } from '../core/app';
import type { Result } from '../core/types';
import { Button, Outcome, styles } from './kit';
import { ValueInput, valueFromInput } from './ValueInput';

export function AddLogScreen({ core }: { core: AppCore }) {
  const entries = core.pack.catalog.filter((entry) => entry.sources.includes('manual'));
  const [type, setType] = useState(entries[0]?.type ?? '');
  const [input, setInput] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const entry = entries.find((candidate) => candidate.type === type);

  const save = async () => {
    if (!entry) return;
    const outcome = await core.logManual(entry.type, valueFromInput(entry, input));
    setResult(outcome);
    if (outcome.ok) setInput('');
  };

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.title}>Add log</Text>
      <View style={styles.wrap}>
        {entries.map((candidate) => (
          <Pressable
            key={candidate.type}
            testID={`type-${candidate.type}`}
            accessibilityRole="button"
            style={[styles.chip, candidate.type === type ? styles.chipOn : null]}
            onPress={() => { setType(candidate.type); setInput(''); setResult(null); }}
          >
            <Text style={candidate.type === type ? styles.chipTextOn : null}>{candidate.type}</Text>
          </Pressable>
        ))}
      </View>
      {entry ? <ValueInput entry={entry} input={input} onChange={setInput} /> : <Text>Nothing can be entered by hand.</Text>}
      <Button testID="save-log" label="Save" disabled={!entry} onPress={save} />
      <Outcome result={result} success="Saved" />
    </ScrollView>
  );
}
