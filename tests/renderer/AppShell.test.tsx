import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAppSettings, type AppSettings } from '../../src/shared/contracts';
import App from '../../src/renderer/src/App';
import { useAppStore } from '../../src/renderer/src/store/useAppStore';

const saveAppSettings = vi.fn().mockResolvedValue({ viewMode: 'gallery' });

const resetAppStore = () => useAppStore.setState({
  settings: defaultAppSettings(),
  libraries: [],
  selectedLibraryId: null,
  selectedComponentId: null,
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
