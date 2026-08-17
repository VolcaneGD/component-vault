import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
// @ts-expect-error jsdom 29 does not publish TypeScript declarations.
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

const previewHtmlPath = 'src/renderer/public/preview/preview.html';
const previewBootstrapPath = 'src/renderer/public/preview/preview-bootstrap.js';

const loadPreview = async () => {
  const html = readFileSync(previewHtmlPath, 'utf8');
  const dom = new JSDOM(html, {
    beforeParse: (window: Window & typeof globalThis) => {
      window.URL.createObjectURL = (blob: Blob) => {
        const implementation = Object.getOwnPropertySymbols(blob)
          .map((symbol) => (blob as unknown as Record<symbol, { _bytes?: Uint8Array }>)[symbol])
          .find((candidate) => candidate?._bytes);
        const contents = Buffer.from(implementation?._bytes ?? []).toString('base64');
        return `data:${blob.type};base64,${contents}`;
      };
      window.URL.revokeObjectURL = () => undefined;
    },
    resources: 'usable',
    runScripts: 'dangerously',
    url: `${pathToFileURL(`${process.cwd()}/${previewHtmlPath}`).href}#preview-id`,
  });
  await new Promise<void>((resolve) => dom.window.addEventListener('load', () => resolve(), { once: true }));
  return dom;
};

describe('static preview bootstrap', () => {
  it('uses an independent CSP with external bootstrap and scoped blob execution', () => {
    const html = readFileSync(previewHtmlPath, 'utf8');
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const csp = parsed.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content');

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('script-src component-vault-preview: blob: https:');
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(parsed.querySelectorAll('script')).toHaveLength(1);
    expect(parsed.querySelector('script')?.getAttribute('src')).toBe('./preview-bootstrap.js');
    expect(parsed.querySelector('script')?.textContent?.trim()).toBe('');
    const bootstrap = readFileSync(previewBootstrapPath, 'utf8');
    expect(bootstrap).not.toContain('window.componentVault');
    expect(bootstrap).not.toContain('require(');
    expect(bootstrap).not.toContain('process.');
  });

  it('installs payload HTML/CSS/JavaScript only after an authenticated parent message', async () => {
    const dom = await loadPreview();

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      source: dom.window.parent,
      data: {
        channel: 'component-vault:preview:init',
        previewId: 'preview-id',
        component: {
          html: '<button id="demo">Run</button>',
          css: '#demo { color: rebeccapurple; }',
          javascript: 'document.querySelector("#demo").dataset.ready = "true";',
          allowScripts: true,
        },
      },
    }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    expect(dom.window.document.querySelector('#demo')).toHaveAttribute('data-ready', 'true');
    expect(dom.window.document.querySelector('link[rel="stylesheet"]')).not.toBeNull();
    expect(dom.window.document.body.style.padding).toBe('24px');
    expect(dom.window.document.body.style.getPropertyPriority('padding')).toBe('important');
    expect(dom.window.document.body.style.boxSizing).toBe('border-box');
    const stylesheets = dom.window.document.querySelectorAll('link[rel="stylesheet"]') as unknown as ArrayLike<{
      getAttribute(name: string): string | null;
    }>;
    const canvasStylesheet = Array.from(stylesheets)
      .map((link) => Buffer.from((link.getAttribute('href') ?? '').split(',').at(-1) ?? '', 'base64').toString('utf8'))
      .find((contents) => contents.includes('scrollbar-color'));
    expect(canvasStylesheet).toContain('::-webkit-scrollbar-thumb');
    expect(canvasStylesheet).toContain('#43516f');
    dom.window.close();
  });

  it('serializes undefined rejections and bounds every forwarded string', async () => {
    const dom = await loadPreview();
    const postMessage = vi.spyOn(dom.window, 'postMessage');
    const rejection = new dom.window.Event('unhandledrejection');
    Object.defineProperty(rejection, 'reason', { value: undefined });

    dom.window.dispatchEvent(rejection);

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'component-vault:preview:event',
      previewId: 'preview-id',
      error: expect.objectContaining({ message: 'undefined' }),
    }), '*');

    const longError = new dom.window.Error('m'.repeat(5_000));
    longError.stack = 's'.repeat(20_000);
    dom.window.dispatchEvent(new dom.window.ErrorEvent('error', {
      message: longError.message,
      filename: `https://example.test/${'r'.repeat(5_000)}`,
      error: longError,
    }));
    const forwarded = postMessage.mock.calls.at(-1)?.[0] as {
      error: { message: string; stack: string; blockedUri: string };
    };

    expect(forwarded.error.message.length).toBeLessThanOrEqual(2_000);
    expect(forwarded.error.stack.length).toBeLessThanOrEqual(8_000);
    expect(forwarded.error.blockedUri.length).toBeLessThanOrEqual(2_048);
    dom.window.close();
  });
});
