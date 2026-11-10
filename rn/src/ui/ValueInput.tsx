// The input for one catalog entry: a number field or a set of choices, straight from the pack.
import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { valueField, type CatalogEntry } from '../core/pack';
import { styles } from './kit';

/** Turns what the user typed/picked into the value object the core expects (not yet validated). */
export function valueFromInput(entry: CatalogEntry, input: string): Record<string, unknown> {
  const field = valueField(entry);
  if (entry.kind === 'enum') return { [field]: input };
  return { [field]: input.trim() === '' ? Number.NaN : Number(input.replace(',', '.')) };
}

export function ValueInput({ entry, input, onChange }: { entry: CatalogEntry; input: string; onChange: (input: string) => void }) {
  if (entry.kind === 'enum') {
    return (
      <View style={styles.wrap}>
        {entry.values.map((choice) => (
          <Pressable key={choice} testID={`choice-${choice}`} accessibilityRole="button" onPress={() => onChange(choice)} style={[styles.chip, input === choice ? styles.chipOn : null]}>
            <Text style={input === choice ? styles.chipTextOn : null}>{choice}</Text>
          </Pressable>
        ))}
      </View>
    );
  }
  const hint = entry.kind === 'number' ? `${entry.min} – ${entry.max}` : '';
  return <TextInput testID="value-input" style={styles.input} keyboardType="decimal-pad" placeholder={hint} value={input} onChangeText={onChange} />;
}
