import { app, BrowserWindow, protocol } from 'electron';
import { resolve } from 'node:path';
import {
  createPreviewSecurityController,
  type PreviewWebContents,
} from '../../../src/main/security/previewSecurity';
import {
  installPreviewProtocol,
  PREVIEW_DOCUMENT_URL,
  registerPreviewScheme,
} from '../../../src/main/security/previewProtocol';

const blockedUrls: string[] = [];
let testWindow: BrowserWindow | null = null;

Object.assign(globalThis, { __componentVaultBlockedPreviewUrls: blockedUrls });

const previewDirectory = resolve(process.cwd(), 'src/renderer/public/preview');
const parentPath = resolve(process.cwd(), 'tests/electron/fixtures/preview-parent.html');
const security = createPreviewSecurityController({
  onBlockedRequest: (details) => blockedUrls.push(details.url),
});
registerPreviewScheme(protocol);

void app.whenReady().then(async () => {
  installPreviewProtocol(protocol, previewDirectory);
  const preload = process.env.COMPONENT_VAULT_TEST_PRELOAD;
  if (!preload) throw new Error('Missing test preload path');
  testWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  security.attach(
    testWindow.webContents as unknown as PreviewWebContents,
    PREVIEW_DOCUMENT_URL,
  );
  await testWindow.loadFile(parentPath);
});

app.on('window-all-closed', () => app.quit());
