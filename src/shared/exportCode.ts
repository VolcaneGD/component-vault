import type { ExportComponent, ExportCopyKind } from './contracts';

export const sanitizeDownloadFileName = (name: string, extension: '.html' | '.css'): string => {
  const trimmed = String(name).trim();
  const lastDot = trimmed.lastIndexOf('.');
  const lastSeparator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  const withoutExtension = lastDot > lastSeparator ? trimmed.slice(0, lastDot) : trimmed;
  let safe = withoutExtension
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[. -]+|[. -]+$/g, '')
    .slice(0, 120);
  if (!safe) safe = 'component';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(safe)) safe += '-file';
  return `${safe}${extension}`;
};

export const createCopyText = (component: ExportComponent, kind: ExportCopyKind): string => {
  switch (kind) {
    case 'html':
      return component.html;
    case 'css':
      return component.css;
    case 'javascript':
      return component.javascript;
    case 'css-linked-html':
      return `<link rel="stylesheet" href="${sanitizeDownloadFileName(component.name, '.css')}">\n${component.html}`;
    case 'full-code':
      return [
        '<!doctype html>',
        '<html><head><meta charset="utf-8">',
        `<style>${escapeClosingTag(component.css, 'style')}</style>`,
        '</head><body>',
        component.html,
        `<script>${escapeClosingTag(component.javascript, 'script')}</script>`,
        '</body></html>',
      ].join('\n');
  }
};

const escapeClosingTag = (source: string, tag: 'script' | 'style'): string =>
  source.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);
