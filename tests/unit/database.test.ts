import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, SCHEMA_VERSION } from '../../src/main/database/database';

const temporaryDirectories: string[] = [];

const openTestDatabase = () => {
  const directory = mkdtempSync(join(tmpdir(), 'component-vault-test-'));
  temporaryDirectories.push(directory);
  return openDatabase(join(directory, 'component-vault.sqlite'));
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('SQLite database', () => {
  it('initializes schema version 1 with WAL and foreign-key enforcement', () => {
    const database = openTestDatabase();

    expect(database.db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(database.db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(database.db.prepare('SELECT version FROM schema_meta').get()).toEqual({
      version: SCHEMA_VERSION,
    });
    expect(database.db.prepare("PRAGMA table_info('components')").all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'deleted_at', notnull: 0 })]),
    );

    database.close();
  });

  it('copies an existing database to a timestamped backup before a future migration', () => {
    const database = openTestDatabase();
    database.db.prepare("INSERT INTO libraries (id, name, description, created_at, updated_at) VALUES ('l', 'Library', '', 'created', 'updated')").run();
    const backupPath = database.backupBeforeMigration();

    expect(backupPath).toMatch(/component-vault\.sqlite\.\d{8}T\d{6}\.\d{3}Z\.backup$/);
    expect(existsSync(backupPath!)).toBe(true);
    expect(readFileSync(backupPath!).byteLength).toBeGreaterThan(0);

    database.close();
  });
});
