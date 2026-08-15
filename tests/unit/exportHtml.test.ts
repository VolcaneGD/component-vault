import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script } from 'node:vm';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { ExportPayload } from '../../src/shared/contracts';
import {
  createCopyText,
  createStandaloneHtml,
  parseComponentVaultHtml,
  sanitizeDownloadFileName,
  saveStandaloneHtmlAtomically,
} from '../../src/main/services/exportHtml';
import { importHtmlFiles } from '../../src/main/services/importHtml';

const payload = (overrides: Partial<ExportPayload> = {}): ExportPayload => ({
  format: 'component-vault',
  version: 1,
  library: { name: 'Design system', description: 'Reusable controls' },
  components: [{
    name: 'Primary Button',
    description: 'Main call to action',
    category: 'Buttons',
    tags: ['primary'],
    html: '<button class="primary">保存</button>',
    css: '.primary { color: white; }',
    javascript: 'document.querySelector("button")?.focus();',
    previewPolicy: {
      allowScripts: true,
      allowForms: false,
      allowPopups: false,
      externalNetworkEnabled: false,
      allowedOrigins: [],
    },
  }],
  ...overrides,
});

describe('standalone HTML export', () => {
  it('round-trips Unicode component code through standalone HTML', async () => {
    const exported = payload({
      library: { name: '日本語ライブラリ', description: '通信ボタン集' },
      components: [{
        ...payload().components[0],
        name: '通信ボタン',
        html: '<button>通信</button>',
      }],
    });

    const html = await createStandaloneHtml(exported);
    const restored = parseComponentVaultHtml(html);

    expect(restored?.library.name).toBe('日本語ライブラリ');
    expect(restored?.components[0].name).toBe('通信ボタン');
    expect(restored?.components[0].html).toBe('<button>通信</button>');
  });

  it('stores each component in an independent gzip Base64 entry', async () => {
    const exported = payload({
      components: [
        { ...payload().components[0], name: 'One', html: '<p>ONE_ISOLATED</p>' },
        { ...payload().components[0], name: 'Two', html: '<p>TWO_ISOLATED</p>' },
      ],
    });

    const html = await createStandaloneHtml(exported);
    const embedded = /<script id="component-vault-data" type="application\/json">([^<]+)<\/script>/.exec(html)?.[1];
    const envelope = JSON.parse(embedded ?? '{}') as { components?: Array<{ encoding?: string; data?: string }> };

    expect(html).not.toContain('ONE_ISOLATED');
    expect(html).not.toContain('TWO_ISOLATED');
    expect(envelope.components).toHaveLength(2);
    expect(envelope.components?.every((item) => item.encoding === 'gzip-base64')).toBe(true);
    expect(envelope.components?.[0].data).not.toBe(envelope.components?.[1].data);
    expect(parseComponentVaultHtml(html)?.components.map((item) => item.name)).toEqual(['One', 'Two']);
  });

  it('escapes script-sensitive metadata without losing it during parsing', async () => {
    const dangerousName = '</script><script>globalThis.pwned = true</script>\u2028&';
    const html = await createStandaloneHtml(payload({
      library: { name: dangerousName, description: '<!-- unsafe -->' },
    }));

    expect(html).not.toContain(dangerousName);
    expect(html).not.toContain('</script><script>globalThis.pwned');
    expect(parseComponentVaultHtml(html)?.library.name).toBe(dangerousName);
  });

  it('rejects unknown versions, malformed Base64, and oversized sources', async () => {
    const html = await createStandaloneHtml(payload());
    const wrongVersion = html.replace('"version":1', '"version":2');
    const malformed = html.replace(/"data":"[^"]+"/, '"data":"not@base64"');

    expect(parseComponentVaultHtml(wrongVersion)).toBeNull();
    expect(parseComponentVaultHtml(malformed)).toBeNull();
    expect(parseComponentVaultHtml(`<!--${'x'.repeat((25 * 1024 * 1024) + 1)}-->`)).toBeNull();
  });

  it('accepts the exact UTF-8 code byte boundary and rejects one byte over it', async () => {
    const exactJapaneseBoundary = `${'界'.repeat(666_666)}ab`;
    const exact = payload({
      components: [{ ...payload().components[0], html: exactJapaneseBoundary, css: '', javascript: '' }],
    });

    expect(Buffer.byteLength(exactJapaneseBoundary, 'utf8')).toBe(2_000_000);
    const html = await createStandaloneHtml(exact);
    expect(parseComponentVaultHtml(html)?.components[0].html).toBe(exactJapaneseBoundary);

    await expect(createStandaloneHtml({
      ...exact,
      components: [{ ...exact.components[0], html: `${exactJapaneseBoundary}x` }],
    })).rejects.toThrow('Invalid Component Vault export payload');
  });

  it('rejects a single compressed component before inflating beyond its allocation limit', () => {
    const inflatedBomb = JSON.stringify({
      ...payload().components[0],
      padding: 'x'.repeat((6 * 1024 * 1024) + 1),
    });
    const source = embeddedEnvelope([
      gzipSync(Buffer.from(inflatedBomb, 'utf8')).toString('base64'),
    ]);

    expect(parseComponentVaultHtml(source)).toBeNull();
  });

  it('rejects individually valid compressed components that exceed the cumulative inflated budget', () => {
    const largeComponent = {
      ...payload().components[0],
      html: 'x'.repeat(1_900_000),
      css: '',
      javascript: '',
    };
    const entries = Array.from({ length: 7 }, (_, index) => gzipSync(Buffer.from(JSON.stringify({
      ...largeComponent,
      name: `Component ${index}`,
    }), 'utf8')).toString('base64'));

    expect(parseComponentVaultHtml(embeddedEnvelope(entries))).toBeNull();
  });

  it('rejects an export over the cumulative budget before generating standalone HTML', async () => {
    const largeComponent = {
      ...payload().components[0],
      html: 'x'.repeat(1_900_000),
      css: '',
      javascript: '',
    };
    const oversized = payload({
      components: Array.from({ length: 7 }, (_, index) => ({
        ...largeComponent,
        name: `Component ${index}`,
      })),
    });
    const accepted = { ...oversized, components: oversized.components.slice(0, 6) };

    const acceptedHtml = await createStandaloneHtml(accepted);
    expect(parseComponentVaultHtml(acceptedHtml)?.components).toHaveLength(6);
    await expect(createStandaloneHtml(oversized)).rejects.toThrow('Export payload exceeds the cumulative size limit');
  });

  it('creates distinct copy forms and only includes JavaScript in full code', () => {
    const component = payload().components[0];

    expect(createCopyText(component, 'html')).toBe(component.html);
    expect(createCopyText(component, 'css')).toBe(component.css);
    expect(createCopyText(component, 'javascript')).toBe(component.javascript);
    expect(createCopyText(component, 'css-linked-html')).toBe(
      '<link rel="stylesheet" href="Primary-Button.css">\n<button class="primary">保存</button>',
    );
    expect(createCopyText(component, 'css-linked-html')).not.toContain(component.javascript);
    expect(createCopyText(component, 'full-code')).toContain(component.javascript);
    expect(createCopyText(component, 'full-code')).toContain('<style>.primary { color: white; }</style>');
  });

  it.each([
    ['../CON?.html', 'CON-file.html'],
    ['  Hero / Card:*?  ', 'Hero-Card.html'],
    ['...', 'component.html'],
    ['Primary Button', 'Primary-Button.css'],
    ['NUL.any.css', 'NUL-file.any.css'],
    ['CON.foo', 'CON-file.foo.css'],
    ['lPt9.backup.CSS', 'lPt9-file.backup.css'],
    ['aux...   ', 'aux-file.css'],
  ])('sanitizes download filename %s', (name, expected) => {
    const extension = expected.endsWith('.css') ? '.css' : '.html';
    expect(sanitizeDownloadFileName(name, extension)).toBe(expected);
  });

  it('flushes and replaces an existing destination through a sibling temporary file', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'component-vault-export-'));
    const destination = join(directory, 'library.html');
    writeFileSync(destination, 'old', 'utf8');

    try {
      const result = await saveStandaloneHtmlAtomically(destination, '<!doctype html><title>new</title>');

      expect(result).toEqual({ ok: true, path: destination, html: '<!doctype html><title>new</title>' });
      expect(readFileSync(destination, 'utf8')).toBe('<!doctype html><title>new</title>');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps generated HTML and removes only its temporary file when replacement fails', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'component-vault-export-failure-'));
    const destination = join(directory, 'existing-directory');
    mkdirSync(destination);
    writeFileSync(join(destination, 'preserved.txt'), 'preserve me', 'utf8');

    try {
      const result = await saveStandaloneHtmlAtomically(destination, '<!doctype html><title>retry</title>');

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('Expected atomic replacement to fail');
      expect(result.html).toBe('<!doctype html><title>retry</title>');
      expect(readFileSync(join(destination, 'preserved.txt'), 'utf8')).toBe('preserve me');
      expect(readFileSync(join(destination, 'preserved.txt'), 'utf8')).toBe('preserve me');
      expect(result.temporaryPath).toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('recognizes an exported bundle during normal HTML import', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'component-vault-reimport-'));
    const file = join(directory, 'library.html');
    writeFileSync(file, await createStandaloneHtml(payload()), 'utf8');

    try {
      expect(importHtmlFiles([file])[0]).toMatchObject({
        ok: true,
        fileName: 'library.html',
        bundle: {
          format: 'component-vault',
          version: 1,
          library: { name: 'Design system' },
          components: [expect.objectContaining({ name: 'Primary Button' })],
        },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('emits syntactically valid offline viewer scripts', async () => {
    const html = await createStandaloneHtml(payload());
    const executableScripts = [...html.matchAll(/<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)];

    expect(executableScripts.length).toBeGreaterThan(0);
    for (const script of executableScripts) {
      new Script(script[1], { filename: 'component-vault-standalone.js' });
    }
  });
});

const embeddedEnvelope = (componentData: string[]): string => {
  const envelope = {
    format: 'component-vault',
    version: 1,
    library: { name: 'Compressed fixtures', description: '' },
    components: componentData.map((data) => ({ encoding: 'gzip-base64', data })),
  };
  return `<script id="component-vault-data" type="application/json">${JSON.stringify(envelope)}</script>`;
};
