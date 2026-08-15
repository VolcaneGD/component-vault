import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAppSettings, type ComponentRecord, type LibraryRecord } from '../../src/shared/contracts';
import { AdaptiveStudio } from '../../src/renderer/src/features/studio/AdaptiveStudio';
import { useAppStore } from '../../src/renderer/src/store/useAppStore';

vi.mock('../../src/renderer/src/features/editor/MonacoEditorAdapter', () => ({
  MonacoEditor: ({ language, value, onChange }: {
    language: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label={`${language} code`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
  mountComponentModels: vi.fn(),
  disposeComponentModels: vi.fn(),
}));

const library: LibraryRecord = {
  id: 'library-1',
  name: 'Interface kit',
  description: '',
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
};

const makeComponent = (id: string, name: string): ComponentRecord => ({
  id,
  libraryId: library.id,
  name,
  description: '',
  category: 'UI',
  tags: ['layout'],
  html: `<article>${name}</article>`,
  css: '',
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
});

const first = makeComponent('component-1', 'Card');
const second = makeComponent('component-2', 'Banner');
const saveAppSettings = vi.fn().mockResolvedValue(defaultAppSettings());
const saveComponent = vi.fn(async (input) => ({ ...first, ...input } as ComponentRecord));

const setWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
};

const resetStore = () => useAppStore.setState({
  settings: defaultAppSettings(),
  libraries: [library],
  components: [first, second],
  componentsLibraryId: library.id,
  selectedLibraryId: library.id,
  selectedComponentId: first.id,
  selectedComponentIds: [],
  searchQuery: '',
  selectedTags: [],
  isHydrated: true,
  mutationVersion: 0,
});

beforeEach(() => {
  setWidth(1440);
  resetStore();
  saveAppSettings.mockClear();
  saveComponent.mockClear();
  saveComponent.mockImplementation(async (input) => ({ ...first, ...input } as ComponentRecord));
  Object.defineProperty(window, 'componentVault', {
    configurable: true,
    value: {
      saveAppSettings,
      saveComponent,
      deleteComponent: vi.fn().mockResolvedValue(true),
      configurePreviewNetwork: vi.fn().mockResolvedValue(undefined),
      releasePreviewNetwork: vi.fn().mockResolvedValue(undefined),
      onPreviewRequestBlocked: vi.fn(() => () => undefined),
    },
  });
});

afterEach(() => {
  cleanup();
  resetStore();
  setWidth(1024);
});

describe('AdaptiveStudio', () => {
  it('normalizes and clamps unusable three-pane ratios', () => {
    render(<AdaptiveStudio ratios={[0.05, 0.9, 0.05]} />);

    expect(screen.getByTestId('adaptive-studio')).toHaveStyle({
      '--studio-list-ratio': '0.16',
      '--studio-editor-ratio': '0.62',
      '--studio-preview-ratio': '0.22',
    });
    expect(screen.getByRole('region', { name: 'Component editor' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Live preview pane' })).toBeVisible();
  });

  it('resizes a pane from the keyboard and persists normalized ratios', async () => {
    render(<AdaptiveStudio ratios={[0.24, 0.42, 0.34]} />);

    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize component list and editor' }), {
      key: 'ArrowRight',
    });

    await waitFor(() => expect(saveAppSettings).toHaveBeenCalledWith({
      studioPaneRatios: [0.29, 0.37, 0.34],
    }));
  });

  it('collapses the list into a drawer below 1180 pixels and keeps selection usable', async () => {
    const user = userEvent.setup();
    setWidth(1100);
    render(<AdaptiveStudio ratios={[0.24, 0.42, 0.34]} />);

    expect(screen.queryByRole('listbox', { name: 'Studio components' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open component list' }));
    const drawer = screen.getByRole('dialog', { name: 'Component list' });
    expect(drawer).toBeVisible();

    await user.click(screen.getByRole('option', { name: 'Banner' }));
    expect(useAppStore.getState().selectedComponentId).toBe(second.id);
    expect(screen.queryByRole('dialog', { name: 'Component list' })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Banner')).toBeVisible();
  });

  it('flushes an edited component before switching and preserves its draft when returning', async () => {
    const user = userEvent.setup();
    render(<AdaptiveStudio ratios={[0.24, 0.42, 0.34]} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'html code' }), {
      target: { value: '<article>Unsaved studio edit</article>' },
    });

    await user.click(screen.getByRole('option', { name: 'Banner' }));
    await waitFor(() => expect(saveComponent).toHaveBeenCalledWith(expect.objectContaining({
      id: first.id,
      html: '<article>Unsaved studio edit</article>',
    })));

    await user.click(screen.getByRole('option', { name: 'Card' }));
    expect(screen.getByRole('textbox', { name: 'html code' })).toHaveValue(
      '<article>Unsaved studio edit</article>',
    );
  });

  it('lets a returned dirty draft be manually retried when the switch flush failed', async () => {
    const user = userEvent.setup();
    saveComponent.mockRejectedValueOnce(new Error('temporary disk error'));
    render(<AdaptiveStudio ratios={[0.24, 0.42, 0.34]} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'html code' }), {
      target: { value: '<article>Retry this edit</article>' },
    });

    await user.click(screen.getByRole('option', { name: 'Banner' }));
    await waitFor(() => expect(saveComponent).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('option', { name: 'Card' }));
    await user.click(screen.getByRole('button', { name: 'Save component' }));

    await waitFor(() => expect(saveComponent).toHaveBeenCalledTimes(2));
    expect(saveComponent).toHaveBeenLastCalledWith(expect.objectContaining({
      id: first.id,
      html: '<article>Retry this edit</article>',
    }));
  });

  it('traps focus in the modal drawer, closes on Escape, and restores trigger focus', async () => {
    const user = userEvent.setup();
    setWidth(1100);
    render(<AdaptiveStudio ratios={[0.24, 0.42, 0.34]} />);
    const trigger = screen.getByRole('button', { name: 'Open component list' });

    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Component list' });
    const selectedOption = screen.getByRole('option', { name: 'Card' });
    await waitFor(() => expect(selectedOption).toHaveFocus());

    const close = screen.getByRole('button', { name: 'Close component list' });
    const lastOption = screen.getByRole('option', { name: 'Banner' });
    lastOption.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(lastOption).toHaveFocus();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Component list' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('switches to the drawer layout when a resize crosses the breakpoint', () => {
    render(<AdaptiveStudio ratios={[0.24, 0.42, 0.34]} />);
    expect(screen.getByRole('listbox', { name: 'Studio components' })).toBeVisible();

    setWidth(1000);
    fireEvent(window, new Event('resize'));

    expect(screen.getByRole('button', { name: 'Open component list' })).toBeVisible();
    expect(screen.queryByRole('listbox', { name: 'Studio components' })).not.toBeInTheDocument();
  });
});
