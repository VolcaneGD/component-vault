import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ExportPayload } from '../../src/shared/contracts';
import { IPC_CHANNELS, registerIpcHandlers } from '../../src/main/ipc/registerIpc';
import { parseComponentVaultHtml } from '../../src/main/services/exportHtml';

const exportPayload = (): ExportPayload => ({
  format: 'component-vault',
  version: 1,
  library: { name: 'UI Kit', description: '' },
  components: [{
    name: 'Button', description: '', category: '', tags: [],
    html: '<button>Save</button>', css: 'button{color:red}', javascript: '',
    previewPolicy: {
      allowScripts: false, allowForms: false, allowPopups: false,
      externalNetworkEnabled: false, allowedOrigins: [],
    },
  }],
});

const setup = (destination: string, canceled = false) => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const clipboardWrite = vi.fn();
  const mainFrame = {};
  registerIpcHandlers({
    ipcMain: { handle: (channel, listener) => handlers.set(channel, listener as (...args: unknown[]) => unknown) },
    appVersion: () => '1.0.0',
    libraries: {} as never,
    settings: {} as never,
    previewSecurity: {} as never,
    clipboard: { writeText: clipboardWrite },
    dialogs: { showSaveDialog: vi.fn().mockResolvedValue(canceled
      ? { canceled: true }
      : { canceled: false, filePath: destination }) },
  });
  return {
    handlers,
    clipboardWrite,
    event: { senderFrame: mainFrame, sender: { mainFrame, id: 1 } },
  };
};

describe('export IPC', () => {
  it('copies validated text only from the main renderer frame', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'component-vault-ipc-copy-'));
    try {
      const { handlers, clipboardWrite, event } = setup(join(directory, 'unused.html'));
      await handlers.get(IPC_CHANNELS.clipboardWriteText)?.(event, '<button>Copy</button>');
      expect(clipboardWrite).toHaveBeenCalledWith('<button>Copy</button>');
      await expect(handlers.get(IPC_CHANNELS.clipboardWriteText)?.(
        { ...event, senderFrame: {} },
        'blocked',
      )).rejects.toThrow('main renderer frame');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('shows a save dialog and atomically writes a parseable standalone file', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'component-vault-ipc-export-'));
    const destination = join(directory, 'library.html');
    try {
      const { handlers, event } = setup(destination);
      const result = await handlers.get(IPC_CHANNELS.exportSaveStandalone)?.(event, exportPayload());
      expect(result).toMatchObject({ ok: true, path: destination });
      expect(parseComponentVaultHtml(readFileSync(destination, 'utf8'))).toMatchObject({
        library: { name: 'UI Kit' },
        components: [expect.objectContaining({ name: 'Button' })],
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('sanitizes the CSS suggestion and writes only the supplied CSS', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'component-vault-ipc-css-'));
    const destination = join(directory, 'button.css');
    try {
      const { handlers, event } = setup(destination);
      const result = await handlers.get(IPC_CHANNELS.exportSaveCss)?.(
        event,
        '../CON?.css',
        'button { color: red; }',
      );
      expect(result).toMatchObject({ ok: true, path: destination });
      expect(readFileSync(destination, 'utf8')).toBe('button { color: red; }');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('returns a bounded status contract without the generated HTML on cancellation or failure', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'component-vault-ipc-contract-'));
    const failingDestination = join(directory, 'existing-directory');
    mkdirSync(failingDestination);
    try {
      const cancelled = setup(join(directory, 'cancelled.html'), true);
      const cancellation = await cancelled.handlers.get(IPC_CHANNELS.exportSaveStandalone)?.(
        cancelled.event,
        exportPayload(),
      ) as Record<string, unknown>;
      expect(cancellation).toEqual({ ok: false, cancelled: true, message: 'Save cancelled' });
      expect(cancellation).not.toHaveProperty('html');

      const failed = setup(failingDestination);
      const failure = await failed.handlers.get(IPC_CHANNELS.exportSaveStandalone)?.(
        failed.event,
        exportPayload(),
      ) as Record<string, unknown>;
      expect(failure).toMatchObject({ ok: false, message: expect.any(String) });
      expect(failure).not.toHaveProperty('html');
      expect(JSON.stringify(failure).length).toBeLessThan(1_024);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
