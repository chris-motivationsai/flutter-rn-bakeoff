// Push pending mutations, then pull. SPEC section 4.
import type { Api } from './api';
import { MAX_MUTATIONS_PER_PUSH, type Mutation, type MutationResult, type ObservationBody, type ServerObservation } from './contracts';
import type { IdSource } from './ports';
import type { Storage } from './storage';
import type { PendingMutation, StoredObservation } from './types';

export type SyncOutcome = 'ok' | 'network';

const bodyOf = (obs: StoredObservation | ServerObservation): ObservationBody => ({
  type: obs.type,
  value: obs.value,
  observedAt: obs.observedAt,
  source: obs.source,
  ...(obs.reader && Object.keys(obs.reader).length ? { reader: obs.reader } : {}),
});

function toWire(storage: Storage, pending: PendingMutation): Mutation | null {
  const obs = storage.getObservation(pending.observationId);
  if (!obs) return null;
  const common = { mutationId: pending.mutationId, id: obs.id, baseRevision: obs.baseRevision };
  return pending.op === 'delete' ? { ...common, op: 'delete' } : { ...common, op: 'upsert', observation: bodyOf(obs) };
}

function storeServerCopy(storage: Storage, server: ServerObservation): void {
  if (server.deleted) storage.removeObservation(server.id);
  else storage.putObservation({ ...bodyOf(server), id: server.id, baseRevision: server.revision, deleted: false });
}

function applyResult(storage: Storage, ids: IdSource, sent: PendingMutation, result: MutationResult): void {
  if (result.status === 'applied' || result.status === 'duplicate') {
    if (sent.op === 'delete') storage.removeObservation(sent.observationId);
    else if (result.revision !== undefined) storage.setBaseRevision(sent.observationId, result.revision);
    storage.removePendingByMutation(sent.mutationId);
    // The user deleted this observation while its create was in doubt (see AppCore.delete): now that the
    // server has confirmed the create, the delete can follow with the right base revision.
    if (sent.op === 'upsert' && storage.getObservation(sent.observationId)?.deleted) {
      storage.replacePending(sent.observationId, ids.uuid(), 'delete');
    }
  } else if (result.status === 'conflict') {
    // The server copy wins; the local change is lost and the loss is recorded.
    const local = storage.getObservation(sent.observationId);
    const lost = local ?? result.server;
    if (result.server) storeServerCopy(storage, result.server);
    storage.removePendingByMutation(sent.mutationId);
    if (lost) storage.addConflict({ type: lost.type, observedAt: lost.observedAt });
  } else {
    // 'rejected': the server will never take this mutation, so retrying forever would block nothing but
    // also achieve nothing. Drop it; a rejected delete also drops the local tombstone.
    if (sent.op === 'delete') storage.removeObservation(sent.observationId);
    storage.removePendingByMutation(sent.mutationId);
  }
}

/** Step 2: push, oldest first, at most MAX_MUTATIONS_PER_PUSH per request. Never sends an empty push. */
export async function pushPending(storage: Storage, api: Api, ids: IdSource, deviceId: string): Promise<SyncOutcome> {
  if ((await pushQueue(storage, api, ids, deviceId, storage.allPending())) === 'network') return 'network';
  // Deletes that had to wait for their create to be confirmed (rare) go out in the same sync.
  const followUps = storage.allPending().filter((pending) => !pending.attempted);
  return pushQueue(storage, api, ids, deviceId, followUps);
}

async function pushQueue(storage: Storage, api: Api, ids: IdSource, deviceId: string, queue: PendingMutation[]): Promise<SyncOutcome> {
  for (let start = 0; start < queue.length; start += MAX_MUTATIONS_PER_PUSH) {
    const chunk = queue.slice(start, start + MAX_MUTATIONS_PER_PUSH);
    const wire: Mutation[] = [];
    const sent = new Map<string, PendingMutation>();
    storage.transaction(() => {
      for (const pending of chunk) {
        const mutation = toWire(storage, pending);
        if (!mutation) { storage.removePendingByMutation(pending.mutationId); continue; }
        storage.setAttempted(pending.mutationId, true);
        wire.push(mutation);
        sent.set(pending.mutationId, pending);
      }
    });
    if (wire.length === 0) continue;

    const response = await api.push(deviceId, wire);
    if (response.kind === 'network') {
      // An error status means the server did not take the push: these mutations were never really sent.
      if (response.answered) storage.transaction(() => sent.forEach((pending) => storage.setAttempted(pending.mutationId, false)));
      return 'network';
    }
    storage.transaction(() => {
      for (const result of response.results) {
        const pending = sent.get(result.mutationId);
        if (pending) applyResult(storage, ids, pending, result);
      }
    });
  }
  return 'ok';
}

/** Step 3: pull everything after the cursor. Observations with a pending local mutation are left alone. */
export async function pullChanges(storage: Storage, api: Api): Promise<SyncOutcome> {
  const response = await api.pull(storage.getCursor());
  if (response.kind === 'network') return 'network';
  storage.transaction(() => {
    for (const change of response.changes) {
      if (storage.getPending(change.id)) continue;
      storeServerCopy(storage, change);
    }
    storage.setCursor(response.cursor);
  });
  return 'ok';
}
