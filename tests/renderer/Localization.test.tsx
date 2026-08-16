import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../../src/renderer/src/App';
import { defaultAppSettings } from '../../src/shared/contracts';
import { useAppStore } from '../../src/renderer/src/store/useAppStore';

const saveAppSettings = vi.fn().mockResolvedValue(defaultAppSettings());

beforeEach(() => {
  useAppStore.setState({
    settings: defaultAppSettings(), libraries: [], components: [], componentsLibraryId: null,
    selectedLibraryId: null, selectedComponentId: null, selectedComponentIds: [], draftOrigins: {},
    searchQuery: '', selectedTags: [], isHydrated: true, mutationVersion: 0,
  });
  saveAppSettings.mockClear();
  Object.defineProperty(window, 'componentVault', {
    configurable: true,
    value: {
      getAppSettings: vi.fn().mockResolvedValue(defaultAppSettings()),
      listLibraries: vi.fn().mockResolvedValue([]),
      saveAppSettings,
    },
  });
});

afterEach(cleanup);

it('switches the Settings dialog and workspace controls to Japanese and persists the choice', async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole('button', { name: 'Settings' }));
  expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  await user.click(screen.getByRole('radio', { name: '日本語' }));

  expect(screen.getByRole('button', { name: '設定' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '新しいコンポーネント' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '設定を閉じる' }));
  await user.click(screen.getByRole('button', { name: 'インポート' }));
  expect(screen.getByRole('dialog', { name: 'HTML コンポーネントをインポート' })).toHaveTextContent('対象ライブラリ');
  await waitFor(() => expect(saveAppSettings).toHaveBeenCalledWith({ language: 'ja' }));
});
