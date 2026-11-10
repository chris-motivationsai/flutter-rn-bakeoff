// Today: the observation list with sync state, the pending count, the conflict notice, sync, edit and delete.
import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { AppCore } from '../core/app';
import { findEntry } from '../core/pack';
import type { Result, SnapshotObservation } from '../core/types';
import { Button, Outcome, styles } from './kit';
import { displayText, timeText } from './text';
import { useSnapshot } from './useSnapshot';
import { ValueInput, valueFromInput } from './ValueInput';

const keyOf = (observation: SnapshotObservation) => `${observation.type}|${observation.observedAt}`;

export function TodayScreen({ core }: { core: AppCore }) {
  const snapshot = useSnapshot(core);
  const [result, setResult] = useState<Result | null>(null);
  const [editing, setEditing] = useState<{ key: string; input: string } | null>(null);
  const [syncing, setSyncing] = useState(false);

  const sync = async () => {
    setSyncing(true);
    setResult(await core.sync());
    setSyncing(false);
  };

  const saveEdit = async (observation: SnapshotObservation) => {
    const entry = findEntry(core.pack, observation.type);
    if (!entry || !editing) return;
    setResult(await core.edit(observation, valueFromInput(entry, editing.input)));
    setEditing(null);
  };

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.title}>{core.pack.appName}</Text>
      <View style={styles.row}>
        <Text testID="pending-count" style={styles.grow}>
          {snapshot.pendingMutations === 0 ? 'Everything is synced' : `${snapshot.pendingMutations} waiting to sync`}
        </Text>
        <Button testID="sync-button" label={syncing ? 'Syncing…' : 'Sync'} disabled={syncing} onPress={sync} />
      </View>
      <Outcome result={result} success="Done" />

      {snapshot.conflicts.length > 0 ? (
        <View testID="conflict-notice" style={styles.notice}>
          <Text>Changed on another device. The other version was kept for:</Text>
          {snapshot.conflicts.map((conflict, index) => (
            <Text key={index} testID="conflict-item">{`${conflict.type} · ${timeText(conflict.observedAt)}`}</Text>
          ))}
        </View>
      ) : null}

      {snapshot.observations.length === 0 ? <Text testID="empty-list" style={styles.muted}>Nothing logged yet.</Text> : null}
      {snapshot.observations.map((observation) => {
        const key = keyOf(observation);
        const entry = findEntry(core.pack, observation.type);
        return (
          <View key={key} testID={`observation-${key}`}>
            <View style={styles.row}>
              <View style={styles.grow}>
                <Text style={styles.label}>{`${observation.type} · ${displayText(observation)}`}</Text>
                <Text style={styles.muted}>{`${timeText(observation.observedAt)} · ${observation.source} · ${observation.sync}`}</Text>
              </View>
              {observation.source === 'manual' ? (
                <Button testID={`edit-${key}`} label="Edit" onPress={() => setEditing({ key, input: '' })} />
              ) : null}
              <Button testID={`delete-${key}`} label="Delete" onPress={async () => setResult(await core.delete(observation))} />
            </View>
            {editing?.key === key && entry ? (
              <View style={styles.wrap}>
                <ValueInput entry={entry} input={editing.input} onChange={(input) => setEditing({ key, input })} />
                <Button testID="save-edit" label="Save" onPress={() => saveEdit(observation)} />
              </View>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}
