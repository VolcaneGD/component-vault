import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const fillActiveMonaco = async (page: Page, value: string) => {
  const editor = page.locator('.monaco-editor .native-edit-context');
  await editor.focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(value);
};

test('persists the complete create, import, edit, view, copy, export, and re-import workflow', async () => {
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'component-vault-workflow-'));
  const exportedPath = join(userDataDirectory, 'portable-library.html');
  let electronApp: ElectronApplication | null = null;

  const launch = async () => {
    electronApp = await electron.launch({ args: ['.', `--user-data-dir=${userDataDirectory}`], cwd: process.cwd() });
    const page = await electronApp.firstWindow();
    await expect(page).toHaveTitle('Component Vault');
    return page;
  };

  try {
    let page = await launch();
    await page.getByRole('button', { name: 'New component' }).click();
    const createDialog = page.getByRole('dialog', { name: 'Create a component' });
    await createDialog.getByLabel('New library name').fill('Foundation');
    await createDialog.getByRole('button', { name: 'Create library' }).click();
    await createDialog.getByLabel('New library name').fill('Product UI');
    await createDialog.getByRole('button', { name: 'Create library' }).click();
    await createDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'Foundation' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Product UI' })).toBeVisible();

    await page.getByRole('button', { name: 'Import' }).click();
    const importDialog = page.getByRole('dialog', { name: 'Import HTML components' });
    await importDialog.locator('select[aria-label="Target library"]').selectOption({ label: 'Foundation' });
    await importDialog.locator('input[type="file"]').setInputFiles([
      resolve('tests/fixtures/import/full-document.html'),
      resolve('tests/fixtures/import/shift-jis.html'),
    ]);
    await expect(importDialog.getByText('Ready')).toHaveCount(2);
    await importDialog.getByRole('button', { name: 'Add 2 components' }).click();
    await expect(importDialog.getByText('Added')).toHaveCount(2);
    await importDialog.getByRole('button', { name: 'Close dialog' }).click();

    await page.getByRole('button', { name: 'New component' }).click();
    const codeDialog = page.getByRole('dialog', { name: 'Create a component' });
    await codeDialog.locator('select[aria-label="Target library"]').selectOption({ label: 'Product UI' });
    await codeDialog.getByRole('button', { name: 'Start coding' }).click();
    await page.getByLabel('Component name').fill('Launch button');
    await fillActiveMonaco(page, '<button id="launch" type="button">Launch</button>');
    await page.getByRole('tab', { name: 'CSS' }).click();
    await fillActiveMonaco(page, '#launch { padding: 12px 20px; background: rebeccapurple; color: white; }');
    await page.getByRole('tab', { name: 'JavaScript' }).click();
    await fillActiveMonaco(page, 'document.querySelector("#launch")?.setAttribute("data-ready", "yes");');
    await page.getByText('Details & preview permissions').click();
    await page.getByText('Scripts', { exact: true }).click();
    await page.getByRole('button', { name: 'Save component' }).click();
    await expect(page.frameLocator('iframe[title="Component preview"]').locator('#launch'))
      .toHaveAttribute('data-ready', 'yes');

    const workbenchSplitter = page.getByRole('separator', { name: 'Resize editor and preview' });
    const initialSplit = Number(await workbenchSplitter.getAttribute('aria-valuenow'));
    await workbenchSplitter.focus();
    await page.keyboard.press('ArrowDown');
    await expect(workbenchSplitter).toHaveAttribute('aria-valuenow', String(initialSplit + 5));

    await page.getByRole('button', { name: 'B Gallery' }).click();
    await page.getByLabel('Gallery columns').selectOption('4');
    await expect(page.getByLabel('Gallery columns')).toHaveValue('4');
    await page.getByRole('button', { name: 'C Adaptive Studio' }).click();
    await expect(page.getByRole('region', { name: 'Adaptive Studio workspace' })).toBeVisible();

    const savedBounds = await electronApp!.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const workArea = screen.getPrimaryDisplay().workArea;
      window.setBounds({
        x: workArea.x + 24,
        y: workArea.y + 24,
        width: Math.min(1120, workArea.width - 48),
        height: Math.min(720, workArea.height - 48),
      });
      return window.getBounds();
    });
    await page.waitForTimeout(400);
    await electronApp!.close();
    electronApp = null;

    page = await launch();
    await expect(page.getByRole('button', { name: 'C Adaptive Studio' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => electronApp!.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getBounds())).toEqual(savedBounds);
    await page.getByRole('button', { name: 'B Gallery' }).click();
    await expect(page.getByLabel('Gallery columns')).toHaveValue('4');
    await page.getByRole('button', { name: 'A Workbench' }).click();
    await expect(page.getByRole('separator', { name: 'Resize editor and preview' }))
      .toHaveAttribute('aria-valuenow', String(initialSplit + 5));

    await page.getByRole('button', { name: 'Export' }).click();
    const exportDialog = page.getByRole('dialog', { name: 'Export standalone HTML' });
    for (const [buttonName, expected] of [
      ['Copy HTML', '<button id="launch"'],
      ['Copy CSS', '#launch {'],
      ['Copy JavaScript', 'data-ready'],
    ] as const) {
      await exportDialog.getByRole('button', { name: buttonName, exact: true }).click();
      await expect.poll(() => electronApp!.evaluate(({ clipboard }) => clipboard.readText()))
        .toContain(expected);
    }
    await electronApp!.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, exportedPath);
    await exportDialog.getByRole('button', { name: 'Save standalone HTML' }).click();
    await expect(exportDialog.getByRole('status')).toContainText(exportedPath);
    expect(await readFile(exportedPath, 'utf8')).toContain('component-vault-data');
    await exportDialog.getByRole('button', { name: 'Close export dialog' }).click();

    const beforeReimport = await page.evaluate(async () => {
      const library = (await window.componentVault.listLibraries()).find((item) => item.name === 'Foundation')!;
      return (await window.componentVault.listComponents(library.id)).length;
    });
    await page.getByRole('button', { name: 'Import' }).click();
    const reimportDialog = page.getByRole('dialog', { name: 'Import HTML components' });
    await reimportDialog.locator('select[aria-label="Target library"]').selectOption({ label: 'Foundation' });
    await reimportDialog.locator('input[type="file"]').setInputFiles(exportedPath);
    await expect(reimportDialog.getByText('Component Vault library detected')).toBeVisible();
    await reimportDialog.getByRole('button', { name: 'Add 1 component' }).click();
    await expect(reimportDialog.getByText('Added')).toBeVisible();
    const afterReimport = await page.evaluate(async () => {
      const library = (await window.componentVault.listLibraries()).find((item) => item.name === 'Foundation')!;
      return (await window.componentVault.listComponents(library.id)).length;
    });
    expect(afterReimport).toBe(beforeReimport + 1);
  } finally {
    await (electronApp as ElectronApplication | null)?.close();
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});
