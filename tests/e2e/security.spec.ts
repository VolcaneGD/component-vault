import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('keeps renderer and preview code outside Node, Electron, files, and unapproved origins', async () => {
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'component-vault-security-'));
  const electronApp = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDirectory}`],
    cwd: process.cwd(),
  });

  try {
    const page = await electronApp.firstWindow();
    const rendererBoundary = await page.evaluate(async () => {
      const types = {
        require: typeof (globalThis as { require?: unknown }).require,
        process: typeof (globalThis as { process?: unknown }).process,
        module: typeof (globalThis as { module?: unknown }).module,
        electron: typeof (globalThis as { electron?: unknown }).electron,
        bridge: typeof window.componentVault,
      };
      const localFileBlocked = await fetch('file:///C:/Windows/win.ini')
        .then(() => false, () => true);
      return { ...types, localFileBlocked };
    });
    expect(rendererBoundary).toEqual({
      require: 'undefined',
      process: 'undefined',
      module: 'undefined',
      electron: 'undefined',
      bridge: 'object',
      localFileBlocked: true,
    });

    await page.evaluate(async () => {
      const library = await window.componentVault.saveLibrary({ name: 'Security', description: '' });
      const component = await window.componentVault.saveComponent({
        libraryId: library.id,
        name: 'Sandbox probe',
        description: '',
        category: 'Diagnostics',
        tags: [],
        html: '<output id="security-report">Checking</output>',
        css: '',
        javascript: `
          const report = document.querySelector('#security-report');
          report.dataset.require = typeof require;
          report.dataset.process = typeof process;
          report.dataset.electron = typeof window.electron;
          Promise.all([
            fetch('file:///C:/Windows/win.ini').then(() => 'allowed', () => 'blocked'),
            fetch('https://unapproved.example/probe').then(() => 'allowed', () => 'blocked'),
          ]).then(([file, network]) => {
            report.dataset.file = file;
            report.dataset.network = network;
            report.textContent = 'Checked';
          });
        `,
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

    const frame = page.frameLocator('iframe[title="Component preview"]');
    const report = frame.locator('#security-report');
    await expect(report).toHaveText('Checked');
    await expect(report).toHaveAttribute('data-require', 'undefined');
    await expect(report).toHaveAttribute('data-process', 'undefined');
    await expect(report).toHaveAttribute('data-electron', 'undefined');
    await expect(report).toHaveAttribute('data-file', 'blocked');
    await expect(report).toHaveAttribute('data-network', 'blocked');

    const preview = page.locator('iframe[title="Component preview"]');
    await expect(preview).toHaveAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
    await expect(preview).not.toHaveAttribute('sandbox', /allow-same-origin|allow-popups|allow-top-navigation/);
    await expect(preview).toHaveAttribute('src', /^component-vault-preview:\/\/sandbox\/preview\.html#/);
    await expect(page.getByText('Blocked external preview resource').first()).toBeVisible();
  } finally {
    await electronApp.close();
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});
