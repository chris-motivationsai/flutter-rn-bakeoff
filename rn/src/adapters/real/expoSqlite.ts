// SqlDriver over expo-sqlite's synchronous API (the on-device database).
import { openDatabaseSync } from 'expo-sqlite';
import type { SqlDriver, SqlValue } from '../../core/ports';

export function openExpoSqlite(databaseName: string): SqlDriver {
  const db = openDatabaseSync(databaseName);
  return {
    exec: (sql) => db.execSync(sql),
    run: (sql, params = []) => void db.runSync(sql, params),
    all: <Row>(sql: string, params: SqlValue[] = []) => db.getAllSync<Row>(sql, params),
    close: () => db.closeSync(),
  };
}
