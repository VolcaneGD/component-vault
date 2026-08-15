import { describe, expect, it, vi } from 'vitest';
import {
  clampWindowState,
  type ManagedWindow,
  type WindowStateControllerDependencies,
  WindowStateController,
} from '../../src/main/window/windowState';

const primaryDisplay = {
  id: 'primary',
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
};

describe('clampWindowState', () => {
  it('moves an off-screen saved window onto the primary display', () => {
    const restored = clampWindowState(
      { x: 5000, y: 5000, width: 1200, height: 800, isMaximized: false, displayId: 'old' },
      [primaryDisplay],
      { width: 1280, height: 820 },
    );

    expect(restored.x).toBeGreaterThanOrEqual(0);
    expect(restored.y).toBeGreaterThanOrEqual(0);
    expect(restored.width).toBeLessThanOrEqual(1920);
    expect(restored.displayId).toBe('primary');
  });

  it('preserves maximized state while restoring normal bounds', () => {
    const restored = clampWindowState(
      { x: 320, y: 160, width: 1200, height: 800, isMaximized: true, displayId: 'primary' },
      [primaryDisplay],
      { width: 1280, height: 820 },
    );

    expect(restored).toMatchObject({
      x: 320,
      y: 160,
      width: 1200,
      height: 800,
      isMaximized: true,
    });
  });

  it('keeps a partially visible window entirely on its intersecting display', () => {
    const restored = clampWindowState(
      { x: -120, y: 80, width: 1200, height: 800, isMaximized: false, displayId: 'primary' },
      [primaryDisplay],
      { width: 1280, height: 820 },
    );

    expect(restored).toMatchObject({ x: 0, y: 80, width: 1200, height: 800 });
  });

  it('enforces the 960 by 640 minimum size', () => {
    const restored = clampWindowState(
      { x: 100, y: 100, width: 400, height: 300, isMaximized: false, displayId: 'primary' },
      [primaryDisplay],
      { width: 1280, height: 820 },
    );

    expect(restored.width).toBe(960);
    expect(restored.height).toBe(640);
  });
});

describe('WindowStateController', () => {
  it('debounces normal bounds saves and maximizes after ready-to-show', () => {
    vi.useFakeTimers();
    const writes: unknown[] = [];
    const window = createManagedWindow();
    const controller = new WindowStateController(createDependencies(writes));

    controller.restore();
    controller.track(window);
    window.emit('ready-to-show');
    window.emit('move');
    window.emit('resize');

    expect(writes).toHaveLength(0);
    expect(window.maximize).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(300);

    expect(writes).toEqual([
      {
        x: 320,
        y: 160,
        width: 1200,
        height: 800,
        isMaximized: true,
        displayId: 'primary',
      },
    ]);
    vi.useRealTimers();
  });

  it('saves pending normal bounds once when closed before the debounce expires', () => {
    vi.useFakeTimers();
    const writes: unknown[] = [];
    const window = createManagedWindow({ x: 48, y: 96, width: 1100, height: 700 });
    const controller = new WindowStateController(createDependencies(writes));

    controller.restore();
    controller.track(window);
    window.emit('move');
    window.emit('close');

    expect(writes).toEqual([
      {
        x: 48,
        y: 96,
        width: 1100,
        height: 700,
        isMaximized: true,
        displayId: 'primary',
      },
    ]);

    vi.advanceTimersByTime(300);

    expect(writes).toHaveLength(1);
    vi.useRealTimers();
  });
});

const createDependencies = (writes: unknown[]): WindowStateControllerDependencies => ({
  displays: {
    getAllDisplays: () => [primaryDisplay],
    getPrimaryDisplay: () => primaryDisplay,
  },
  fallback: { width: 1280, height: 820 },
  store: {
    read: () => ({
      x: 320,
      y: 160,
      width: 1200,
      height: 800,
      isMaximized: true,
      displayId: 'primary',
    }),
    write: state => writes.push(state),
  },
});

const createManagedWindow = (
  bounds = { x: 320, y: 160, width: 1200, height: 800 },
): ManagedWindow & { emit: (event: string) => void } => {
  const listeners = new Map<string, () => void>();
  const window = {
    getNormalBounds: () => bounds,
    isMaximized: () => true,
    maximize: vi.fn(),
    on: (event: string, listener: () => void) => listeners.set(event, listener),
    once: (event: string, listener: () => void) => listeners.set(event, listener),
    setBounds: vi.fn(),
    emit: (event: string) => listeners.get(event)?.(),
  };

  return window;
};
