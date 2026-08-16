import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAppSettings } from '../../src/shared/contracts';
import { PreviewThemeToggle } from '../../src/renderer/src/features/preview/PreviewThemeToggle';
import { useAppStore } from '../../src/renderer/src/store/useAppStore';

const saveAppSettings = vi.fn().mockResolvedValue(defaultAppSettings());

beforeEach(() => {
  saveAppSettings.mockClear();
  Object.defineProperty(window, 'componentVault', {
    configurable: true,
    value: { saveAppSettings },
  });
  useAppStore.setState({ settings: { ...defaultAppSettings(), previewTheme: 'light' } });
});

afterEach(() => cleanup());

describe('PreviewThemeToggle', () => {
  it('switches to dark immediately and persists the shared preview canvas preference', async () => {
    const user = userEvent.setup();
    render(<PreviewThemeToggle />);

    await user.click(screen.getByRole('button', { name: 'Dark preview background' }));

    expect(screen.getByRole('button', { name: 'Dark preview background' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(saveAppSettings).toHaveBeenCalledWith({ previewTheme: 'dark' }));
  });
});
