import { app, BrowserWindow, ipcMain } from 'electron';
import {
  createApplicationWindow,
  type ApplicationWindow,
  type ApplicationWindowConstructor,
} from './window';

let mainWindow: ApplicationWindow | null = null;

const createWindow = (): void => {
  mainWindow = createApplicationWindow({
    BrowserWindow: BrowserWindow as unknown as ApplicationWindowConstructor,
    runtimeDirectory: __dirname,
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
  });
};

app.whenReady().then(() => {
  ipcMain.handle('app:get-version', () => app.getVersion());
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
