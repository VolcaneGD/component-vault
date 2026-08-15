import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, SCHEMA_VERSION } from '../../src/main/database/database';
import { schemaV1 } from '../../src/main/database/schema';

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
  it('initializes the current schema with WAL, foreign keys, and deletion tombstones', () => {
    const database = openTestDatabase();

    expect(database.db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(database.db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(database.db.prepare('SELECT version FROM schema_meta').get()).toEqual({
      version: SCHEMA_VERSION,
    });
    expect(database.db.prepare("PRAGMA table_info('components')").all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'deleted_at', notnull: 0 })]),
    );
    expect(database.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'component_deletion_tombstones'",
    ).get()).toEqual({ name: 'component_deletion_tombstones' });

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

  it('migrates existing soft deletes into permanent deletion tombstones', () => {
    const directory = mkdtempSync(join(tmpdir(), 'component-vault-v1-test-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'component-vault.sqlite');
    const legacy = new Database(path);
    legacy.exec(schemaV1);
    legacy.prepare('DELETE FROM schema_meta').run();
    legacy.prepare('INSERT INTO schema_meta (version) VALUES (1)').run();
    legacy.prepare("INSERT INTO libraries (id, name, description, created_at, updated_at) VALUES ('l', 'Legacy', '', 'created', 'updated')").run();
    legacy.prepare(`INSERT INTO components (
      id, library_id, name, description, category, html, css, javascript, source_type,
      original_file_name, sort_order, created_at, updated_at, deleted_at
    ) VALUES ('deleted', 'l', 'Deleted', '', '', '', '', '', 'snippet', NULL, 0, 'created', 'updated', '2026-08-15T00:00:00.000Z')`).run();
    legacy.close();

    const migrated = openDatabase(path);

    expect(migrated.db.prepare('SELECT version FROM schema_meta').get()).toEqual({
      version: SCHEMA_VERSION,
    });
    expect(migrated.db.prepare(
      "SELECT component_id, deleted_at FROM component_deletion_tombstones WHERE component_id = 'deleted'",
    ).get()).toEqual({
      component_id: 'deleted',
      deleted_at: '2026-08-15T00:00:00.000Z',
    });
    migrated.close();
  });
});
