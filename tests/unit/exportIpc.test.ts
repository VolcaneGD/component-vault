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
  const openExternal = vi.fn().mockResolvedValue(undefined);
  const recovery = {
    libraryId: '7aa4a429-da7d-4ea0-bf8e-4deca38e95aa',
    componentId: 'a19979d8-cb60-4eb8-bc5f-c905ba14adf0',
    completedAt: '2026-08-15T00:00:01.000Z',
  };
  const getRecoverySnapshot = vi.fn(() => recovery);
  const ackRecoverySnapshot = vi.fn((candidate) =>
    JSON.stringify(candidate) === JSON.stringify(recovery));
  const mainFrame = {};
  registerIpcHandlers({
    ipcMain: { handle: (channel, listener) => handlers.set(channel, listener as (...args: unknown[]) => unknown) },
    appVersion: () => '1.0.0',
    electronVersion: () => '43.4.0',
    libraries: { getRecoverySnapshot, ackRecoverySnapshot } as never,
    settings: {} as never,
    previewSecurity: {} as never,
    clipboard: { writeText: clipboardWrite },
    externalLinks: { openExternal },
    dialogs: { showSaveDialog: vi.fn().mockResolvedValue(canceled
      ? { canceled: true }
      : { canceled: false, filePath: destination }) },
  });
  return {
    handlers,
    clipboardWrite,
    openExternal,
    recovery,
    getRecoverySnapshot,
    ackRecoverySnapshot,
    event: { senderFrame: mainFrame, sender: { mainFrame, id: 1 } },
  };
};

describe('export IPC', () => {
  it('returns recovery idempotently and validates acknowledgement from the main frame', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'component-vault-ipc-recovery-'));
    try {
      const { handlers, event, recovery, getRecoverySnapshot, ackRecoverySnapshot } = setup(
        join(directory, 'unused.html'),
      );
      expect(await handlers.get(IPC_CHANNELS.appGetRecoverySnapshot)?.(event)).toEqual(recovery);
      expect(await handlers.get(IPC_CHANNELS.appGetRecoverySnapshot)?.(event)).toEqual(recovery);
      expect(getRecoverySnapshot).toHaveBeenCalledTimes(2);
      expect(await handlers.get(IPC_CHANNELS.appAckRecoverySnapshot)?.(event, recovery)).toBe(true);
      expect(ackRecoverySnapshot).toHaveBeenCalledWith(recovery);
      await expect(handlers.get(IPC_CHANNELS.appAckRecoverySnapshot)?.(
        { ...event, senderFrame: {} },
        recovery,
      )).rejects.toThrow('main renderer frame');
      await expect(handlers.get(IPC_CHANNELS.appAckRecoverySnapshot)?.(
        event,
        { ...recovery, completedAt: 'not-a-date' },
      )).rejects.toThrow('recovery completed timestamp');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('opens only the attributed PropertyHTML source from the main renderer frame', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'component-vault-ipc-link-'));
    try {
      const { handlers, openExternal, event } = setup(join(directory, 'unused.html'));
      await handlers.get(IPC_CHANNELS.appOpenExternal)?.(event, 'https://github.com/uni928/PropertyHTML');
      expect(openExternal).toHaveBeenCalledWith('https://github.com/uni928/PropertyHTML');
      await expect(handlers.get(IPC_CHANNELS.appOpenExternal)?.(
        event,
        'https://github.com/uni928/PropertyHTML.evil.example',
      )).rejects.toThrow('not allowed');
      await expect(handlers.get(IPC_CHANNELS.appOpenExternal)?.(
        { ...event, senderFrame: {} },
        'https://github.com/uni928/PropertyHTML',
      )).rejects.toThrow('main renderer frame');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

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
