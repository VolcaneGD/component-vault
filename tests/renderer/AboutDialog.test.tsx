import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { AboutDialog } from '../../src/renderer/src/features/about/AboutDialog';

afterEach(cleanup);

it('traps focus, closes with Escape, and restores the originating trigger', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const origin = document.createElement('button');
  origin.textContent = 'Settings origin';
  document.body.append(origin);
  origin.focus();
  Object.defineProperty(window, 'componentVault', {
    configurable: true,
    value: {
      getAppVersion: vi.fn().mockResolvedValue('1.0.0'),
      getElectronVersion: vi.fn().mockResolvedValue('43.4.0'),
      openExternal: vi.fn().mockResolvedValue(undefined),
    },
  });
  const { unmount } = render(<AboutDialog onClose={onClose} returnFocus={origin} />);

  const close = screen.getByRole('button', { name: 'Close About' });
  expect(close).toHaveFocus();
  await user.tab({ shift: true });
  expect(screen.getByText('Third-Party Notices and MIT License')).toHaveFocus();
  await user.tab();
  expect(close).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledOnce();
  unmount();
  expect(origin).toHaveFocus();
  origin.remove();
});
