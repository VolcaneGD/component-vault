import { chromium, expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
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

test('retains oversized edits and saves an exact UTF-8 boundary after correction', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'component-vault-viewer-limits-'));
  const exportedPath = join(directory, 'library.html');
  await writeFile(exportedPath, await createStandaloneHtml(payload), 'utf8');
  const browser = await chromium.launch({ channel: 'chrome' });

  try {
    const context = await browser.newContext({ acceptDownloads: true });
    await context.setOffline(true);
    const page = await context.newPage();
    await page.goto(pathToFileURL(exportedPath).href);
    await expect(page.getByRole('button', { name: '通信ボタン', exact: true })).toBeVisible();

    const tooLarge = 'x'.repeat(2_000_001);
    await page.getByLabel('Component code').evaluate((element, value) => {
      const textarea = element as HTMLTextAreaElement;
      textarea.value = value;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }, tooLarge);
    await expect(page.locator('#status')).toContainText('HTML exceeds 2,000,000 UTF-8 bytes');
    expect((await page.locator('#status').textContent())?.length).toBeLessThan(200);

    let downloadCount = 0;
    page.on('download', () => { downloadCount += 1; });
    await page.getByRole('button', { name: 'Save edited HTML' }).click();
    await page.waitForTimeout(300);
    expect(downloadCount).toBe(0);
    await expect(page.getByLabel('Component code')).toHaveValue(tooLarge);
    await expect(page.locator('#status')).toContainText('Edits are retained');

    await page.locator('#file-input').setInputFiles({
      name: 'oversized.html',
      mimeType: 'text/html',
      buffer: Buffer.from(tooLarge, 'utf8'),
    });
    await expect(page.locator('#status')).toContainText('HTML exceeds 2,000,000 UTF-8 bytes');
    expect((await page.locator('#status').textContent())?.length).toBeLessThan(200);
    await expect(page.locator('#items > li')).toHaveCount(payload.components.length);
    await expect(page.getByLabel('Component code')).toHaveValue(tooLarge);

    const exactBoundary = `${'界'.repeat(666_666)}ab`;
    await page.getByLabel('Component code').evaluate((element, value) => {
      const textarea = element as HTMLTextAreaElement;
      textarea.value = value;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }, exactBoundary);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save edited HTML' }).click();
    const download = await downloadPromise;
    const savedPath = await download.path();
    const restored = parseComponentVaultHtml(await readFile(savedPath!, 'utf8'));

    expect(restored?.components[0].html).toBe(exactBoundary);
  } finally {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects hostile existing bundles within bounded offline viewer errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'component-vault-hostile-viewer-'));
  const baseHtml = await createStandaloneHtml(payload);
  const validComponent = payload.components[0];
  const encoded = (component: unknown): string => gzipSync(
    Buffer.from(JSON.stringify(component), 'utf8'),
  ).toString('base64');
  const entry = (data: string) => ({ encoding: 'gzip-base64', data });
  const envelope = (components: Array<{ encoding: string; data: string }>) => ({
    format: 'component-vault',
    version: 1,
    library: payload.library,
    components,
  });
  const largeComponent = { ...validComponent, html: 'x'.repeat(1_900_000), css: '', javascript: '' };
  const fixtures = [
    {
      name: 'component-count.html',
      source: replaceEnvelope(baseHtml, envelope(Array.from({ length: 1_001 }, () => entry(encoded(validComponent))))),
    },
    {
      name: 'metadata.html',
      source: replaceEnvelope(baseHtml, envelope([entry(encoded({
        ...validComponent,
        description: 'x'.repeat(10_001),
      }))])),
    },
    {
      name: 'single-bomb.html',
      source: replaceEnvelope(baseHtml, envelope([entry(encoded({
        ...validComponent,
        padding: 'x'.repeat((6 * 1024 * 1024) + 1),
      }))])),
    },
    {
      name: 'cumulative.html',
      source: replaceEnvelope(baseHtml, envelope(Array.from({ length: 7 }, (_, index) => entry(encoded({
        ...largeComponent,
        name: `Large ${index}`,
      }))))),
    },
    {
      name: 'source-size.html',
      source: baseHtml.replace('</body>', `<!--${'x'.repeat(25 * 1024 * 1024)}--></body>`),
    },
  ];
  const browser = await chromium.launch({ channel: 'chrome' });

  try {
    const context = await browser.newContext();
    await context.setOffline(true);
    for (const fixture of fixtures) {
      const path = join(directory, fixture.name);
      await writeFile(path, fixture.source, 'utf8');
      const page = await context.newPage();
      await page.goto(pathToFileURL(path).href);
      await expect(page.locator('#status')).toContainText('exceeds safe offline limits');
      expect((await page.locator('#status').textContent())?.length).toBeLessThan(200);
      await expect(page.locator('#items > li')).toHaveCount(0);
      await page.close();
    }
  } finally {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('handles missing and malformed embedded data without uncaught offline errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'component-vault-malformed-viewer-'));
  const baseHtml = await createStandaloneHtml(payload);
  const fixtures = [
    {
      name: 'missing-data-node.html',
      source: baseHtml.replace(
        /<script id="component-vault-data" type="application\/json">[^<]+<\/script>/,
        '',
      ),
    },
    { name: 'truncated-json.html', source: replaceDataPayload(baseHtml, '{"format":') },
    { name: 'wrong-top-level.html', source: replaceDataPayload(baseHtml, '[]') },
  ];
  const browser = await chromium.launch({ channel: 'chrome' });

  try {
    const context = await browser.newContext();
    await context.setOffline(true);
    await context.addInitScript(() => {
      const target = window as typeof window & { __unhandledRejections: string[] };
      target.__unhandledRejections = [];
      window.addEventListener('unhandledrejection', (event) => {
        target.__unhandledRejections.push(String(event.reason));
      });
    });
    for (const fixture of fixtures) {
      const path = join(directory, fixture.name);
      await writeFile(path, fixture.source, 'utf8');
      const page = await context.newPage();
      const pageErrors: Error[] = [];
      page.on('pageerror', (error) => pageErrors.push(error));
      await page.goto(pathToFileURL(path).href);
      await expect(page.locator('#status')).toHaveText(
        'This Component Vault file is damaged or unsupported.',
      );
      expect((await page.locator('#status').textContent())?.length).toBeLessThan(200);
      await expect(page.locator('#items > li')).toHaveCount(0);
      await expect(page.locator('#preview')).toHaveAttribute('srcdoc', '');
      expect(pageErrors).toEqual([]);
      expect(await page.evaluate(() => (
        window as typeof window & { __unhandledRejections: string[] }
      ).__unhandledRejections)).toEqual([]);
      await page.close();
    }
  } finally {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});

const replaceEnvelope = (html: string, envelope: unknown): string => html.replace(
  /(<script id="component-vault-data" type="application\/json">)[^<]+(<\/script>)/,
  `$1${JSON.stringify(envelope)}$2`,
);

const replaceDataPayload = (html: string, data: string): string => html.replace(
  /(<script id="component-vault-data" type="application\/json">)[^<]+(<\/script>)/,
  (_match, opening: string, closing: string) => `${opening}${data}${closing}`,
);
