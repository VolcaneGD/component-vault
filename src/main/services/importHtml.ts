import { readFileSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import iconv from 'iconv-lite';
import type {
  ComponentDraft,
  HtmlImportOptions,
  ImportResult,
  PreviewPolicy,
} from '../../shared/contracts';

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export const decodeHtml = (bytes: Buffer): { text: string; encoding: 'utf-8' | 'shift_jis' } => {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    return { text: bytes.subarray(3).toString('utf8'), encoding: 'utf-8' };
  }

  const declaredEncoding = declaredHtmlEncoding(bytes);
  if (declaredEncoding === 'shift_jis') {
    return { text: iconv.decode(bytes, 'shift_jis'), encoding: 'shift_jis' };
  }
  if (declaredEncoding === 'utf-8') {
    return { text: bytes.toString('utf8'), encoding: 'utf-8' };
  }

  return hasValidUtf8(bytes)
    ? { text: bytes.toString('utf8'), encoding: 'utf-8' }
    : { text: iconv.decode(bytes, 'shift_jis'), encoding: 'shift_jis' };
};

export const normalizeHtmlImport = (fileName: string, text: string): ComponentDraft => {
  const originalFileName = basename(fileName);
  const isDocument = /<!doctype\b|<html\b|<head\b|<body\b/i.test(text);
  const documentBody = isDocument ? extractBody(text) : text;
  const styleBlocks = isDocument ? extractBlocks(text, 'style') : extractTopLevelBlocks(text, 'style').blocks;
  const scriptBlocks = isDocument ? extractBlocks(text, 'script') : extractTopLevelBlocks(text, 'script').blocks;
  const styles = styleContents(styleBlocks);
  const scripts = executableScriptContents(scriptBlocks);
  const html = isDocument
    ? removeBlocks(documentBody, ['style', 'script'])
    : removeRanges(text, [
      ...extractTopLevelBlocks(text, 'style').ranges,
      ...extractTopLevelBlocks(text, 'script').ranges,
    ]);

  return {
    name: importName(text, originalFileName),
    description: '',
    category: '',
    html,
    css: styles,
    javascript: scripts,
    sourceType: 'import',
    originalFileName,
    tags: [],
    previewPolicy: defaultPreviewPolicy(),
  };
};

export const importHtmlFiles = (paths: string[], options: HtmlImportOptions = {}): ImportResult[] =>
  paths.map(filePath => importHtmlFile(filePath, options));

const importHtmlFile = (filePath: string, options: HtmlImportOptions): ImportResult => {
  const fileName = basename(filePath);
  if (!isHtmlFile(filePath)) {
    return { ok: false, fileName, message: 'Only .html and .htm files can be imported' };
  }

  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) return { ok: false, fileName, message: 'Import path must be a file' };
    if (stats.size > MAX_IMPORT_BYTES && !options.allowLargeFiles) {
      return { ok: false, fileName, message: 'File exceeds 5 MiB; confirm to import it' };
    }
    return { ok: true, draft: normalizeHtmlImport(fileName, decodeHtml(readFileSync(filePath)).text) };
  } catch {
    return { ok: false, fileName, message: 'Unable to read file' };
  }
};

const declaredHtmlEncoding = (bytes: Buffer): 'utf-8' | 'shift_jis' | undefined => {
  const header = bytes.subarray(0, 4096).toString('latin1');
  const meta = /<meta\b[^>]*\bcharset\s*=\s*["']?\s*([^\s"'>/]+)/i.exec(header) ??
    /<meta\b[^>]*\bcontent\s*=\s*["'][^"']*\bcharset\s*=\s*([^\s;"']+)/i.exec(header);
  if (!meta) return undefined;

  const label = meta[1].trim().toLowerCase().replace(/_/g, '-');
  if (label === 'utf-8' || label === 'utf8') return 'utf-8';
  if (['shift-jis', 'sjis', 'ms932', 'cp932', 'windows-31j'].includes(label)) return 'shift_jis';
  return undefined;
};

const hasValidUtf8 = (bytes: Buffer): boolean => {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
};

const extractBody = (text: string): string => /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(text)?.[1] ?? text;

const styleContents = (blocks: HtmlBlock[]): string => blocks
  .filter(block => !/\bsrc\s*=/i.test(block.attributes))
  .map(block => block.content.trim())
  .filter(Boolean)
  .join('\n\n');

const executableScriptContents = (blocks: HtmlBlock[]): string => blocks
  .filter(block => !/\bsrc\s*=/i.test(block.attributes) && isExecutableScript(block.attributes))
  .map(block => block.content.trim())
  .filter(Boolean)
  .join('\n\n');

const isExecutableScript = (attributes: string): boolean => {
  const type = /\btype\s*=\s*["']?\s*([^\s"'>]+)/i.exec(attributes)?.[1]?.toLowerCase();
  return type === undefined || ['module', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'].includes(type);
};

type HtmlBlock = { attributes: string; content: string; start: number; end: number };

const extractBlocks = (text: string, tag: 'style' | 'script'): HtmlBlock[] => {
  const expression = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}\\s*>`, 'gi');
  const blocks: HtmlBlock[] = [];
  for (const match of text.matchAll(expression)) {
    blocks.push({
      attributes: match[1], content: match[2], start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    });
  }
  return blocks;
};

const extractTopLevelBlocks = (text: string, tag: 'style' | 'script'): { blocks: HtmlBlock[]; ranges: Array<[number, number]> } => {
  const blocks = extractBlocks(text, tag).filter(block => nestingDepthAt(text, block.start) === 0);
  return { blocks, ranges: blocks.map(block => [block.start, block.end]) };
};

const nestingDepthAt = (text: string, end: number): number => {
  const tokens = /<!--[\s\S]*?-->|<\/?([a-z][\w:-]*)(?:\s[^<>]*?)?\s*\/?\s*>/gi;
  const voidElements = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  let depth = 0;
  for (const token of text.slice(0, end).matchAll(tokens)) {
    const raw = token[0];
    const tag = token[1]?.toLowerCase();
    if (!tag || raw.startsWith('<!--') || voidElements.has(tag) || raw.endsWith('/>')) continue;
    if (raw.startsWith('</')) depth = Math.max(0, depth - 1);
    else depth += 1;
  }
  return depth;
};

const removeBlocks = (text: string, tags: Array<'style' | 'script'>): string =>
  tags.reduce((result, tag) => result.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), ''), text);

const removeRanges = (text: string, ranges: Array<[number, number]>): string =>
  ranges.sort(([left], [right]) => right - left).reduce((result, [start, end]) => result.slice(0, start) + result.slice(end), text);

const importName = (text: string, fileName: string): string =>
  firstText(text, 'title') ?? firstText(text, 'h1') ?? (fileName.replace(/\.[^.]+$/, '') || 'Untitled component');

const firstText = (text: string, tag: 'title' | 'h1'): string | undefined => {
  const content = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'i').exec(text)?.[1];
  const name = content?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return name || undefined;
};

const isHtmlFile = (filePath: string): boolean => ['.html', '.htm'].includes(extname(filePath).toLowerCase());

const defaultPreviewPolicy = (): PreviewPolicy => ({
  allowScripts: false,
  allowForms: false,
  allowPopups: false,
  externalNetworkEnabled: false,
  allowedOrigins: [],
});
