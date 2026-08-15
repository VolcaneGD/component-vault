import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/renderer/src/App';

const saveAppSettings = vi.fn().mockResolvedValue({ viewMode: 'gallery' });

beforeEach(() => {
  saveAppSettings.mockClear();
  Object.defineProperty(window, 'componentVault', {
    configurable: true,
    value: { saveAppSettings },
  });
});

afterEach(cleanup);

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
});
