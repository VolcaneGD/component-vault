import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultAppSettings, type ComponentRecord, type LibraryRecord } from '../../src/shared/contracts';
import { useAppStore } from '../../src/renderer/src/store/useAppStore';

const library: LibraryRecord = {
  id: '9aa4a429-da7d-4ea0-bf8e-4deca38e95aa', name: 'UI', description: '',
  createdAt: '2026-08-17T00:00:00.000Z', updatedAt: '2026-08-17T00:00:00.000Z', revision: 2,
};

const component = (html: string): ComponentRecord => ({
  id: 'a19979d8-cb60-4eb8-bc5f-c905ba14adf0', libraryId: library.id, name: 'Button', description: '',
  category: 'Buttons', tags: [], html, css: '', javascript: '', sourceType: 'editor', originalFileName: null,
  previewPolicy: { allowScripts: false, allowForms: false, allowPopups: false, externalNetworkEnabled: false, allowedOrigins: [] },
  createdAt: '2026-08-17T00:00:00.000Z', updatedAt: '2026-08-17T00:00:00.000Z', deletedAt: null, revision: 2,
});

afterEach(() => {
  useAppStore.setState({
    settings: defaultAppSettings(), libraries: [], components: [], componentsLibraryId: null,
    selectedLibraryId: null, selectedComponentId: null, selectedComponentIds: [], draftOrigins: {},
    dirtyComponentIds: [], externalChangePending: false,
  });
  vi.restoreAllMocks();
});

describe('CLI library refresh', () => {
  it('preserves a dirty GUI draft after an external library mutation', async () => {
    const listComponents = vi.fn().mockResolvedValue([component('<button>CLI</button>')]);
    Object.defineProperty(window, 'componentVault', { configurable: true, value: {
      listLibraries: vi.fn().mockResolvedValue([library]), listComponents,
    } });
    useAppStore.setState({
      libraries: [library], components: [component('<button>Unsaved</button>')], componentsLibraryId: library.id,
      selectedLibraryId: library.id, selectedComponentId: component('').id, dirtyComponentIds: [component('').id],
    });

    await act(async () => {
      await useAppStore.getState().handleExternalLibraryChanged({
        libraryId: library.id, revision: 3, command: 'component update',
      });
    });

    expect(useAppStore.getState().components[0]?.html).toBe('<button>Unsaved</button>');
    expect(useAppStore.getState().externalChangePending).toBe(true);
    expect(listComponents).not.toHaveBeenCalled();
  });

  it('reloads a clean active library after an external mutation', async () => {
    Object.defineProperty(window, 'componentVault', { configurable: true, value: {
      listLibraries: vi.fn().mockResolvedValue([library]),
      listComponents: vi.fn().mockResolvedValue([component('<button>CLI</button>')]),
      saveAppSettings: vi.fn(),
    } });
    useAppStore.setState({
      libraries: [library], components: [component('<button>Old</button>')], componentsLibraryId: library.id,
      selectedLibraryId: library.id, selectedComponentId: component('').id, dirtyComponentIds: [],
    });

    await act(async () => {
      await useAppStore.getState().handleExternalLibraryChanged({
        libraryId: library.id, revision: 3, command: 'component update',
      });
    });

    expect(useAppStore.getState().components[0]?.html).toBe('<button>CLI</button>');
    expect(useAppStore.getState().externalChangePending).toBe(false);
  });
});
