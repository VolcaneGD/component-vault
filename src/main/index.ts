import { app, BrowserWindow, clipboard, dialog, ipcMain, protocol, screen, shell } from 'electron';
import { join } from 'node:path';
import { openDatabase, type DatabaseContext } from './database/database';
import { registerIpcHandlers } from './ipc/registerIpc';
import { createLibraryService } from './services/library';
import type { LibraryService } from './services/library';
import { createSettingsService } from './services/settings';
import { commandRegistry } from './cli/commandRegistry';
import { startCliBroker, type CliBroker } from './cli/broker';
import { OperationLock } from './cli/operationLock';
import { executeCommand } from '../shared/cliProtocol';
import type { LibraryChangedEvent } from '../shared/contracts';
import { createPreviewSecurityController } from './security/previewSecurity';
import { installPreviewProtocol, registerPreviewScheme } from './security/previewProtocol';
import {
  createApplicationWindow,
  type ApplicationWindow,
  type ApplicationWindowConstructor,
} from './window';
import {
  createFileWindowStateStore,
  type ManagedWindow,
  WindowStateController,
} from './window/windowState';

let mainWindow: ApplicationWindow | null = null;
let windowStateController: WindowStateController | null = null;
let databaseContext: DatabaseContext | null = null;
let libraryService: LibraryService | null = null;
let deletionCleanupTimer: NodeJS.Timeout | null = null;
let operationLock: OperationLock | null = null;
let cliBroker: CliBroker | null = null;
let shutdownInProgress = false;
const previewSecurity = createPreviewSecurityController();
registerPreviewScheme(protocol);

const createWindow = (): void => {
  windowStateController = new WindowStateController({
    displays: screen,
    fallback: { width: 1440, height: 960 },
    store: createFileWindowStateStore(join(app.getPath('userData'), 'window-state.json')),
  });
  windowStateController.restore();
  mainWindow = createApplicationWindow({
    BrowserWindow: BrowserWindow as unknown as ApplicationWindowConstructor,
    runtimeDirectory: __dirname,
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
    previewSecurity,
  });
  windowStateController.track(mainWindow as unknown as ManagedWindow);
};

app.whenReady().then(async () => {
  try {
    operationLock = await OperationLock.acquire(app.getPath('userData'));
  } catch {
    app.quit();
    return;
  }
  installPreviewProtocol(protocol, join(__dirname, '../renderer/preview'));
  databaseContext = openDatabase(join(app.getPath('userData'), 'component-vault.sqlite'));
  libraryService = createLibraryService(databaseContext);
  libraryService.startSession();
  deletionCleanupTimer = setInterval(() => {
    libraryService?.purgeExpiredDeletedComponents();
  }, 8_000);
  deletionCleanupTimer.unref();
  const settings = createSettingsService(databaseContext);
  registerIpcHandlers({
    ipcMain,
    appVersion: () => app.getVersion(),
    electronVersion: () => process.versions.electron,
    libraries: libraryService,
    settings,
    previewSecurity,
    clipboard,
    externalLinks: shell,
    dialogs: dialog,
  });
  const registry = commandRegistry({ libraries: libraryService, settings });
  cliBroker = await startCliBroker({
    userDataPath: app.getPath('userData'),
    execute: request => executeCommand(registry, request),
    isMutation: command => registry.some(item => item.name === command && item.mutates),
    onMutation: (request, response) => {
      if (!response.ok) return;
      const libraryId = changedLibraryId(request, response.result);
      const library = libraryId ? libraryService?.listLibraries().find(item => item.id === libraryId) : undefined;
      const event: LibraryChangedEvent = {
        libraryId,
        revision: library?.revision ?? null,
        command: request.command,
      };
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('library:changed', event);
      }
    },
  });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', event => {
  if (shutdownInProgress) return;
  event.preventDefault();
  shutdownInProgress = true;
  void shutdown().finally(() => app.exit(0));
});

const shutdown = async (): Promise<void> => {
  if (deletionCleanupTimer) clearInterval(deletionCleanupTimer);
  deletionCleanupTimer = null;
  if (mainWindow && windowStateController) {
    windowStateController.flush(mainWindow as unknown as ManagedWindow);
  }
  libraryService?.markCleanShutdown();
  databaseContext?.close();
  databaseContext = null;
  libraryService = null;
  await cliBroker?.stop().catch(() => undefined);
  cliBroker = null;
  await operationLock?.release().catch(() => undefined);
  operationLock = null;
};

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

const changedLibraryId = (
  request: { command: string; input?: Record<string, unknown> },
  result: unknown,
): string | null => {
  const input = request.input ?? {};
  if (typeof input.libraryId === 'string') return input.libraryId;
  if (request.command.startsWith('library ') && typeof input.id === 'string') return input.id;
  if (request.command === 'library create' || request.command === 'library update') {
    const library = input.library;
    if (library && typeof library === 'object' && typeof (library as { id?: unknown }).id === 'string') {
      return (library as { id: string }).id;
    }
    if (result && typeof result === 'object' && typeof (result as { id?: unknown }).id === 'string') {
      return (result as { id: string }).id;
    }
  }
  if (result && typeof result === 'object' && typeof (result as { libraryId?: unknown }).libraryId === 'string') {
    return (result as { libraryId: string }).libraryId;
  }
  return null;
};
