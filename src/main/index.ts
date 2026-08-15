import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'node:path';
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
  });
  windowStateController.track(mainWindow as unknown as ManagedWindow);
};

app.whenReady().then(() => {
  ipcMain.handle('app:get-version', () => app.getVersion());
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  if (mainWindow && windowStateController) {
    windowStateController.flush(mainWindow as unknown as ManagedWindow);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
