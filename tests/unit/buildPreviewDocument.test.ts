import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error jsdom 29 does not publish TypeScript declarations.
import { JSDOM } from 'jsdom';
import type { ComponentRecord } from '../../src/shared/contracts';
import {
  buildPreviewDocument,
  PREVIEW_CHANNEL,
} from '../../src/renderer/src/features/preview/buildPreviewDocument';

const component = (overrides: Partial<ComponentRecord> = {}): ComponentRecord => ({
  id: 'component-1',
  libraryId: 'library-1',
  name: 'Preview component',
  description: '',
  category: '',
  tags: [],
  html: '<button id="demo">Run</button>',
  css: '#demo { color: rebeccapurple; }',
  javascript: 'document.querySelector("#demo")?.setAttribute("data-ready", "true");',
  sourceType: 'html',
  originalFileName: null,
  previewPolicy: {
    allowScripts: true,
    allowForms: false,
    allowPopups: false,
    externalNetworkEnabled: false,
    allowedOrigins: [],
  },
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
  deletedAt: null,
  ...overrides,
});

describe('buildPreviewDocument', () => {
  it('blocks all network origins by default', () => {
    const doc = buildPreviewDocument(component(), 'n');

    expect(doc).toContain("default-src 'none'");
    expect(doc).not.toContain('https:');
  });

  it('adds only normalized HTTPS origins when external networking is enabled', () => {
    const doc = buildPreviewDocument(component({
      previewPolicy: {
        allowScripts: true,
        allowForms: false,
        allowPopups: false,
        externalNetworkEnabled: true,
        allowedOrigins: [
          'https://cdn.example.com',
          'http://insecure.example.com',
          'https://cdn.example.com/path',
          'https://cdn.example.com',
        ],
      },
    }), 'n');

    expect(doc).toContain('https://cdn.example.com');
    expect(doc).not.toContain('http://insecure.example.com');
    expect(doc).not.toContain('https://cdn.example.com/path');
    expect(new Set(doc.match(/https?:\/\/[^\s;\"']+/g))).toEqual(
      new Set(['https://cdn.example.com']),
    );
  });

  it('serializes untrusted markup and code without creating attacker-controlled document tags', () => {
    const doc = buildPreviewDocument(component({
      html: '</div><script>parent.postMessage({ forged: true }, "*")</script>',
      css: '</style><script>parent.postMessage({ forged: true }, "*")</script>',
      javascript: '</script><script>parent.postMessage({ forged: true }, "*")</script>',
    }), 'preview-id');
    const parsed = new DOMParser().parseFromString(doc, 'text/html');

    expect(doc).not.toContain('</script><script>');
    expect(parsed.querySelectorAll('script')).toHaveLength(1);
    expect(parsed.querySelector('script')?.nonce).toBe('preview-id');
    expect(parsed.querySelector('#component-vault-preview-root')).not.toBeNull();
  });

  it('installs component HTML and CSS and executes component JavaScript', () => {
    const dom = new JSDOM(buildPreviewDocument(component(), 'preview-id'), {
      runScripts: 'dangerously',
    });

    expect(dom.window.document.querySelector('#demo')).not.toBeNull();
    expect(dom.window.document.querySelector('style')?.textContent).toContain('rebeccapurple');
    expect(dom.window.document.querySelector('#demo')).toHaveAttribute('data-ready', 'true');
    dom.window.close();
  });

  it('forwards serialized runtime errors with the preview instance ID', () => {
    const dom = new JSDOM(buildPreviewDocument(component(), 'preview-id'), {
      runScripts: 'dangerously',
    });
    const postMessage = vi.spyOn(dom.window, 'postMessage');

    dom.window.dispatchEvent(new dom.window.ErrorEvent('error', {
      message: 'Preview failed',
      lineno: 12,
      colno: 7,
    }));

    expect(postMessage).toHaveBeenCalledWith({
      channel: PREVIEW_CHANNEL,
      previewId: 'preview-id',
      error: {
        type: 'runtime',
        message: 'Preview failed',
        line: 12,
        column: 7,
        stack: undefined,
      },
    }, '*');
    dom.window.close();
  });

  it('forwards CSP violations with canonical blocked-origin guidance', () => {
    const dom = new JSDOM(buildPreviewDocument(component(), 'preview-id'), {
      runScripts: 'dangerously',
    });
    const postMessage = vi.spyOn(dom.window, 'postMessage');
    const violation = new dom.window.Event('securitypolicyviolation');
    Object.defineProperties(violation, {
      blockedURI: { value: 'https://images.example.com/photo.png' },
      effectiveDirective: { value: 'img-src' },
      lineNumber: { value: 4 },
      columnNumber: { value: 2 },
    });

    dom.window.document.dispatchEvent(violation);

    expect(postMessage).toHaveBeenCalledWith({
      channel: PREVIEW_CHANNEL,
      previewId: 'preview-id',
      error: expect.objectContaining({
        type: 'csp',
        blockedOrigin: 'https://images.example.com',
        blockedUri: 'https://images.example.com/photo.png',
        directive: 'img-src',
      }),
    }, '*');
    dom.window.close();
  });

  it('rejects a nonce that cannot be safely used by the CSP and bootstrap', () => {
    expect(() => buildPreviewDocument(component(), 'bad\"; script-src *')).toThrow(
      'Preview nonce must use base64url-safe characters',
    );
  });
});
