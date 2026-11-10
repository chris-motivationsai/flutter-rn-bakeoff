// SqlDriver over Node's built-in SQLite. Used by tests and the scenario runner; a phone uses expoSqlite.ts.
import { DatabaseSync } from 'node:sqlite';
import type { SqlDriver, SqlValue } from '../../core/ports';

export function openNodeSqlite(file: string): SqlDriver {
  const db = new DatabaseSync(file);
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, params = []) => void db.prepare(sql).run(...params),
    all: <Row>(sql: string, params: SqlValue[] = []) => db.prepare(sql).all(...params) as Row[],
    close: () => db.close(),
  };
}
