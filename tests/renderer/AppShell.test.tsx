import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultAppSettings,
  type AppSettings,
  type ComponentRecord,
  type LibraryRecord,
} from '../../src/shared/contracts';
import App from '../../src/renderer/src/App';
import { useAppStore } from '../../src/renderer/src/store/useAppStore';

const saveAppSettings = vi.fn().mockResolvedValue({ viewMode: 'gallery' });

const resetAppStore = () => useAppStore.setState({
  settings: defaultAppSettings(),
  libraries: [],
  components: [],
  componentsLibraryId: null,
  selectedLibraryId: null,
  selectedComponentId: null,
  selectedComponentIds: [],
  draftOrigins: {},
  searchQuery: '',
  selectedTags: [],
  isHydrated: false,
  mutationVersion: 0,
});

beforeEach(() => {
  resetAppStore();
  saveAppSettings.mockClear();
  Object.defineProperty(window, 'componentVault', {
    configurable: true,
    value: { saveAppSettings },
  });
});

afterEach(() => {
  cleanup();
  resetAppStore();
});

describe('App shell navigation', () => {
  it('loads and selects an imported component from a non-active target library', async () => {
    const activeLibraryId = '7aa4a429-da7d-4ea0-bf8e-4deca38e95aa';
    const targetLibraryId = 'b3633404-965c-4748-b6e8-d6bcfca3345e';
    const imported: ComponentRecord = {
      id: 'a19979d8-cb60-4eb8-bc5f-c905ba14adf0',
      libraryId: targetLibraryId,
      name: 'Imported card',
      description: '',
      category: '',
      tags: [],
      html: '<article>Card</article>',
      css: '',
      javascript: '',
      sourceType: 'import',
      originalFileName: 'card.html',
      previewPolicy: {
        allowScripts: false,
        allowForms: false,
        allowPopups: false,
        externalNetworkEnabled: false,
        allowedOrigins: [],
      },
      createdAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:00.000Z',
      deletedAt: null,
    };
    const existingTarget = { ...imported, id: 'e43f9f9a-d4e1-45f1-a3ea-caba29f822fb', name: 'Existing card' };
    const listComponents = vi.fn().mockResolvedValue([existingTarget, imported]);
    Object.defineProperty(window, 'componentVault', {
      configurable: true,
      value: { listComponents, saveAppSettings },
    });
    useAppStore.setState({
      components: [{ ...imported, id: 'f212f7b1-0241-43ab-bbe5-59dfd450af34', libraryId: activeLibraryId }],
      componentsLibraryId: activeLibraryId,
      selectedLibraryId: activeLibraryId,
    });

    await useAppStore.getState().acceptSavedComponents([imported]);

    expect(listComponents).toHaveBeenCalledWith(targetLibraryId);
    expect(useAppStore.getState()).toMatchObject({
      components: [existingTarget, imported],
      componentsLibraryId: targetLibraryId,
      selectedLibraryId: targetLibraryId,
      selectedComponentId: imported.id,
    });
    expect(saveAppSettings).toHaveBeenCalledWith({
      lastLibraryId: targetLibraryId,
      lastComponentId: imported.id,
    });
  });

  it('serializes creation with a newer draft save so the latest code reaches the saved id', async () => {
    let finishCreate!: (component: ComponentRecord) => void;
    const createResult = new Promise<ComponentRecord>((resolve) => { finishCreate = resolve; });
    const saveComponent = vi.fn()
      .mockReturnValueOnce(createResult)
      .mockImplementationOnce(async (input) => ({
        ...input,
        id: input.id,
        createdAt: '2026-08-15T00:00:00.000Z',
        updatedAt: '2026-08-15T00:00:02.000Z',
        deletedAt: null,
      }));
    Object.defineProperty(window, 'componentVault', {
      configurable: true,
      value: { saveComponent, saveAppSettings },
    });
    const draft = useAppStore.getState().beginCodeComponent('7aa4a429-da7d-4ea0-bf8e-4deca38e95aa');
    const first = { ...draft, name: 'Live button', html: '<button>First</button>' };
    useAppStore.getState().updateComponentDraft(first);
    const firstSave = useAppStore.getState().saveComponent(first);
    const latest = { ...first, html: '<button>Latest</button>' };
    useAppStore.getState().updateComponentDraft(latest);
    const latestSave = useAppStore.getState().saveComponent(latest);

    finishCreate({
      ...first,
      id: 'a19979d8-cb60-4eb8-bc5f-c905ba14adf0',
      updatedAt: '2026-08-15T00:00:01.000Z',
    });
    await Promise.all([firstSave, latestSave]);

    expect(saveComponent).toHaveBeenCalledTimes(2);
    expect(saveComponent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      id: undefined,
    }));
    expect(saveComponent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      id: 'a19979d8-cb60-4eb8-bc5f-c905ba14adf0',
      html: '<button>Latest</button>',
    }));
    expect(useAppStore.getState().components[0]).toMatchObject({
      id: 'a19979d8-cb60-4eb8-bc5f-c905ba14adf0',
      html: '<button>Latest</button>',
    });
    expect(useAppStore.getState().draftOrigins).toEqual({
      'a19979d8-cb60-4eb8-bc5f-c905ba14adf0': draft.id,
    });
  });

  it('opens code creation from the sidebar and starts an unsaved workbench draft', async () => {
    const library: LibraryRecord = {
      id: 'library-1',
      name: 'Design system',
      description: '',
      createdAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:00.000Z',
    };
    const saveComponent = vi.fn();
    const deleteComponent = vi.fn();
    Object.defineProperty(window, 'componentVault', {
      configurable: true,
      value: {
        getAppSettings: async () => ({ ...defaultAppSettings(), lastLibraryId: library.id }),
        listLibraries: async () => [library],
        saveAppSettings,
        saveComponent,
        deleteComponent,
      },
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'New component' }));
    expect(await screen.findByRole('dialog', { name: 'Create a component' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start coding' }));

    expect(screen.queryByRole('dialog', { name: 'Create a component' })).not.toBeInTheDocument();
    expect(useAppStore.getState().components).toEqual([
      expect.objectContaining({
        libraryId: library.id,
        name: '',
        html: '',
        css: '',
        javascript: '',
        sourceType: 'manual',
      }),
    ]);
    expect(useAppStore.getState().selectedComponentId).toMatch(/^draft:/);

    const transient = useAppStore.getState().components[0];
    await useAppStore.getState().saveComponent({
      ...transient,
      previewPolicy: { ...transient.previewPolicy, allowScripts: true },
    });
    expect(saveComponent).not.toHaveBeenCalled();

    await useAppStore.getState().deleteComponent(transient.id);
    expect(deleteComponent).not.toHaveBeenCalled();
    expect(useAppStore.getState().components).toEqual([]);
  });

  it('opens file import from the sidebar footer', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Import' }));

    expect(await screen.findByRole('dialog', { name: 'Import HTML components' })).toBeInTheDocument();
  });

  it('switches from Workbench to Gallery and persists the choice', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /B Gallery/i }));

    expect(screen.getByRole('main')).toHaveAttribute('data-view', 'gallery');
    await waitFor(() => expect(saveAppSettings).toHaveBeenCalledWith({ viewMode: 'gallery' }));
  });

  it('renders an accessible persistent sidebar for navigation', () => {
    render(<App />);

    expect(screen.getByRole('navigation', { name: 'Component Vault navigation' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'New component' })).toBeVisible();
    expect(screen.getByRole('searchbox', { name: 'Search components' })).toBeVisible();
  });

  it('preserves local view and component selections when settings hydrate late', async () => {
    let resolveSettings: (settings: AppSettings) => void;
    const settings = new Promise<AppSettings>((resolve) => { resolveSettings = resolve; });
    Object.defineProperty(window, 'componentVault', {
      configurable: true,
      value: {
        getAppSettings: () => settings,
        listLibraries: async () => [],
        saveAppSettings,
      },
    });

    const hydration = useAppStore.getState().hydrate();
    useAppStore.getState().setViewMode('gallery');
    useAppStore.getState().setSelectedComponentId('component-picked-locally');
    resolveSettings!({
      ...defaultAppSettings(),
      viewMode: 'workbench',
      lastComponentId: 'component-from-settings',
    });
    await hydration;

    expect(useAppStore.getState().settings.viewMode).toBe('gallery');
    expect(useAppStore.getState().selectedComponentId).toBe('component-picked-locally');
  });

  it('restores the saved view and selected component after hydration', async () => {
    Object.defineProperty(window, 'componentVault', {
      configurable: true,
      value: {
        getAppSettings: async () => ({
          ...defaultAppSettings(),
          viewMode: 'studio',
          lastComponentId: 'component-restored-from-settings',
        }),
        listLibraries: async () => [],
        saveAppSettings,
      },
    });
    render(<App />);

    await waitFor(() => expect(screen.getByRole('main')).toHaveAttribute('data-view', 'studio'));
    expect(useAppStore.getState().selectedComponentId).toBe('component-restored-from-settings');
  });
});
