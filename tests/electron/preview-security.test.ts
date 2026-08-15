// @vitest-environment node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';

let electronApplication: ElectronApplication | null = null;
let bundleDirectory: string | null = null;

afterEach(async () => {
  await electronApplication?.close();
  electronApplication = null;
  if (bundleDirectory) rmSync(bundleDirectory, { force: true, recursive: true });
  bundleDirectory = null;
});

describe('real Electron preview isolation', () => {
  it('executes the static child without privileged globals and cancels HTTPS self-navigation pre-request', async () => {
    bundleDirectory = mkdtempSync(join(tmpdir(), 'component-vault-preview-electron-'));
    const mainBundle = join(bundleDirectory, 'main.cjs');
    const preloadBundle = join(bundleDirectory, 'preload.cjs');
    await Promise.all([
      build({
        entryPoints: [resolve('tests/electron/fixtures/preview-security-main.ts')],
        outfile: mainBundle,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: ['electron'],
      }),
      build({
        entryPoints: [resolve('tests/electron/fixtures/preview-preload.ts')],
        outfile: preloadBundle,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: ['electron'],
      }),
    ]);

    electronApplication = await electron.launch({
      args: [mainBundle],
      env: {
        ...process.env,
        COMPONENT_VAULT_TEST_PRELOAD: preloadBundle,
      } as Record<string, string>,
    });
    const page = await electronApplication.firstWindow();
    const previewUrl = 'component-vault-preview://sandbox/preview.html';
    const blockedUrl = 'https://example.com/component-vault-preview-blocked';

    expect(await electronApplication.evaluate(({ BrowserWindow }) => (
      BrowserWindow.getAllWindows()[0]?.isVisible()
    ))).toBe(false);
    expect(await page.evaluate(() => typeof window.componentVault)).toBe('object');

    const capabilities = await page.evaluate(({ previewUrl, blockedUrl }) => new Promise<{
      componentVault: string;
      require: string;
      process: string;
    }>((resolveCapabilities, reject) => {
      const previewId = 'electron-preview-id';
      const iframe = document.createElement('iframe');
      iframe.title = 'Component preview';
      iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
      iframe.src = `${previewUrl}#${previewId}`;
      const timeout = window.setTimeout(() => reject(new Error('Preview did not execute')), 10_000);

      window.addEventListener('message', (event) => {
        if (event.source !== iframe.contentWindow) return;
        if (event.data?.channel === 'component-vault:preview:ready'
          && event.data.previewId === previewId) {
          iframe.contentWindow?.postMessage({
            channel: 'component-vault:preview:init',
            previewId,
            component: {
              html: '<p id="executed">executed</p>',
              css: '#executed { color: green; }',
              allowScripts: true,
              javascript: `parent.postMessage({
                channel: 'test:capabilities',
                componentVault: typeof window.componentVault,
                require: typeof globalThis.require,
                process: typeof globalThis.process
              }, '*');`,
            },
          }, '*');
        }
        if (event.data?.channel === 'test:capabilities') {
          window.clearTimeout(timeout);
          resolveCapabilities(event.data);
        }
      });
      document.body.append(iframe);
    }), { previewUrl, blockedUrl });

    expect(capabilities).toEqual(expect.objectContaining({
      componentVault: 'undefined',
      require: 'undefined',
      process: 'undefined',
    }));

    await page.evaluate((previewUrl) => new Promise<void>((resolveRequests, reject) => {
      const previews = [
        {
          id: 'electron-preview-a',
          allowedOrigin: 'https://a.example.test',
          ownUrl: 'https://a.example.test/a-own.png',
          crossUrl: 'https://b.example.test/a-cross.png',
        },
        {
          id: 'electron-preview-b',
          allowedOrigin: 'https://b.example.test',
          ownUrl: 'https://b.example.test/b-own.png',
          crossUrl: 'https://a.example.test/b-cross.png',
        },
      ];
      const frames = previews.map((preview) => {
        const iframe = document.createElement('iframe');
        iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
        iframe.src = `${previewUrl}#${preview.id}`;
        document.body.append(iframe);
        return { iframe, preview };
      });
      let scheduled = 0;
      const timeout = window.setTimeout(() => reject(new Error('Concurrent previews did not execute')), 10_000);
      window.addEventListener('message', async (event) => {
        const current = frames.find(({ iframe }) => event.source === iframe.contentWindow);
        if (!current) return;
        if (event.data?.channel === 'component-vault:preview:ready'
          && event.data.previewId === current.preview.id) {
          await window.componentVault.configurePreviewNetwork({
            previewId: current.preview.id,
            allowedOrigins: [current.preview.allowedOrigin],
          });
          current.iframe.contentWindow?.postMessage({
            channel: 'component-vault:preview:init',
            previewId: current.preview.id,
            component: {
              html: '', css: '', allowScripts: true,
              javascript: `for (const url of ${JSON.stringify([current.preview.ownUrl, current.preview.crossUrl])}) {
                const image = document.createElement('img'); image.src = url; document.body.append(image);
              }
              parent.postMessage({ channel: 'test:requests-scheduled', previewId: ${JSON.stringify(current.preview.id)} }, '*');`,
            },
          }, '*');
        }
        if (event.data?.channel === 'test:requests-scheduled') {
          scheduled += 1;
          if (scheduled === frames.length) {
            window.clearTimeout(timeout);
            resolveRequests();
          }
        }
      });
    }), previewUrl);

    await vi.waitFor(async () => {
      const evidence = await electronApplication!.evaluate(() => ({
        blocked: (globalThis as typeof globalThis & { __componentVaultBlockedPreviewUrls?: string[] })
          .__componentVaultBlockedPreviewUrls ?? [],
        started: (globalThis as typeof globalThis & { __componentVaultStartedPreviewUrls?: string[] })
          .__componentVaultStartedPreviewUrls ?? [],
      }));
      expect(evidence.blocked).toEqual(expect.arrayContaining([
        'https://b.example.test/a-cross.png',
        'https://a.example.test/b-cross.png',
      ]));
      expect(evidence.started).toEqual(expect.arrayContaining([
        'https://a.example.test/a-own.png',
        'https://b.example.test/b-own.png',
      ]));
      expect(evidence.started).not.toEqual(expect.arrayContaining([
        'https://b.example.test/a-cross.png',
        'https://a.example.test/b-cross.png',
      ]));
    }, { timeout: 10_000, interval: 50 });

    const navigationParent = resolve('tests/electron/fixtures/preview-parent-navigation.html');
    await electronApplication.evaluate(async ({ BrowserWindow }, filePath) => {
      await BrowserWindow.getAllWindows()[0]?.loadFile(filePath);
    }, navigationParent);
    await page.waitForURL(pathToFileURL(navigationParent).href);
    await page.evaluate(({ previewUrl, blockedUrl }) => new Promise<void>((resolveNavigation, reject) => {
      const previewId = 'electron-navigation-id';
      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
      iframe.src = `${previewUrl}#${previewId}`;
      const timeout = window.setTimeout(() => reject(new Error('Navigation preview did not execute')), 10_000);
      window.addEventListener('message', (event) => {
        if (event.source !== iframe.contentWindow) return;
        if (event.data?.channel === 'component-vault:preview:ready') {
          iframe.contentWindow?.postMessage({
            channel: 'component-vault:preview:init',
            previewId,
            component: {
              html: '', css: '', allowScripts: true,
              javascript: `parent.postMessage({ channel: 'test:navigation-started' }, '*');
                window.location.href = ${JSON.stringify(blockedUrl)};`,
            },
          }, '*');
        }
        if (event.data?.channel === 'test:navigation-started') {
          window.clearTimeout(timeout);
          resolveNavigation();
        }
      });
      document.body.append(iframe);
    }), { previewUrl, blockedUrl });

    await vi.waitFor(async () => {
      const blocked = await electronApplication!.evaluate(() => (
        (globalThis as typeof globalThis & { __componentVaultBlockedPreviewUrls?: string[] })
          .__componentVaultBlockedPreviewUrls ?? []
      ));
      expect(blocked).toContain(blockedUrl);
    }, { timeout: 10_000, interval: 50 });
    expect(page.frames().map((frame) => frame.url())).not.toContain(blockedUrl);
  }, 30_000);
});
