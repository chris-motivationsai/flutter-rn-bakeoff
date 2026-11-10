// The expo-sqlite driver adapter, with expo-sqlite's native database replaced by Node's SQLite behind the
// same synchronous method names. Checks that the adapter passes SQL and parameters the way Storage needs.
import { openExpoSqlite } from '../../src/adapters/real/expoSqlite';
import { Storage } from '../../src/core/storage';

jest.mock('expo-sqlite', () => {
  const { DatabaseSync } = jest.requireActual('node:sqlite') as typeof import('node:sqlite');
  return {
    openDatabaseSync: (_name: string) => {
      const db = new DatabaseSync(':memory:');
      return {
        execSync: (sql: string) => db.exec(sql),
        runSync: (sql: string, params: (string | number | null)[]) => db.prepare(sql).run(...params),
        getAllSync: (sql: string, params: (string | number | null)[]) => db.prepare(sql).all(...params),
        closeSync: () => db.close(),
      };
    },
  };
});

test('Storage works through the expo-sqlite adapter', () => {
  const storage = new Storage(openExpoSqlite('test.db'));
  storage.transaction(() => {
    storage.putObservation({ id: 'a', type: 'flow', value: { code: 'light' }, observedAt: '2026-11-03T08:00:00Z', source: 'manual', baseRevision: 0 });
    storage.replacePending('a', 'm-1', 'upsert');
  });
  expect(storage.allObservations()).toEqual([
    { id: 'a', type: 'flow', value: { code: 'light' }, observedAt: '2026-11-03T08:00:00Z', source: 'manual', baseRevision: 0, deleted: false },
  ]);
  expect(storage.allPending()).toEqual([{ observationId: 'a', mutationId: 'm-1', op: 'upsert', seq: 1, attempted: false }]);
  expect(() => storage.transaction(() => { storage.setCursor(9); throw new Error('boom'); })).toThrow('boom');
  expect(storage.getCursor()).toBe(0); // rolled back
  storage.close();
});
