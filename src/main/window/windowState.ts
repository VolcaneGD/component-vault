import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { WindowState } from '../../shared/contracts';

const minimumSize = { width: 960, height: 640 };
const saveDelayMs = 300;

export interface DisplayWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowDisplay {
  id: string | number;
  workArea: DisplayWorkArea;
}

export interface WindowDisplayProvider {
  getAllDisplays: () => WindowDisplay[];
  getPrimaryDisplay: () => WindowDisplay;
}

export interface WindowStateStore {
  read: () => WindowState | null;
  write: (state: WindowState) => void;
}

export interface ManagedWindow {
  getNormalBounds: () => DisplayWorkArea;
  isMaximized: () => boolean;
  maximize: () => void;
  on: (event: 'move' | 'resize', listener: () => void) => unknown;
  once: (event: 'ready-to-show', listener: () => void) => unknown;
  setBounds: (bounds: DisplayWorkArea) => void;
}

export interface WindowStateControllerDependencies {
  displays: WindowDisplayProvider;
  fallback: Pick<WindowState, 'width' | 'height'>;
  store: WindowStateStore;
}

const toFiniteInteger = (value: number, fallback: number): number =>
  Number.isFinite(value) ? Math.round(value) : fallback;

const intersectionArea = (bounds: DisplayWorkArea, workArea: DisplayWorkArea): number => {
  const width = Math.max(0, Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x));
  const height = Math.max(0, Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y));
  return width * height;
};

const displayWithLargestIntersection = (
  bounds: DisplayWorkArea,
  displays: WindowDisplay[],
): WindowDisplay | null => {
  let largestIntersection = 0;
  let matchingDisplay: WindowDisplay | null = null;

  for (const display of displays) {
    const area = intersectionArea(bounds, display.workArea);
    if (area > largestIntersection) {
      largestIntersection = area;
      matchingDisplay = display;
    }
  }

  return matchingDisplay;
};

const centeredBounds = (workArea: DisplayWorkArea, width: number, height: number): DisplayWorkArea => ({
  x: workArea.x + Math.round((workArea.width - width) / 2),
  y: workArea.y + Math.round((workArea.height - height) / 2),
  width,
  height,
});

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum);

export const clampWindowState = (
  state: WindowState,
  displays: WindowDisplay[],
  fallback: Pick<WindowState, 'width' | 'height'>,
): WindowState => {
  const primary = displays[0];
  if (!primary) {
    return {
      x: 0,
      y: 0,
      width: Math.max(minimumSize.width, toFiniteInteger(fallback.width, minimumSize.width)),
      height: Math.max(minimumSize.height, toFiniteInteger(fallback.height, minimumSize.height)),
      isMaximized: state.isMaximized,
      displayId: null,
    };
  }

  const savedBounds: DisplayWorkArea = {
    x: toFiniteInteger(state.x ?? primary.workArea.x, primary.workArea.x),
    y: toFiniteInteger(state.y ?? primary.workArea.y, primary.workArea.y),
    width: Math.max(minimumSize.width, toFiniteInteger(state.width, fallback.width)),
    height: Math.max(minimumSize.height, toFiniteInteger(state.height, fallback.height)),
  };
  const display = displayWithLargestIntersection(savedBounds, displays) ?? primary;
  const width = Math.min(savedBounds.width, display.workArea.width);
  const height = Math.min(savedBounds.height, display.workArea.height);
  const restoredBounds = displayWithLargestIntersection(savedBounds, displays)
    ? {
        x: clamp(savedBounds.x, display.workArea.x, display.workArea.x + display.workArea.width - width),
        y: clamp(savedBounds.y, display.workArea.y, display.workArea.y + display.workArea.height - height),
        width,
        height,
      }
    : centeredBounds(display.workArea, Math.min(Math.max(fallback.width, minimumSize.width), display.workArea.width), Math.min(Math.max(fallback.height, minimumSize.height), display.workArea.height));

  return {
    ...restoredBounds,
    isMaximized: state.isMaximized,
    displayId: String(display.id),
  };
};

const isWindowState = (value: unknown): value is WindowState => {
  if (typeof value !== 'object' || value === null) return false;

  const state = value as Record<string, unknown>;
  return (
    typeof state.width === 'number' &&
    typeof state.height === 'number' &&
    (typeof state.x === 'number' || state.x === null) &&
    (typeof state.y === 'number' || state.y === null) &&
    typeof state.isMaximized === 'boolean' &&
    (typeof state.displayId === 'string' || state.displayId === null || state.displayId === undefined)
  );
};

export const createFileWindowStateStore = (filePath: string): WindowStateStore => ({
  read: () => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
      return isWindowState(parsed) ? { ...parsed, displayId: parsed.displayId ?? null } : null;
    } catch {
      return null;
    }
  },
  write: state => {
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify(state), 'utf8');
    } catch {
      // State persistence must never prevent the application from closing.
    }
  },
});

export class WindowStateController {
  private restoredState: WindowState | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  public constructor(private readonly dependencies: WindowStateControllerDependencies) {}

  public restore(): WindowState {
    const displays = this.orderedDisplays();
    const savedState = this.dependencies.store.read();
    this.restoredState = clampWindowState(
      savedState ?? {
        x: null,
        y: null,
        width: this.dependencies.fallback.width,
        height: this.dependencies.fallback.height,
        isMaximized: false,
        displayId: null,
      },
      displays,
      this.dependencies.fallback,
    );
    return this.restoredState;
  }

  public track(window: ManagedWindow): void {
    const state = this.restoredState ?? this.restore();
    window.setBounds({ x: state.x ?? 0, y: state.y ?? 0, width: state.width, height: state.height });
    window.once('ready-to-show', () => {
      if (state.isMaximized) window.maximize();
    });
    window.on('move', () => this.scheduleSave(window));
    window.on('resize', () => this.scheduleSave(window));
  }

  private orderedDisplays(): WindowDisplay[] {
    const primary = this.dependencies.displays.getPrimaryDisplay();
    return [primary, ...this.dependencies.displays.getAllDisplays().filter(display => String(display.id) !== String(primary.id))];
  }

  private scheduleSave(window: ManagedWindow): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const bounds = window.getNormalBounds();
      const display = displayWithLargestIntersection(bounds, this.orderedDisplays()) ?? this.dependencies.displays.getPrimaryDisplay();
      this.dependencies.store.write({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isMaximized: window.isMaximized(),
        displayId: String(display.id),
      });
      this.saveTimer = null;
    }, saveDelayMs);
  }
}
