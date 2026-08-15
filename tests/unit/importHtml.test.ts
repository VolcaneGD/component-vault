import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decodeHtml,
  importHtmlFiles,
  normalizeHtmlImport,
} from '../../src/main/services/importHtml';

const fixturePath = (name: string): string => resolve(process.cwd(), 'tests', 'fixtures', 'import', name);

describe('HTML import', () => {
  it('decodes a Shift_JIS fixture without changing Japanese text', () => {
    const decoded = decodeHtml(readFileSync(fixturePath('shift-jis.html')));

    expect(decoded).toEqual({
      encoding: 'shift_jis',
      text: '<!doctype html>\n<html>\n  <head><meta charset="Shift_JIS"><title>日本語カード</title></head>\n  <body><p>こんにちは世界</p></body>\n</html>\n',
    });
  });

  it('detects undeclared Shift_JIS bytes that are also valid UTF-8 syntax', () => {
    const bytes = Buffer.concat([
      Buffer.from('<!doctype html><html><body><p>'),
      Buffer.from([0xc2, 0xa9]),
      Buffer.from('</p></body></html>'),
    ]);

    expect(decodeHtml(bytes)).toEqual({
      encoding: 'shift_jis',
      text: '<!doctype html><html><body><p>ﾂｩ</p></body></html>',
    });
  });

  it('derives a component name from title, then h1, then filename', () => {
    expect(normalizeHtmlImport('fallback.html', '<title>Card</title><div>Body</div>').name).toBe('Card');
    expect(normalizeHtmlImport('fallback.html', '<h1>Upload</h1>').name).toBe('Upload');
    expect(normalizeHtmlImport('fallback.html', '<button>OK</button>').name).toBe('fallback');
  });

  it('splits a complete document into body markup, inline styles, and executable scripts', () => {
    expect(normalizeHtmlImport('full-document.html', readFileSync(fixturePath('full-document.html'), 'utf8'))).toMatchObject({
      name: 'Pricing Card',
      html: '\n    <article class="pricing-card">Starter</article>\n  ',
      css: '.pricing-card { color: rebeccapurple; }',
      javascript: 'window.cardReady = true;',
      sourceType: 'import',
      originalFileName: 'full-document.html',
    });
  });

  it('keeps fragment markup while moving top-level style and script blocks into editors', () => {
    expect(normalizeHtmlImport('fragment.html', readFileSync(fixturePath('fragment.html'), 'utf8'))).toMatchObject({
      html: '<section class="notice">Saved</section>\n\n\n',
      css: '.notice { color: green; }',
      javascript: 'window.noticeReady = true;',
    });
  });

  it('does not treat tags inside a top-level script as fragment markup', () => {
    const draft = normalizeHtmlImport(
      'raw-text.html',
      "<script>const x = '<div>';</script><style>.banner { color: red; }</style><div>OK</div>",
    );

    expect(draft).toMatchObject({
      html: '<div>OK</div>',
      css: '.banner { color: red; }',
      javascript: "const x = '<div>';",
    });
  });

  it('returns per-file failures without preventing a readable HTML file from importing', () => {
    const results = importHtmlFiles([
      fixturePath('fragment.html'),
      fixturePath('not-html.txt'),
    ]);

    expect(results[0]).toMatchObject({ ok: true, draft: { name: 'fragment', originalFileName: 'fragment.html' } });
    expect(results[1]).toEqual({ ok: false, fileName: 'not-html.txt', message: 'Only .html and .htm files can be imported' });
  });

  it('requires a 5 MiB confirmation before retrying a large import', () => {
    const directory = mkdtempSync(join(tmpdir(), 'component-vault-import-'));
    const largeFile = join(directory, 'large.html');
    writeFileSync(largeFile, Buffer.concat([
      Buffer.from('<title>Large card</title>'),
      Buffer.alloc((5 * 1024 * 1024) + 1, 0x20),
    ]));

    try {
      expect(importHtmlFiles([largeFile])).toEqual([
        { ok: false, fileName: 'large.html', message: 'File exceeds 5 MiB; confirm to import it' },
      ]);
      expect(importHtmlFiles([largeFile], { allowLargeFiles: true })[0]).toMatchObject({
        ok: true,
        draft: { name: 'Large card', originalFileName: 'large.html' },
      });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
