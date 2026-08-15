import { chromium, expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ExportPayload } from '../../src/shared/contracts';
import { createStandaloneHtml, parseComponentVaultHtml } from '../../src/main/services/exportHtml';

const payload: ExportPayload = {
  format: 'component-vault',
  version: 1,
  library: { name: 'オフライン UI', description: 'Portable components' },
  components: [
    {
      name: '通信ボタン', description: '', category: 'Buttons', tags: ['日本語'],
      html: '<button id="action">通信</button>', css: '#action { color: rebeccapurple; }',
      javascript: 'document.querySelector("#action")?.setAttribute("data-ready", "yes");',
      previewPolicy: {
        allowScripts: true, allowForms: false, allowPopups: false,
        externalNetworkEnabled: false, allowedOrigins: [],
      },
    },
    {
      name: 'Status Card', description: '', category: 'Cards', tags: [],
      html: '<article>Status</article>', css: 'article { padding: 1rem; }', javascript: '',
      previewPolicy: {
        allowScripts: false, allowForms: false, allowPopups: false,
        externalNetworkEnabled: false, allowedOrigins: [],
      },
    },
  ],
};

test('edits and saves the standalone library while the browser is offline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'component-vault-standalone-'));
  const exportedPath = join(directory, 'library.html');
  const addedPath = join(directory, 'added.html');
  await writeFile(exportedPath, await createStandaloneHtml(payload), 'utf8');
  await writeFile(addedPath, '<section>Added offline</section>', 'utf8');
  const browser = await chromium.launch({ channel: 'chrome' });

  try {
    const context = await browser.newContext({ acceptDownloads: true });
    await context.setOffline(true);
    const page = await context.newPage();
    await page.goto(pathToFileURL(exportedPath).href);

    await expect(page.getByRole('button', { name: '通信ボタン', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Status Card', exact: true })).toBeVisible();
    await expect(page.locator('#preview')).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(page.locator('#preview')).not.toHaveAttribute('sandbox', /allow-same-origin/);
    await expect(page.locator('#preview').contentFrame().locator('#action')).toHaveAttribute('data-ready', 'yes');

    await page.getByLabel('Component name').fill('更新済みボタン');
    await page.getByLabel('Component code').fill('<button id="updated">更新済み</button>');
    await expect(page.locator('#preview').contentFrame().locator('#updated')).toHaveText('更新済み');

    await page.locator('#file-input').setInputFiles(addedPath);
    await expect(page.getByRole('button', { name: 'added', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Move up' }).click();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save edited HTML' }).click();
    const download = await downloadPromise;
    const savedPath = await download.path();
    expect(savedPath).not.toBeNull();
    const restored = parseComponentVaultHtml(await readFile(savedPath!, 'utf8'));

    expect(restored?.components.map((component) => component.name)).toEqual([
      '更新済みボタン',
      'added',
      'Status Card',
    ]);
    expect(restored?.components[0].html).toBe('<button id="updated">更新済み</button>');
    expect(restored?.components[1].html).toBe('<section>Added offline</section>');
  } finally {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});
