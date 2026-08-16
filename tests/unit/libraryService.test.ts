import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseContext } from '../../src/main/database/database';
import { createLibraryService } from '../../src/main/services/library';
import { createSettingsService } from '../../src/main/services/settings';

const databases: DatabaseContext[] = [];
const temporaryDirectories: string[] = [];

const openTestDatabase = (): DatabaseContext => {
  const directory = mkdtempSync(join(tmpdir(), 'component-vault-test-'));
  temporaryDirectories.push(directory);
  const database = openDatabase(join(directory, 'component-vault.sqlite'));
  databases.push(database);
  return database;
};

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('LibraryService', () => {
  it('soft-deletes a component and restores it only with the matching unexpired token', () => {
    let now = Date.parse('2026-08-15T00:00:00.000Z');
    const service = createLibraryService(openTestDatabase(), { now: () => new Date(now) });
    const library = service.saveLibrary({ name: 'Undo', description: '' });
    const component = service.saveComponent(componentInput(library.id, 'Recoverable'));

    const token = service.deleteComponent(component.id);

    expect(token).toEqual({
      componentId: component.id,
      deletedAt: '2026-08-15T00:00:00.000Z',
      expiresAt: '2026-08-15T00:00:08.000Z',
    });
    expect(service.listComponents(library.id)).toEqual([]);
    now += 7_999;
    expect(service.restoreDeletedComponent(token!)).toMatchObject({ id: component.id, deletedAt: null });
    expect(service.listComponents(library.id)).toHaveLength(1);
  });

  it('permanently clears expired soft deletes and rejects stale restore tokens', () => {
    let now = Date.parse('2026-08-15T00:00:00.000Z');
    const database = openTestDatabase();
    const service = createLibraryService(database, { now: () => new Date(now) });
    const library = service.saveLibrary({ name: 'Cleanup', description: '' });
    const component = service.saveComponent(componentInput(library.id, 'Expired'));
    const token = service.deleteComponent(component.id)!;

    now += 8_001;

    expect(service.restoreDeletedComponent(token)).toBeUndefined();
    expect(service.purgeExpiredDeletedComponents()).toBe(1);
    expect(database.db.prepare('SELECT COUNT(*) AS count FROM components WHERE id = ?').get(component.id))
      .toEqual({ count: 0 });
  });

  it('rejects a stale direct save instead of resurrecting a soft-deleted component', () => {
    const service = createLibraryService(openTestDatabase());
    const library = service.saveLibrary({ name: 'No resurrection', description: '' });
    const component = service.saveComponent(componentInput(library.id, 'Deleted'));
    const staleSave = { ...componentInput(library.id, 'Stale edit'), id: component.id };
    service.deleteComponent(component.id);

    expect(() => service.saveComponent(staleSave)).toThrow('Component is deleted');
    expect(service.getComponent(component.id)).toBeUndefined();
  });

  it('keeps a deletion tombstone after expiry so an in-flight save cannot recreate the id', () => {
    let now = Date.parse('2026-08-15T00:00:00.000Z');
    const database = openTestDatabase();
    const service = createLibraryService(database, { now: () => new Date(now) });
    const library = service.saveLibrary({ name: 'Expired tombstone', description: '' });
    const component = service.saveComponent(componentInput(library.id, 'Deleted forever'));
    const staleSave = { ...componentInput(library.id, 'Late in-flight edit'), id: component.id };
    service.deleteComponent(component.id);
    now += 8_001;
    service.purgeExpiredDeletedComponents();

    expect(database.db.prepare('SELECT id FROM components WHERE id = ?').get(component.id)).toBeUndefined();
    expect(() => service.saveComponent(staleSave)).toThrow('Component is deleted');
    expect(database.db.prepare(
      'SELECT component_id FROM component_deletion_tombstones WHERE component_id = ?',
    ).get(component.id)).toEqual({ component_id: component.id });
  });

  it('keeps an abnormal recovery durable until the exact snapshot is acknowledged', () => {
    const database = openTestDatabase();
    const firstRun = createLibraryService(database);
    firstRun.startSession();
    const library = firstRun.saveLibrary({ name: 'Durable recovery', description: '' });
    const component = firstRun.saveComponent(componentInput(library.id, 'Completed save'));

    const secondRun = createLibraryService(database);
    const expected = {
      libraryId: library.id,
      componentId: component.id,
      completedAt: component.updatedAt,
    };
    expect(secondRun.startSession()).toEqual(expected);
    expect(secondRun.getRecoverySnapshot()).toEqual(expected);
    expect(secondRun.getRecoverySnapshot()).toEqual(expected);
    expect(secondRun.ackRecoverySnapshot({
      ...expected,
      completedAt: '2026-08-15T00:00:00.001Z',
    })).toBe(false);
    expect(secondRun.getRecoverySnapshot()).toEqual(expected);

    const thirdRun = createLibraryService(database);
    expect(thirdRun.startSession()).toEqual(expected);
    expect(thirdRun.getRecoverySnapshot()).toEqual(expected);
    expect(thirdRun.ackRecoverySnapshot(expected)).toBe(true);
    expect(thirdRun.ackRecoverySnapshot(expected)).toBe(false);
    expect(thirdRun.getRecoverySnapshot()).toBeNull();
  });

  it('stores one component with tags and preview policy atomically', () => {
    const service = createLibraryService(openTestDatabase());
    const library = service.saveLibrary({ name: 'UI Essentials', description: '' });
    const saved = service.saveComponent({
      libraryId: library.id, name: 'Aurora Button', description: '', category: 'Buttons',
      html: '<button>Magic</button>', css: 'button{color:white}', javascript: '',
      sourceType: 'editor', originalFileName: null, tags: ['button', 'dark'],
      previewPolicy: {
        allowScripts: true, allowForms: false, allowPopups: false,
        externalNetworkEnabled: false, allowedOrigins: [],
      },
    });

    expect(service.getComponent(saved.id)).toMatchObject({
      name: 'Aurora Button', tags: ['button', 'dark'],
      previewPolicy: expect.objectContaining({ externalNetworkEnabled: false }),
    });
  });

  it('removes a library and all of its components through the foreign-key cascade', () => {
    const service = createLibraryService(openTestDatabase());
    const library = service.saveLibrary({ name: 'Delete me', description: '' });
    const component = service.saveComponent(componentInput(library.id, 'Transient'));

    service.deleteLibrary(library.id);

    expect(service.getComponent(component.id)).toBeUndefined();
    expect(service.listLibraries()).toEqual([]);
  });

  it('returns components in their explicit stable order', () => {
    const service = createLibraryService(openTestDatabase());
    const library = service.saveLibrary({ name: 'Order', description: '' });
    const first = service.saveComponent(componentInput(library.id, 'First'));
    const second = service.saveComponent(componentInput(library.id, 'Second'));
    const third = service.saveComponent(componentInput(library.id, 'Third'));

    service.reorderComponents(library.id, [third.id, first.id, second.id]);

    expect(service.listComponents(library.id).map(component => component.name)).toEqual([
      'Third', 'First', 'Second',
    ]);
  });

  it('finds matching component names and tags only within the requested library', () => {
    const service = createLibraryService(openTestDatabase());
    const library = service.saveLibrary({ name: 'Primary', description: '' });
    const otherLibrary = service.saveLibrary({ name: 'Secondary', description: '' });
    service.saveComponent({ ...componentInput(library.id, 'Aurora Button'), tags: ['dark'] });
    service.saveComponent({ ...componentInput(otherLibrary.id, 'Aurora Card'), tags: ['dark'] });

    expect(service.searchComponents(library.id, 'dark').map(component => component.name)).toEqual([
      'Aurora Button',
    ]);
  });

  it.each(['http://example.test', 'https://example.test/path', 'not a URL'])(
    'rejects and rolls back a component with an invalid preview origin: %s',
    origin => {
      const database = openTestDatabase();
      const service = createLibraryService(database);
      const library = service.saveLibrary({ name: 'Preview validation', description: '' });

      expect(() => service.saveComponent({
        ...componentInput(library.id, 'Unsafe component'),
        previewPolicy: {
          allowScripts: false, allowForms: false, allowPopups: false,
          externalNetworkEnabled: true, allowedOrigins: [origin],
        },
      })).toThrow('Invalid preview policy');
      expect(database.db.prepare('SELECT COUNT(*) AS count FROM components').get()).toEqual({ count: 0 });
    },
  );

  it('persists canonical HTTPS preview origins supplied directly to the service', () => {
    const service = createLibraryService(openTestDatabase());
    const library = service.saveLibrary({ name: 'Safe previews', description: '' });
    const saved = service.saveComponent({
      ...componentInput(library.id, 'Safe component'),
      previewPolicy: {
        allowScripts: false, allowForms: false, allowPopups: false,
        externalNetworkEnabled: true, allowedOrigins: ['https://cdn.example.test'],
      },
    });

    expect(service.getComponent(saved.id)?.previewPolicy.allowedOrigins).toEqual([
      'https://cdn.example.test',
    ]);
  });

  it('rejects an existing-component update whose revision is stale', () => {
    const service = createLibraryService(openTestDatabase());
    const library = service.saveLibrary({ name: 'Revision safety', description: '' });
    const original = service.saveComponent(componentInput(library.id, 'Button'));
    const guiSaved = service.saveComponent({ ...original, html: '<button>GUI edit</button>' });

    expect(original.revision).toBeTypeOf('number');
    expect(guiSaved.revision).toBeTypeOf('number');
    expect(guiSaved.revision).not.toBe(original.revision);
    let failure: unknown;
    try {
      service.saveComponentIfRevision(
        { ...original, html: '<button>CLI edit</button>' },
        original.revision!,
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 'conflict', currentRevision: guiSaved.revision });
    expect(service.getComponent(original.id)?.html).toBe('<button>GUI edit</button>');
  });

  it('rejects stale delete and reorder requests without changing the library', () => {
    const service = createLibraryService(openTestDatabase());
    const library = service.saveLibrary({ name: 'Revision actions', description: '' });
    const first = service.saveComponent(componentInput(library.id, 'First'));
    const second = service.saveComponent(componentInput(library.id, 'Second'));
    const current = service.saveComponent({ ...first, html: '<button>GUI edit</button>' });

    const staleDelete = captureFailure(() => service.deleteComponentIfRevision(first.id, first.revision!));
    const staleReorder = captureFailure(() =>
      service.reorderComponentsIfRevision(library.id, [second.id, first.id], library.revision!),
    );
    expect(staleDelete).toMatchObject({ code: 'conflict', currentRevision: current.revision });
    expect(staleReorder).toMatchObject({ code: 'conflict' });
    expect(service.listComponents(library.id).map(component => component.id)).toEqual([first.id, second.id]);
  });
});

describe('SettingsService', () => {
  it('returns approved defaults before any settings are persisted', () => {
    const service = createSettingsService(openTestDatabase());

    expect(service.getAppSettings()).toEqual({
      language: 'en', viewMode: 'workbench', galleryColumns: 3, editorPreviewRatio: 0.55,
      studioPaneRatios: [0.24, 0.42, 0.34], lastLibraryId: null, lastComponentId: null,
    });
  });

  it('merges an approved settings patch without resetting unrelated settings', () => {
    const service = createSettingsService(openTestDatabase());
    service.saveAppSettings({ editorPreviewRatio: 0.7 });

    const saved = service.saveAppSettings({ viewMode: 'gallery', galleryColumns: 4 });

    expect(saved).toEqual({
      language: 'en', viewMode: 'gallery', galleryColumns: 4, editorPreviewRatio: 0.7,
      studioPaneRatios: [0.24, 0.42, 0.34], lastLibraryId: null, lastComponentId: null,
    });
    expect(service.getAppSettings()).toEqual(saved);
  });
});

const componentInput = (libraryId: string, name: string) => ({
  libraryId, name, description: '', category: 'Buttons', html: '<button />', css: '', javascript: '',
  sourceType: 'editor', originalFileName: null, tags: [],
  previewPolicy: {
    allowScripts: false, allowForms: false, allowPopups: false,
    externalNetworkEnabled: false, allowedOrigins: [],
  },
});

const captureFailure = (operation: () => unknown): unknown => {
  try {
    operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to fail');
};
