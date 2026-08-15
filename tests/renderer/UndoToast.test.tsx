import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UndoToast } from '../../src/renderer/src/features/feedback/UndoToast';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('UndoToast', () => {
  it('restores before the eight-second window expires', async () => {
    vi.useFakeTimers();
    const onUndo = vi.fn().mockResolvedValue(undefined);
    const onExpire = vi.fn().mockResolvedValue(undefined);
    render(
      <UndoToast
        label="Primary Button"
        expiresAt={Date.now() + 8_000}
        onUndo={onUndo}
        onExpire={onExpire}
      />,
    );

    screen.getByRole('button', { name: 'Undo delete Primary Button' }).click();
    await act(async () => undefined);

    expect(onUndo).toHaveBeenCalledOnce();
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('permanently finalizes the delete when the undo window expires', async () => {
    vi.useFakeTimers();
    const onExpire = vi.fn().mockResolvedValue(undefined);
    render(
      <UndoToast
        label="Primary Button"
        expiresAt={Date.now() + 8_000}
        onUndo={vi.fn()}
        onExpire={onExpire}
      />,
    );

    await act(() => vi.advanceTimersByTimeAsync(8_001));

    expect(onExpire).toHaveBeenCalledOnce();
  });

  it('still finalizes at expiry when an undo attempt fails', async () => {
    vi.useFakeTimers();
    const onExpire = vi.fn().mockResolvedValue(undefined);
    render(
      <UndoToast
        label="Primary Button"
        expiresAt={Date.now() + 8_000}
        onUndo={vi.fn().mockRejectedValue(new Error('database busy'))}
        onExpire={onExpire}
      />,
    );

    screen.getByRole('button', { name: 'Undo delete Primary Button' }).click();
    await act(async () => undefined);
    await act(() => vi.advanceTimersByTimeAsync(8_001));

    expect(onExpire).toHaveBeenCalledOnce();
  });
});
