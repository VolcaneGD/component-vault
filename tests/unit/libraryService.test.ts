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
});

describe('SettingsService', () => {
  it('returns approved defaults before any settings are persisted', () => {
    const service = createSettingsService(openTestDatabase());

    expect(service.getAppSettings()).toEqual({
      viewMode: 'workbench', galleryColumns: 3, editorPreviewRatio: 0.55,
      studioPaneRatios: [0.24, 0.42, 0.34], lastLibraryId: null, lastComponentId: null,
    });
  });

  it('merges an approved settings patch without resetting unrelated settings', () => {
    const service = createSettingsService(openTestDatabase());
    service.saveAppSettings({ editorPreviewRatio: 0.7 });

    const saved = service.saveAppSettings({ viewMode: 'gallery', galleryColumns: 4 });

    expect(saved).toEqual({
      viewMode: 'gallery', galleryColumns: 4, editorPreviewRatio: 0.7,
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
