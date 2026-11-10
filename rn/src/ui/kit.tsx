// Small shared building blocks for the screens.
import React from 'react';
import { Pressable, StyleSheet, Text, type PressableProps } from 'react-native';
import type { Result } from '../core/types';
import { errorText } from './text';

export function Button({ label, ...props }: { label: string } & PressableProps) {
  return (
    <Pressable accessibilityRole="button" style={[styles.button, props.disabled ? styles.disabled : null]} {...props}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

/** Shows the outcome of the last action: nothing yet, a success line, or the error in words. */
export function Outcome({ result, success }: { result: Result | null; success: string }) {
  if (!result) return null;
  return result.ok ? (
    <Text testID="outcome-ok" style={styles.ok}>{success}</Text>
  ) : (
    <Text testID="outcome-error" style={styles.error}>{errorText(result.error)}</Text>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '600' },
  label: { fontSize: 16, fontWeight: '500' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ccc' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grow: { flex: 1 },
  muted: { color: '#666' },
  notice: { backgroundColor: '#fff3cd', padding: 10, borderRadius: 8 },
  input: { borderWidth: 1, borderColor: '#999', borderRadius: 8, padding: 10, fontSize: 16 },
  button: { backgroundColor: '#3557c7', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  disabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontWeight: '600' },
  chip: { borderWidth: 1, borderColor: '#3557c7', borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12 },
  chipOn: { backgroundColor: '#3557c7' },
  chipTextOn: { color: '#fff' },
  ok: { color: '#17691f' },
  error: { color: '#a11' },
  tabs: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#999' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabOn: { borderTopWidth: 2, borderColor: '#3557c7' },
});
