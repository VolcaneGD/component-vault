import { join } from 'node:path';
import type { BrowserWindowConstructorOptions } from 'electron';
import type {
  PreviewSecurityController,
  PreviewWebContents,
} from './security/previewSecurity';
import { PREVIEW_DOCUMENT_URL } from './security/previewProtocol';

export interface ApplicationWindow {
  webContents: {
    setWindowOpenHandler: (handler: () => { action: 'deny' }) => void;
    on: (event: 'will-navigate', listener: (event: { preventDefault: () => void }) => void) => void;
  };
  loadFile: (filePath: string) => Promise<void>;
  loadURL: (url: string) => Promise<void>;
}

export type ApplicationWindowConstructor = new (
  options: BrowserWindowConstructorOptions,
) => ApplicationWindow;

export interface CreateApplicationWindowOptions {
  BrowserWindow: ApplicationWindowConstructor;
  runtimeDirectory: string;
  rendererUrl?: string;
  previewSecurity?: PreviewSecurityController;
}

export const createApplicationWindow = ({
  BrowserWindow,
  runtimeDirectory,
  rendererUrl,
  previewSecurity,
}: CreateApplicationWindowOptions): ApplicationWindow => {
  const applicationWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: join(runtimeDirectory, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  applicationWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  applicationWindow.webContents.on('will-navigate', event => event.preventDefault());
  previewSecurity?.attach(
    applicationWindow.webContents as unknown as PreviewWebContents,
    PREVIEW_DOCUMENT_URL,
  );

  if (rendererUrl) {
    void applicationWindow.loadURL(rendererUrl);
  } else {
    void applicationWindow.loadFile(join(runtimeDirectory, '../renderer/index.html'));
  }

  return applicationWindow;
};
