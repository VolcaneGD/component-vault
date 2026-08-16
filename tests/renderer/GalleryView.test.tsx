import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAppSettings, type ComponentRecord, type LibraryRecord } from '../../src/shared/contracts';
import { GalleryView } from '../../src/renderer/src/features/library/GalleryView';
import { LibrarySidebar } from '../../src/renderer/src/features/library/LibrarySidebar';
import { useAppStore } from '../../src/renderer/src/store/useAppStore';

const library: LibraryRecord = {
  id: 'library-1',
  name: 'Interface kit',
  description: '',
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
};

const secondaryLibrary: LibraryRecord = {
  ...library,
  id: 'library-2',
  name: 'Dashboard kit',
};

const component = (
  id: string,
  name: string,
  tags: string[] = [],
  overrides: Partial<ComponentRecord> = {},
): ComponentRecord => ({
  id,
  libraryId: library.id,
  name,
  description: `${name} description`,
  category: 'UI',
  tags,
  html: `<button>${name}</button>`,
  css: 'button { color: rebeccapurple; }',
  javascript: '',
  sourceType: 'manual',
  originalFileName: null,
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
  ...overrides,
});

const records = [
  component('component-1', 'Primary Button', ['button', 'primary']),
  component('component-2', 'Secondary Button', ['button', 'secondary']),
  component('component-3', 'Primary Card', ['card', 'primary']),
];

const saveAppSettings = vi.fn().mockResolvedValue(defaultAppSettings());
const reorderComponents = vi.fn().mockResolvedValue(undefined);
const deleteComponent = vi.fn().mockResolvedValue(true);
const saveComponentApi = vi.fn(async (input) => ({
  ...(records.find((item) => item.id === input.id) ?? records[0]),
  ...input,
  updatedAt: '2026-08-15T00:00:01.000Z',
} as ComponentRecord));

const resetStore = (components = records) => useAppStore.setState({
  settings: defaultAppSettings(),
  libraries: [library],
  components,
  componentsLibraryId: library.id,
  selectedLibraryId: library.id,
  selectedComponentId: components[0]?.id ?? null,
  selectedComponentIds: [],
  searchQuery: '',
  selectedTags: [],
  isHydrated: true,
  mutationVersion: 0,
});

beforeEach(() => {
  saveAppSettings.mockClear();
  reorderComponents.mockClear();
  deleteComponent.mockClear();
  saveComponentApi.mockClear();
  saveComponentApi.mockImplementation(async (input) => ({
    ...(records.find((item) => item.id === input.id) ?? records[0]),
    ...input,
    updatedAt: '2026-08-15T00:00:01.000Z',
  } as ComponentRecord));
  resetStore();
  Object.defineProperty(window, 'componentVault', {
    configurable: true,
    value: {
      saveAppSettings,
      reorderComponents,
      deleteComponent,
      saveComponent: saveComponentApi,
      configurePreviewNetwork: vi.fn().mockResolvedValue(undefined),
      releasePreviewNetwork: vi.fn().mockResolvedValue(undefined),
      onPreviewRequestBlocked: vi.fn(() => () => undefined),
    },
  });
});

afterEach(() => {
  cleanup();
  resetStore([]);
});

describe('GalleryView', () => {
  it('uses the persisted dark preview canvas for gallery thumbnails', () => {
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, previewTheme: 'dark' } });

    render(<GalleryView columns={2} />);

    expect(screen.getByTitle('Preview of Primary Button')).toHaveAttribute('data-preview-theme', 'dark');
  });

  it('changes Gallery to four columns and persists the setting', async () => {
    const user = userEvent.setup();
    render(<GalleryView columns={2} />);

    await user.selectOptions(screen.getByLabelText('Gallery columns'), '4');

    expect(screen.getByTestId('component-grid')).toHaveStyle({ '--gallery-columns': '4' });
    expect(saveAppSettings).toHaveBeenCalledWith({ galleryColumns: 4 });
    const thumbnail = within(screen.getByRole('article', { name: 'Primary Button' }))
      .getByTitle('Preview of Primary Button');
    expect(thumbnail).toHaveAttribute('loading', 'lazy');
    expect(thumbnail).toHaveAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
  });

  it('intersects sidebar search and tag filters and highlights the matching text', async () => {
    const user = userEvent.setup();
    render(
      <>
        <LibrarySidebar
          libraries={[library]}
          selectedLibraryId={library.id}
          onSelectLibrary={vi.fn()}
        />
        <GalleryView columns={3} />
      </>,
    );

    await user.type(screen.getByRole('searchbox', { name: 'Search components' }), 'Primary');
    await user.click(screen.getByRole('button', { name: 'Filter by tag button' }));

    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(1);
    expect(within(cards[0]).getAllByText(/Primary/i, { selector: 'mark' }).length).toBeGreaterThan(0);
    expect(within(cards[0]).getByRole('button', { name: 'Open Primary Button' })).toBeVisible();
  });

  it('highlights a visible match in the description', () => {
    resetStore([
      component('component-description', 'Action Card', ['card'], {
        description: 'Launch the workflow immediately',
      }),
    ]);
    useAppStore.getState().setSearchQuery('workflow');

    render(<GalleryView columns={2} />);

    expect(screen.getByText('workflow', { selector: 'mark' })).toBeVisible();
  });

  it('renders a contextual visible snippet when a description match is near the clipped end', () => {
    const longDescription = `Opening text that must not consume the card ${'filler '.repeat(40)}critical-tail marker`;
    resetStore([
      component('component-long-description', 'Audit Card', ['card'], {
        description: longDescription,
      }),
    ]);
    useAppStore.getState().setSearchQuery('critical-tail');

    render(<GalleryView columns={2} />);

    const description = screen.getByTestId('gallery-description');
    expect(description).toHaveAttribute('data-contextual-match', 'true');
    expect(description).toHaveTextContent(/….*critical-tail.*marker/);
    expect(description).not.toHaveTextContent('Opening text');
    expect(within(description).getByText('critical-tail', { selector: 'mark' })).toBeVisible();
  });

  it('highlights visible matches in category and tag metadata', () => {
    resetStore([
      component('component-metadata', 'Revenue Summary', ['commerce'], {
        category: 'Dashboard',
      }),
    ]);
    useAppStore.getState().setSearchQuery('Dashboard');
    const { rerender } = render(<GalleryView columns={2} />);
    expect(screen.getByText('Dashboard', { selector: 'mark' })).toBeVisible();

    useAppStore.getState().setSearchQuery('commerce');
    rerender(<GalleryView columns={2} />);
    expect(screen.getByText('commerce', { selector: 'mark' })).toBeVisible();
  });

  it('keeps stable card order, selects a card, and persists a drag reorder', async () => {
    const user = userEvent.setup();
    render(<GalleryView columns={3} />);
    const grid = screen.getByTestId('component-grid');

    expect(within(grid).getAllByRole('article').map((card) => card.dataset.componentId)).toEqual([
      'component-1',
      'component-2',
      'component-3',
    ]);

    await user.click(screen.getByRole('button', { name: 'Open Secondary Button' }));
    expect(useAppStore.getState().selectedComponentId).toBe('component-2');

    const source = screen.getByRole('article', { name: 'Primary Button' });
    const target = screen.getByRole('article', { name: 'Primary Card' });
    fireEvent.dragStart(source, { dataTransfer: { setData: vi.fn(), effectAllowed: 'move' } });
    fireEvent.dragOver(target);
    fireEvent.drop(target);

    await waitFor(() => expect(reorderComponents).toHaveBeenCalledWith(library.id, [
      'component-2',
      'component-3',
      'component-1',
    ]));
    expect(useAppStore.getState().components.map((item) => item.id)).toEqual([
      'component-2',
      'component-3',
      'component-1',
    ]);
  });

  it('supports multi-select actions and reports an empty filtered result', async () => {
    const user = userEvent.setup();
    render(
      <>
        <LibrarySidebar
          libraries={[library]}
          selectedLibraryId={library.id}
          onSelectLibrary={vi.fn()}
        />
        <GalleryView columns={2} />
      </>,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Select Primary Button' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Secondary Button' }));
    expect(screen.getByText('2 selected')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByText('2 selected')).not.toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Search components' }), 'does-not-exist');
    expect(screen.getByRole('status')).toHaveTextContent('No components match');
  });

  it('virtualizes the card collection only after it exceeds one hundred items', () => {
    const many = Array.from({ length: 101 }, (_, index) => component(
      `component-${index + 1}`,
      `Component ${index + 1}`,
    ));
    resetStore(many);

    render(<GalleryView columns={4} />);

    const grid = screen.getByTestId('component-grid');
    expect(grid).toHaveAttribute('data-virtualized', 'true');
    expect(within(grid).getAllByRole('article').length).toBeLessThan(101);
  });

  it('rolls an optimistic reorder back when persistence fails', async () => {
    reorderComponents.mockRejectedValueOnce(new Error('disk unavailable'));
    render(<GalleryView columns={3} />);
    const source = screen.getByRole('article', { name: 'Primary Button' });
    const target = screen.getByRole('article', { name: 'Primary Card' });

    fireEvent.dragStart(source, { dataTransfer: { setData: vi.fn(), effectAllowed: 'move' } });
    fireEvent.drop(target);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not reorder components'));
    expect(useAppStore.getState().components.map((item) => item.id)).toEqual(records.map((item) => item.id));
  });

  it('does not leave an older drag failure visible after the latest drag succeeds', async () => {
    let rejectFirst: ((error: Error) => void) | undefined;
    reorderComponents
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectFirst = reject; }))
      .mockResolvedValueOnce(undefined);
    render(<GalleryView columns={3} />);

    fireEvent.dragStart(screen.getByRole('article', { name: 'Primary Button' }), {
      dataTransfer: { setData: vi.fn(), effectAllowed: 'move' },
    });
    fireEvent.drop(screen.getByRole('article', { name: 'Primary Card' }));
    fireEvent.dragStart(screen.getByRole('article', { name: 'Secondary Button' }), {
      dataTransfer: { setData: vi.fn(), effectAllowed: 'move' },
    });
    fireEvent.drop(screen.getByRole('article', { name: 'Primary Button' }));

    rejectFirst?.(new Error('older reorder failed'));
    await waitFor(() => expect(reorderComponents).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(useAppStore.getState().components.map((item) => item.id)).toEqual([
      'component-3', 'component-1', 'component-2',
    ]);
  });

  it('reports the latest drag failure even when an older drag succeeded', async () => {
    let resolveFirst: (() => void) | undefined;
    reorderComponents
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFirst = resolve; }))
      .mockRejectedValueOnce(new Error('latest reorder failed'));
    render(<GalleryView columns={3} />);

    fireEvent.dragStart(screen.getByRole('article', { name: 'Primary Button' }), {
      dataTransfer: { setData: vi.fn(), effectAllowed: 'move' },
    });
    fireEvent.drop(screen.getByRole('article', { name: 'Primary Card' }));
    fireEvent.dragStart(screen.getByRole('article', { name: 'Secondary Button' }), {
      dataTransfer: { setData: vi.fn(), effectAllowed: 'move' },
    });
    fireEvent.drop(screen.getByRole('article', { name: 'Primary Button' }));

    resolveFirst?.();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not reorder components'));
  });

  it('does not show a pending reorder failure after switching to another library', async () => {
    let rejectPending: ((error: Error) => void) | undefined;
    const pendingPersistence = new Promise<void>((_resolve, reject) => { rejectPending = reject; });
    reorderComponents.mockReturnValueOnce(pendingPersistence);
    useAppStore.setState({ libraries: [library, secondaryLibrary] });
    render(<GalleryView columns={3} />);

    fireEvent.dragStart(screen.getByRole('article', { name: 'Primary Button' }), {
      dataTransfer: { setData: vi.fn(), effectAllowed: 'move' },
    });
    fireEvent.drop(screen.getByRole('article', { name: 'Primary Card' }));
    await waitFor(() => expect(reorderComponents).toHaveBeenCalledOnce());

    useAppStore.getState().setSelectedLibraryId(secondaryLibrary.id);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No components match'));

    await act(async () => {
      rejectPending?.(new Error('library A reorder failed'));
      await pendingPersistence.catch(() => undefined);
    });

    expect(useAppStore.getState().selectedLibraryId).toBe(secondaryLibrary.id);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('serializes overlapping reorders so persistence cannot finish out of order', async () => {
    let resolveFirst: (() => void) | undefined;
    reorderComponents
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(undefined);

    const first = useAppStore.getState().reorderComponents(library.id, [
      'component-2', 'component-3', 'component-1',
    ]);
    const second = useAppStore.getState().reorderComponents(library.id, [
      'component-3', 'component-1', 'component-2',
    ]);

    expect(reorderComponents).toHaveBeenCalledOnce();
    expect(useAppStore.getState().components.map((item) => item.id)).toEqual([
      'component-3', 'component-1', 'component-2',
    ]);

    resolveFirst?.();
    await first;
    await second;
    expect(reorderComponents).toHaveBeenCalledTimes(2);
    expect(reorderComponents).toHaveBeenNthCalledWith(2, library.id, [
      'component-3', 'component-1', 'component-2',
    ]);
  });

  it('rolls a failed later reorder back to the last successfully persisted order', async () => {
    let resolveFirst: (() => void) | undefined;
    reorderComponents
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFirst = resolve; }))
      .mockRejectedValueOnce(new Error('second reorder failed'));

    const first = useAppStore.getState().reorderComponents(library.id, [
      'component-2', 'component-3', 'component-1',
    ]);
    const second = useAppStore.getState().reorderComponents(library.id, [
      'component-3', 'component-1', 'component-2',
    ]);
    resolveFirst?.();
    await first;
    await expect(second).rejects.toThrow('second reorder failed');

    expect(useAppStore.getState().components.map((item) => item.id)).toEqual([
      'component-2', 'component-3', 'component-1',
    ]);
  });

  it('continues with the newest queued order when an earlier reorder fails', async () => {
    let rejectFirst: ((error: Error) => void) | undefined;
    reorderComponents
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectFirst = reject; }))
      .mockResolvedValueOnce(undefined);

    const firstReorder = useAppStore.getState().reorderComponents(library.id, [
      'component-2', 'component-3', 'component-1',
    ]);
    const secondReorder = useAppStore.getState().reorderComponents(library.id, [
      'component-3', 'component-1', 'component-2',
    ]);
    rejectFirst?.(new Error('first reorder failed'));

    await expect(firstReorder).rejects.toThrow('first reorder failed');
    await secondReorder;
    expect(useAppStore.getState().components.map((item) => item.id)).toEqual([
      'component-3', 'component-1', 'component-2',
    ]);
  });

  it('keeps concurrent edits and deleted membership when reorder rollback runs', async () => {
    let rejectReorder: ((error: Error) => void) | undefined;
    reorderComponents.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      rejectReorder = reject;
    }));
    const pending = useAppStore.getState().reorderComponents(library.id, [
      'component-2', 'component-3', 'component-1',
    ]);

    useAppStore.getState().updateComponentDraft({
      ...records[1],
      html: '<button>Edited while reordering</button>',
    });
    await useAppStore.getState().deleteComponent('component-1');
    rejectReorder?.(new Error('disk unavailable'));
    await expect(pending).rejects.toThrow('disk unavailable');

    expect(useAppStore.getState().components.map((item) => item.id)).toEqual([
      'component-2', 'component-3',
    ]);
    expect(useAppStore.getState().components[0].html).toBe('<button>Edited while reordering</button>');
  });

  it('preserves a completed save and a concurrent deletion across reorder rollback', async () => {
    let rejectReorder: ((error: Error) => void) | undefined;
    reorderComponents.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      rejectReorder = reject;
    }));
    const pendingReorder = useAppStore.getState().reorderComponents(library.id, [
      'component-2', 'component-3', 'component-1',
    ]);
    const edited = { ...records[1], html: '<button>Persisted during reorder</button>' };
    useAppStore.getState().updateComponentDraft(edited);

    await useAppStore.getState().saveComponent(edited);
    await useAppStore.getState().deleteComponent('component-1');
    rejectReorder?.(new Error('reorder failed after mutations'));
    await expect(pendingReorder).rejects.toThrow('reorder failed after mutations');

    expect(saveComponentApi).toHaveBeenCalledWith(expect.objectContaining({
      id: edited.id,
      html: edited.html,
    }));
    expect(useAppStore.getState().components.map((item) => [item.id, item.html])).toEqual([
      ['component-2', edited.html],
      ['component-3', records[2].html],
    ]);
  });
});
