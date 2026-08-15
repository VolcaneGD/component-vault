import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserWindowConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { createApplicationWindow } from '../../src/main/window';

let capturedOptions: BrowserWindowConstructorOptions | undefined;

class BrowserWindowDouble {
  webContents = {
    setWindowOpenHandler: vi.fn(),
    on: vi.fn(),
  };

  loadFile = vi.fn().mockResolvedValue(undefined);
  loadURL = vi.fn().mockResolvedValue(undefined);

  constructor(options: BrowserWindowConstructorOptions) {
    capturedOptions = options;
  }
}

describe('built preload path', () => {
  it('gives BrowserWindow a preload script emitted by the production build', () => {
    createApplicationWindow({
      BrowserWindow: BrowserWindowDouble,
      runtimeDirectory: resolve(process.cwd(), 'out', 'main'),
    });

    expect(capturedOptions?.webPreferences?.preload).toSatisfy(existsSync);
  });
});
