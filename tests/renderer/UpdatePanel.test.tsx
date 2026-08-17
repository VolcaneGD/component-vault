import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { UpdatePanel } from '../../src/renderer/src/features/settings/UpdatePanel';
import type { UpdateSnapshot } from '../../src/shared/contracts';

afterEach(cleanup);

it('shows explicit download and restart actions from safe updater status snapshots', async () => {
  let publish: ((snapshot: UpdateSnapshot) => void) | undefined;
  const downloadUpdate = vi.fn().mockResolvedValue({ state: 'downloading', currentVersion: '1.0.8', percent: 0 });
  const installUpdate = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window, 'componentVault', {
    configurable: true,
    value: {
      getUpdateStatus: vi.fn().mockResolvedValue({ state: 'available', currentVersion: '1.0.8', availableVersion: '1.0.9' }),
      downloadUpdate,
      installUpdate,
      onUpdateStatus: vi.fn((listener: (snapshot: UpdateSnapshot) => void) => { publish = listener; return () => undefined; }),
    },
  });

  render(<UpdatePanel language="en" />);
  expect(await screen.findByText('Version 1.0.9 is available.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Download update' }));
  await waitFor(() => expect(downloadUpdate).toHaveBeenCalledOnce());

  publish?.({ state: 'downloaded', currentVersion: '1.0.8', availableVersion: '1.0.9' });
  fireEvent.click(await screen.findByRole('button', { name: 'Restart and install' }));
  expect(installUpdate).toHaveBeenCalledOnce();
});

it('clearly keeps portable builds on the manual update path', async () => {
  Object.defineProperty(window, 'componentVault', {
    configurable: true,
    value: {
      getUpdateStatus: vi.fn().mockResolvedValue({ state: 'unsupported', currentVersion: '1.0.8' }),
      onUpdateStatus: vi.fn(() => () => undefined),
    },
  });
  render(<UpdatePanel language="en" />);
  expect(await screen.findByText('Portable builds are updated manually.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /update/i })).not.toBeInTheDocument();
});
