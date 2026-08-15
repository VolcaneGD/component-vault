import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/renderer/src/App';
import { defaultAppSettings } from '../../src/shared/contracts';
import { useAppStore } from '../../src/renderer/src/store/useAppStore';

const saveAppSettings = vi.fn().mockResolvedValue(defaultAppSettings());
const openExternal = vi.fn().mockResolvedValue(undefined);

const resetStore = () => useAppStore.setState({
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
  isHydrated: true,
  mutationVersion: 0,
});

beforeEach(() => {
  resetStore();
  saveAppSettings.mockClear();
  openExternal.mockClear();
  Object.defineProperty(window, 'componentVault', {
    configurable: true,
    value: {
      getAppSettings: vi.fn().mockResolvedValue(defaultAppSettings()),
      listLibraries: vi.fn().mockResolvedValue([]),
      saveAppSettings,
      getAppVersion: vi.fn().mockResolvedValue('1.0.0'),
      getElectronVersion: vi.fn().mockResolvedValue('43.4.0'),
      openExternal,
    },
  });
});

afterEach(() => {
  cleanup();
  resetStore();
});

describe('CommandPalette', () => {
  it('opens with Ctrl+K and switches view through a fuzzy command match', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.keyboard('{Control>}k{/Control}');
    const input = screen.getByRole('combobox', { name: 'Search commands' });
    await user.type(input, 'vw gllry');
    await user.keyboard('{Enter}');

    expect(screen.getByRole('main')).toHaveAttribute('data-view', 'gallery');
    await waitFor(() => expect(saveAppSettings).toHaveBeenCalledWith({ viewMode: 'gallery' }));
  });

  it('supports arrow navigation, Escape, and returns focus to the invoking control', async () => {
    const user = userEvent.setup();
    render(<App />);
    const trigger = screen.getByRole('button', { name: 'Open command palette' });
    trigger.focus();

    await user.click(trigger);
    await user.keyboard('{ArrowDown}{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('traps Tab and Shift+Tab on its only tabbable command input', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Open command palette' }));
    const input = screen.getByRole('combobox', { name: 'Search commands' });
    expect(input).toHaveFocus();

    await user.tab();
    expect(input).toHaveFocus();
    await user.tab({ shift: true });
    expect(input).toHaveFocus();
  });

  it('does not consume the Monaco Ctrl+K chord', async () => {
    const user = userEvent.setup();
    render(<App />);
    const monacoSurface = document.createElement('div');
    monacoSurface.className = 'monaco-editor';
    monacoSurface.tabIndex = 0;
    document.body.append(monacoSurface);
    monacoSurface.focus();

    await user.keyboard('{Control>}k{/Control}');

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    monacoSurface.remove();
  });

  it('opens About from Settings with runtime attribution and the complete PropertyHTML license', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const dialog = screen.getByRole('dialog', { name: 'About Component Vault' });
    expect(dialog).toHaveTextContent('Copyright (c) 2026 uni928');
    await waitFor(() => expect(dialog).toHaveTextContent('Electron 43.4.0'));
    await user.click(screen.getByText('Third-Party Notices and MIT License'));
    expect(dialog).toHaveTextContent('Permission is hereby granted, free of charge');
    expect(dialog).toHaveTextContent('OUT OF OR IN CONNECTION WITH THE SOFTWARE');

    await user.click(screen.getByRole('button', { name: 'Open PropertyHTML source' }));
    expect(openExternal).toHaveBeenCalledWith('https://github.com/uni928/PropertyHTML');
  });
});
