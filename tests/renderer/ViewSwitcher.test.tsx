import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultAppSettings } from '../../src/shared/contracts';
import App from '../../src/renderer/src/App';
import { useAppStore } from '../../src/renderer/src/store/useAppStore';

const resetAppStore = () => useAppStore.setState({
  settings: defaultAppSettings(),
  selectedLibraryId: null,
  selectedComponentId: null,
  isHydrated: false,
  mutationVersion: 0,
});

beforeEach(resetAppStore);
afterEach(() => {
  cleanup();
  resetAppStore();
});

describe('View Switcher', () => {
  it('provides labelled modes with a visible selected state', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: 'A Workbench' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'B Gallery' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'C Adaptive Studio' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('moves focus and activates the next view with the keyboard', async () => {
    const user = userEvent.setup();
    render(<App />);

    screen.getByRole('button', { name: 'B Gallery' }).focus();
    await user.keyboard('{Enter}');

    expect(screen.getByRole('main')).toHaveAttribute('data-view', 'gallery');
    expect(screen.getByRole('button', { name: 'B Gallery' })).toHaveFocus();
  });

  it('moves from Workbench to Gallery by Tab and activates it with Space', async () => {
    const user = userEvent.setup();
    render(<App />);

    screen.getByRole('button', { name: 'A Workbench' }).focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'B Gallery' })).toHaveFocus();
    await user.keyboard(' ');

    expect(screen.getByRole('main')).toHaveAttribute('data-view', 'gallery');
  });
});
