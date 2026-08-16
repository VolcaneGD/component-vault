import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const executablePath = process.env.COMPONENT_VAULT_EXECUTABLE
  ? resolve(process.env.COMPONENT_VAULT_EXECUTABLE)
  : null;

const packagedTest = executablePath ? test : test.skip;

packagedTest('the packaged app restores a saved component and normal window bounds', async () => {
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'component-vault-packaged-'));
  const processState: {
    runningApp: Awaited<ReturnType<typeof electron.launch>> | null;
  } = { runningApp: null };

  const launch = async () => {
    processState.runningApp = await electron.launch({
      executablePath: executablePath!,
      args: [`--user-data-dir=${userDataDirectory}`],
    });
    const page = await processState.runningApp.firstWindow();
    await expect(page).toHaveTitle('Component Vault');
    return { app: processState.runningApp, page };
  };

  const closeGracefully = async () => {
    if (!processState.runningApp) return;
    const app = processState.runningApp;
    processState.runningApp = null;
    const closed = app.waitForEvent('close');
    const windows = app.windows();
    if (windows[0]) await windows[0].close();
    await closed;
  };

  try {
    const firstRun = await launch();
    const savedBounds = await firstRun.app.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const workArea = screen.getPrimaryDisplay().workArea;
      const target = {
        x: workArea.x + 32,
        y: workArea.y + 32,
        width: Math.min(1088, workArea.width - 64),
        height: Math.min(704, workArea.height - 64),
      };
      window.unmaximize();
      window.setBounds(target);
      return window.getBounds();
    });

    await firstRun.page.getByRole('button', { name: 'New component' }).click();
    const dialog = firstRun.page.getByRole('dialog', { name: 'Create a component' });
    await dialog.getByLabel('New library name').fill('Packaged smoke library');
    await dialog.getByRole('button', { name: 'Create library' }).click();
    await dialog.getByRole('button', { name: 'Start coding' }).click();

    await firstRun.page.getByLabel('Component name').fill('Packaged persistence button');
    const editor = firstRun.page.locator('.monaco-editor .native-edit-context');
    await editor.focus();
    await firstRun.page.keyboard.insertText('<button type="button">Persisted</button>');
    await firstRun.page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => firstRun.page.evaluate(async () => {
      const library = (await window.componentVault.listLibraries())
        .find((item) => item.name === 'Packaged smoke library');
      if (!library) return false;
      return (await window.componentVault.listComponents(library.id))
        .some((item) => item.name === 'Packaged persistence button');
    })).toBe(true);

    await firstRun.page.waitForTimeout(400);
    await closeGracefully();

    const secondRun = await launch();
    await expect(secondRun.page.getByLabel('Component name')).toHaveValue('Packaged persistence button');
    await expect.poll(() => secondRun.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getBounds())).toEqual(savedBounds);
    await closeGracefully();
  } finally {
    if (processState.runningApp) await processState.runningApp.close();
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});
