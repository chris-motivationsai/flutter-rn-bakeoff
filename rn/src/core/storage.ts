// Durable on-device state. Every table here must survive an app restart (SPEC section 4):
// observations, pending mutations, the pull cursor, conflicts, entitlements and held receipts.
import type { Entitlement, ObservationBody } from './contracts';
import type { SqlDriver, SqlValue } from './ports';
import type { PendingMutation, StoredObservation, Target } from './types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  source TEXT NOT NULL,
  reader TEXT,
  base_revision INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pending_mutations (
  observation_id TEXT PRIMARY KEY,
  mutation_id TEXT NOT NULL,
  op TEXT NOT NULL,
  seq INTEGER NOT NULL,
  attempted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS conflicts (seq INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, observed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS entitlements (name TEXT PRIMARY KEY, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS held_receipts (seq INTEGER PRIMARY KEY AUTOINCREMENT, tx_id TEXT NOT NULL UNIQUE, receipt TEXT NOT NULL);
`;

type ObservationRow = {
  id: string; type: string; value: string; observed_at: string; source: string; reader: string | null;
  base_revision: number; deleted: number;
};
type PendingRow = { observation_id: string; mutation_id: string; op: string; seq: number; attempted: number };

const toObservation = (row: ObservationRow): StoredObservation => ({
  id: row.id,
  type: row.type,
  value: JSON.parse(row.value),
  observedAt: row.observed_at,
  source: row.source as StoredObservation['source'],
  ...(row.reader ? { reader: JSON.parse(row.reader) } : {}),
  baseRevision: row.base_revision,
  deleted: row.deleted === 1,
});

const toPending = (row: PendingRow): PendingMutation => ({
  observationId: row.observation_id,
  mutationId: row.mutation_id,
  op: row.op as PendingMutation['op'],
  seq: row.seq,
  attempted: row.attempted === 1,
});

export class Storage {
  private depth = 0;

  constructor(private readonly db: SqlDriver) {
    db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  /** Runs `work` atomically. Nested calls join the outer transaction. */
  transaction<T>(work: () => T): T {
    if (this.depth > 0) return work();
    this.db.exec('BEGIN IMMEDIATE');
    this.depth++;
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.depth--;
    }
  }

  // ---- meta ----
  private getMeta(key: string): string | null {
    const rows = this.db.all<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
    return rows.length ? rows[0].value : null;
  }
  private setMeta(key: string, value: string): void {
    this.db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
  }

  /** The pull cursor: the highest server revision this device has pulled. */
  getCursor(): number {
    return Number(this.getMeta('cursor') ?? 0);
  }
  setCursor(cursor: number): void {
    this.setMeta('cursor', String(cursor));
  }

  /** A stable id for this install, created on first use. */
  deviceId(create: () => string): string {
    const existing = this.getMeta('device_id');
    if (existing) return existing;
    const id = create();
    this.setMeta('device_id', id);
    return id;
  }

  // ---- observations ----
  getObservation(id: string): StoredObservation | null {
    const rows = this.db.all<ObservationRow>('SELECT * FROM observations WHERE id = ?', [id]);
    return rows.length ? toObservation(rows[0]) : null;
  }

  /** Every stored observation, including types this pack cannot show and local deletes awaiting push. */
  allObservations(): StoredObservation[] {
    return this.db.all<ObservationRow>('SELECT * FROM observations ORDER BY observed_at, type, id').map(toObservation);
  }

  putObservation(obs: ObservationBody & { id: string; baseRevision: number; deleted?: boolean }): void {
    const params: SqlValue[] = [
      obs.id, obs.type, JSON.stringify(obs.value), obs.observedAt, obs.source,
      obs.reader && Object.keys(obs.reader).length ? JSON.stringify(obs.reader) : null,
      obs.baseRevision, obs.deleted ? 1 : 0,
    ];
    this.db.run(
      `INSERT INTO observations (id, type, value, observed_at, source, reader, base_revision, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET type = excluded.type, value = excluded.value, observed_at = excluded.observed_at,
         source = excluded.source, reader = excluded.reader, base_revision = excluded.base_revision, deleted = excluded.deleted`,
      params,
    );
  }

  setBaseRevision(id: string, revision: number): void {
    this.db.run('UPDATE observations SET base_revision = ? WHERE id = ?', [revision, id]);
  }

  removeObservation(id: string): void {
    this.db.run('DELETE FROM observations WHERE id = ?', [id]);
  }

  // ---- pending mutations (at most one per observation) ----
  getPending(observationId: string): PendingMutation | null {
    const rows = this.db.all<PendingRow>('SELECT * FROM pending_mutations WHERE observation_id = ?', [observationId]);
    return rows.length ? toPending(rows[0]) : null;
  }

  /** Oldest first, by when each observation became pending. */
  allPending(): PendingMutation[] {
    return this.db.all<PendingRow>('SELECT * FROM pending_mutations ORDER BY seq').map(toPending);
  }

  countPending(): number {
    return this.db.all<{ n: number }>('SELECT COUNT(*) AS n FROM pending_mutations')[0].n;
  }

  /**
   * Records a new local change. If the observation already has a pending mutation it is replaced,
   * keeping its place in the queue; otherwise the observation joins the end of the queue.
   */
  replacePending(observationId: string, mutationId: string, op: PendingMutation['op']): void {
    const existing = this.getPending(observationId);
    const seq = existing ? existing.seq : this.db.all<{ next: number }>('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM pending_mutations')[0].next;
    this.db.run(
      `INSERT INTO pending_mutations (observation_id, mutation_id, op, seq, attempted) VALUES (?, ?, ?, ?, 0)
       ON CONFLICT(observation_id) DO UPDATE SET mutation_id = excluded.mutation_id, op = excluded.op, attempted = 0`,
      [observationId, mutationId, op, seq],
    );
  }

  /** attempted = the mutation went on the wire and the server may have applied it, answer or not. */
  setAttempted(mutationId: string, attempted: boolean): void {
    this.db.run('UPDATE pending_mutations SET attempted = ? WHERE mutation_id = ?', [attempted ? 1 : 0, mutationId]);
  }

  /** Drops a mutation by its id (a newer local change with another id stays). */
  removePendingByMutation(mutationId: string): void {
    this.db.run('DELETE FROM pending_mutations WHERE mutation_id = ?', [mutationId]);
  }

  removePending(observationId: string): void {
    this.db.run('DELETE FROM pending_mutations WHERE observation_id = ?', [observationId]);
  }

  // ---- conflicts ----
  addConflict(target: Target): void {
    this.db.run('INSERT INTO conflicts (type, observed_at) VALUES (?, ?)', [target.type, target.observedAt]);
  }

  /** In the order they happened. */
  allConflicts(): Target[] {
    return this.db
      .all<{ type: string; observed_at: string }>('SELECT type, observed_at FROM conflicts ORDER BY seq')
      .map((row) => ({ type: row.type, observedAt: row.observed_at }));
  }

  // ---- entitlements ----
  putEntitlement(entitlement: Entitlement): void {
    this.db.run(
      'INSERT INTO entitlements (name, expires_at) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET expires_at = excluded.expires_at',
      [entitlement.name, entitlement.expiresAt],
    );
  }

  allEntitlements(): Entitlement[] {
    return this.db
      .all<{ name: string; expires_at: string }>('SELECT name, expires_at FROM entitlements ORDER BY name')
      .map((row) => ({ name: row.name, expiresAt: row.expires_at }));
  }

  // ---- receipts the server has not judged yet ----
  holdReceipt(txId: string, receipt: string): void {
    this.db.run('INSERT INTO held_receipts (tx_id, receipt) VALUES (?, ?) ON CONFLICT(tx_id) DO UPDATE SET receipt = excluded.receipt', [txId, receipt]);
  }

  releaseReceipt(txId: string): void {
    this.db.run('DELETE FROM held_receipts WHERE tx_id = ?', [txId]);
  }

  heldReceipts(): { txId: string; receipt: string }[] {
    return this.db
      .all<{ tx_id: string; receipt: string }>('SELECT tx_id, receipt FROM held_receipts ORDER BY seq')
      .map((row) => ({ txId: row.tx_id, receipt: row.receipt }));
  }
}
