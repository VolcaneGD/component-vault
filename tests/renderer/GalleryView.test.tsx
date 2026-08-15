import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  resetStore();
  Object.defineProperty(window, 'componentVault', {
    configurable: true,
    value: {
      saveAppSettings,
      reorderComponents,
      deleteComponent,
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
    expect(within(cards[0]).getByText('Primary', { selector: 'mark' })).toBeVisible();
    expect(within(cards[0]).getByText('Button')).toBeVisible();
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
});
