import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rendererTemplate = async () => readFile(resolve(process.cwd(), 'src/renderer/index.html'), 'utf8');

const cspFor = async (mode: 'development' | 'production') => {
  const source = await rendererTemplate();
  const environment = await readFile(resolve(process.cwd(), `.env.${mode}`), 'utf8').catch(() => '');
  const rawStyleSource = environment.match(/^VITE_DEV_STYLE_SOURCE=(.*)$/m)?.[1] ?? '';
  const styleSource = rawStyleSource.replace(/^"(.*)"$/, '$1');
  return source.replace('%VITE_DEV_STYLE_SOURCE%', styleSource);
};

describe('renderer CSP configuration', () => {
  it('allows Vite development style injection only in development', async () => {
    expect(await cspFor('development')).toContain("style-src 'self' 'unsafe-inline'");
    expect(await cspFor('production')).toContain("style-src 'self';");
    expect(await cspFor('production')).not.toContain("'unsafe-inline'");
  });
});
