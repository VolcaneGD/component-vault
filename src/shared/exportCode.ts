import type { ExportComponent, ExportCopyKind } from './contracts';

export const sanitizeDownloadFileName = (name: string, extension: '.html' | '.css'): string => {
  const trimmed = String(name).trim().replace(/[. ]+$/g, '');
  const withoutRequestedExtension = trimmed.toLowerCase().endsWith(extension)
    ? trimmed.slice(0, -extension.length)
    : trimmed;
  let safe = withoutRequestedExtension
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[. -]+|[. -]+$/g, '')
    .slice(0, 120);
  if (!safe) safe = 'component';
  const firstDot = safe.indexOf('.');
  const deviceBaseName = firstDot === -1 ? safe : safe.slice(0, firstDot);
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(deviceBaseName)) {
    safe = `${deviceBaseName}-file${safe.slice(deviceBaseName.length)}`;
  }
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
