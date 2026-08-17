import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const expectPreviewCanvas = async (frame: ReturnType<Page['frameLocator']>, color: string) => {
  await expect(frame.locator('body')).toHaveCSS('background-color', color);
};

test('keeps the live preview canvas theme synchronized across workspace modes', async () => {
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'component-vault-preview-theme-'));
  const electronApp = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDirectory}`],
    cwd: process.cwd(),
  });

  try {
    const page = await electronApp.firstWindow();
    await page.evaluate(async () => {
      const library = await window.componentVault.saveLibrary({ name: 'Preview themes', description: '' });
      const component = await window.componentVault.saveComponent({
        libraryId: library.id,
        name: 'Canvas sample',
        description: '',
        category: '',
        tags: [],
        html: '<hr>',
        css: '',
        javascript: '',
        sourceType: 'manual',
        originalFileName: null,
        previewPolicy: {
          allowScripts: false,
          allowForms: false,
          allowPopups: false,
          externalNetworkEnabled: false,
          allowedOrigins: [],
        },
      });
      await window.componentVault.saveAppSettings({
        viewMode: 'workbench',
        previewTheme: 'light',
        lastLibraryId: library.id,
        lastComponentId: component.id,
      });
    });
    await page.reload();

    const workbenchFrame = page.frameLocator('iframe[title="Component preview"]');
    await expectPreviewCanvas(workbenchFrame, 'rgb(255, 255, 255)');
    await page.getByRole('button', { name: 'Dark preview background' }).click();
    await expectPreviewCanvas(workbenchFrame, 'rgb(18, 24, 38)');

    await page.getByRole('button', { name: 'B Gallery' }).click();
    const galleryFrame = page.frameLocator('iframe[title^="Preview of"]');
    await expectPreviewCanvas(galleryFrame, 'rgb(18, 24, 38)');
    await page.getByRole('button', { name: 'Light preview background' }).click();
    await expectPreviewCanvas(galleryFrame, 'rgb(255, 255, 255)');

    await page.getByRole('button', { name: 'C Adaptive Studio' }).click();
    const studioFrame = page.frameLocator('iframe[title="Component preview"]');
    await expectPreviewCanvas(studioFrame, 'rgb(255, 255, 255)');
    await page.getByRole('button', { name: 'Dark preview background' }).click();
    await expectPreviewCanvas(studioFrame, 'rgb(18, 24, 38)');

    await page.getByRole('button', { name: 'A Workbench' }).click();
    await expectPreviewCanvas(page.frameLocator('iframe[title="Component preview"]'), 'rgb(18, 24, 38)');
  } finally {
    await electronApp.close();
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});
