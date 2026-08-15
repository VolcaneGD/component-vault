import { copyFileSync, existsSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import Database from 'better-sqlite3';
import { SCHEMA_VERSION, schemaV1 } from './schema';

export { SCHEMA_VERSION } from './schema';

export interface DatabaseContext {
  db: Database.Database;
  close: () => void;
  backupBeforeMigration: () => string | null;
}

const backupName = (databasePath: string, now = new Date()): string =>
  `${basename(databasePath)}.${now.toISOString().replace(/[-:]/g, '')}.backup`;

export const openDatabase = (databasePath: string): DatabaseContext => {
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  const backupBeforeMigration = (): string | null => {
    if (databasePath === ':memory:' || !existsSync(databasePath)) return null;
    db.pragma('wal_checkpoint(TRUNCATE)');
    const destination = join(dirname(databasePath), backupName(databasePath));
    copyFileSync(databasePath, destination);
    return destination;
  };

  migrate(db, backupBeforeMigration);

  return { db, close: () => db.close(), backupBeforeMigration };
};

const migrate = (db: Database.Database, backupBeforeMigration: () => string | null): void => {
  const metaExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'",
  ).get();
  const currentVersion = metaExists
    ? (db.prepare('SELECT version FROM schema_meta LIMIT 1').pluck().get() as number | undefined) ?? 0
    : 0;

  if (currentVersion > SCHEMA_VERSION) {
    throw new Error(`Database schema version ${currentVersion} is newer than this application`);
  }
  if (currentVersion === SCHEMA_VERSION) return;
  if (currentVersion > 0) backupBeforeMigration();

  db.transaction(() => {
    if (currentVersion < 1) {
      db.exec(schemaV1);
      db.prepare('DELETE FROM schema_meta').run();
      db.prepare('INSERT INTO schema_meta (version) VALUES (?)').run(SCHEMA_VERSION);
    }
  })();
};
