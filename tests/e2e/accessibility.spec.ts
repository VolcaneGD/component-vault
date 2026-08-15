import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('keeps preview errors reachable in the workbench preview panel', async () => {
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'component-vault-a11y-errors-'));
  const electronApp = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDirectory}`],
    cwd: process.cwd(),
  });

  try {
    const page = await electronApp.firstWindow();
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setBounds({ width: 1440, height: 900 });
    });
    await page.evaluate(async () => {
      const library = await window.componentVault.saveLibrary({ name: 'Accessibility', description: '' });
      const component = await window.componentVault.saveComponent({
        libraryId: library.id,
        name: 'Failing preview',
        description: '',
        category: 'Diagnostics',
        tags: [],
        html: '<button type="button">Preview</button>',
        css: '',
        javascript: 'throw new Error("Visual regression sentinel")',
        sourceType: 'manual',
        originalFileName: null,
        previewPolicy: {
          allowScripts: true,
          allowForms: false,
          allowPopups: false,
          externalNetworkEnabled: false,
          allowedOrigins: [],
        },
      });
      await window.componentVault.saveAppSettings({
        viewMode: 'workbench',
        lastLibraryId: library.id,
        lastComponentId: component.id,
      });
    });
    await page.reload();

    const errorConsole = page.getByRole('region', { name: 'Preview error console' });
    await expect(errorConsole.getByText('Uncaught Error: Visual regression sentinel')).toBeVisible();
    await errorConsole.evaluate((element) => element.scrollIntoView({ block: 'end' }));
    const consoleBox = await errorConsole.boundingBox();
    const viewportHeight = await page.evaluate(() => innerHeight);
    expect(consoleBox).not.toBeNull();
    expect(consoleBox!.y + consoleBox!.height).toBeLessThanOrEqual(viewportHeight + 1);

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setBounds({ width: 960, height: 640 });
    });
    await page.waitForTimeout(150);
    const compactLayout = await page.evaluate(() => ({
      viewportHeight: innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(compactLayout.documentWidth).toBeLessThanOrEqual(compactLayout.viewportWidth);
    expect(compactLayout.documentHeight).toBeLessThanOrEqual(compactLayout.viewportHeight);
  } finally {
    await electronApp.close();
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});

test('traps dialog focus, restores the trigger, and honors reduced motion', async () => {
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'component-vault-a11y-dialogs-'));
  const electronApp = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDirectory}`],
    cwd: process.cwd(),
  });

  try {
    const page = await electronApp.firstWindow();
    const commandTrigger = page.getByRole('button', { name: 'Open command palette' });
    await commandTrigger.focus();
    await page.keyboard.press('Control+K');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await expect(palette.getByRole('combobox', { name: 'Search commands' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(commandTrigger).toBeFocused();

    const settingsTrigger = page.getByRole('button', { name: 'Settings' });
    await settingsTrigger.click();
    const about = page.getByRole('dialog', { name: 'About Component Vault' });
    await expect(about).toBeVisible();
    await expect(about.getByRole('button', { name: 'Close About' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(settingsTrigger).toBeFocused();

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reducedMotion = await page.evaluate(() => {
      const button = document.querySelector<HTMLButtonElement>('.new-component-button')!;
      const style = getComputedStyle(button);
      return {
        matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
        animationDuration: style.animationDuration,
        transitionDuration: style.transitionDuration,
      };
    });
    expect(reducedMotion.matches).toBe(true);
    expect(parseFloat(reducedMotion.animationDuration)).toBeLessThanOrEqual(0.00001);
    expect(parseFloat(reducedMotion.transitionDuration)).toBeLessThanOrEqual(0.00001);
  } finally {
    await electronApp.close();
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});
