import { readFileSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import chardet from 'chardet';
import iconv from 'iconv-lite';
import type {
  ComponentDraft,
  HtmlImportOptions,
  ImportResult,
  PreviewPolicy,
} from '../../shared/contracts';
import { parseComponentVaultHtml } from './exportHtml';

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MATERIAL_CONFIDENCE_GAP = 20;

export const decodeHtml = (bytes: Buffer): { text: string; encoding: 'utf-8' | 'shift_jis' } => {
  const decoded = (text: string, encoding: 'utf-8' | 'shift_jis') => ({
    text: text.replace(/\r\n?/g, '\n'),
    encoding,
  });
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    return decoded(bytes.subarray(3).toString('utf8'), 'utf-8');
  }

  const declaredEncoding = declaredHtmlEncoding(bytes);
  if (declaredEncoding === 'shift_jis') {
    return decoded(iconv.decode(bytes, 'shift_jis'), 'shift_jis');
  }
  if (declaredEncoding === 'utf-8') {
    return decoded(bytes.toString('utf8'), 'utf-8');
  }

  const encoding = detectFallbackEncoding(bytes);
  return encoding === 'utf-8'
    ? decoded(bytes.toString('utf8'), encoding)
    : decoded(iconv.decode(bytes, 'shift_jis'), encoding);
};

export const normalizeHtmlImport = (fileName: string, text: string): ComponentDraft => {
  const normalizedText = text.replace(/\r\n?/g, '\n');
  const originalFileName = basename(fileName);
  const isDocument = /<!doctype\b|<html\b|<head\b|<body\b/i.test(normalizedText);
  const documentBody = isDocument ? extractBody(normalizedText) : normalizedText;
  const styleBlocks = isDocument ? extractBlocks(normalizedText, 'style') : extractTopLevelBlocks(normalizedText, 'style').blocks;
  const scriptBlocks = isDocument ? extractBlocks(normalizedText, 'script') : extractTopLevelBlocks(normalizedText, 'script').blocks;
  const styles = styleContents(styleBlocks);
  const scripts = executableScriptContents(scriptBlocks);
  const html = isDocument
    ? removeBlocks(documentBody, ['style', 'script'])
    : removeRanges(normalizedText, [
      ...extractTopLevelBlocks(normalizedText, 'style').ranges,
      ...extractTopLevelBlocks(normalizedText, 'script').ranges,
    ]);

  return {
    name: importName(normalizedText, originalFileName),
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
    const text = decodeHtml(readFileSync(filePath)).text;
    const bundle = parseComponentVaultHtml(text);
    return bundle
      ? { ok: true, fileName, bundle }
      : { ok: true, draft: normalizeHtmlImport(fileName, text) };
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

const detectFallbackEncoding = (bytes: Buffer): 'utf-8' | 'shift_jis' => {
  const matches = chardet.analyse(bytes);
  const utf8Confidence = detectorConfidence(matches, 'UTF-8');
  const shiftJisConfidence = detectorConfidence(matches, 'Shift_JIS');

  if (shiftJisConfidence >= utf8Confidence + MATERIAL_CONFIDENCE_GAP) return 'shift_jis';

  // Bytes such as C2 A9 are valid in both encodings, so they cannot be
  // distinguished without metadata. Ties and low-confidence results use UTF-8.
  return 'utf-8';
};

const detectorConfidence = (
  matches: Array<{ confidence: number; name: string }>,
  encoding: string,
): number => matches.find(match => match.name === encoding)?.confidence ?? 0;

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
  const blocks = scanTopLevelRawTextBlocks(text, tag);
  return { blocks, ranges: blocks.map(block => [block.start, block.end]) };
};

const scanTopLevelRawTextBlocks = (text: string, wantedTag: 'style' | 'script'): HtmlBlock[] => {
  const tokens = /<!--[\s\S]*?-->|<\/?([a-z][\w:-]*)(?:\s[^<>]*?)?\s*\/?\s*>/gi;
  const voidElements = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const rawTextTags = new Set(['script', 'style']);
  const blocks: HtmlBlock[] = [];
  let depth = 0;
  for (let token = tokens.exec(text); token; token = tokens.exec(text)) {
    const raw = token[0];
    const tag = token[1]?.toLowerCase();
    if (!tag || raw.startsWith('<!--') || voidElements.has(tag) || raw.endsWith('/>')) continue;
    if (raw.startsWith('</')) {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (rawTextTags.has(tag)) {
      const closing = new RegExp(`<\\/${tag}\\s*>`, 'gi');
      closing.lastIndex = tokens.lastIndex;
      const close = closing.exec(text);
      if (tag === wantedTag && depth === 0 && close) {
        blocks.push({
          attributes: raw.slice(tag.length + 1, -1).replace(/\/\s*$/, ''),
          content: text.slice(tokens.lastIndex, close.index),
          start: token.index,
          end: close.index + close[0].length,
        });
      }
      tokens.lastIndex = close ? close.index + close[0].length : text.length;
      continue;
    }

    depth += 1;
  }
  return blocks;
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
