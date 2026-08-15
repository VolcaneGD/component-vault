import { app, BrowserWindow, clipboard, dialog, ipcMain, protocol, screen, shell } from 'electron';
import { join } from 'node:path';
import { openDatabase, type DatabaseContext } from './database/database';
import { registerIpcHandlers } from './ipc/registerIpc';
import { createLibraryService } from './services/library';
import type { LibraryService } from './services/library';
import { createSettingsService } from './services/settings';
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

app.whenReady().then(() => {
  installPreviewProtocol(protocol, join(__dirname, '../renderer/preview'));
  databaseContext = openDatabase(join(app.getPath('userData'), 'component-vault.sqlite'));
  libraryService = createLibraryService(databaseContext);
  libraryService.startSession();
  deletionCleanupTimer = setInterval(() => {
    libraryService?.purgeExpiredDeletedComponents();
  }, 8_000);
  deletionCleanupTimer.unref();
  registerIpcHandlers({
    ipcMain,
    appVersion: () => app.getVersion(),
    electronVersion: () => process.versions.electron,
    libraries: libraryService,
    settings: createSettingsService(databaseContext),
    previewSecurity,
    clipboard,
    externalLinks: shell,
    dialogs: dialog,
  });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  if (deletionCleanupTimer) clearInterval(deletionCleanupTimer);
  deletionCleanupTimer = null;
  if (mainWindow && windowStateController) {
    windowStateController.flush(mainWindow as unknown as ManagedWindow);
  }
  libraryService?.markCleanShutdown();
  databaseContext?.close();
  databaseContext = null;
  libraryService = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
