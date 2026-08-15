import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../../src/renderer/src/App';

afterEach(cleanup);

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
});
