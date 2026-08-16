import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('application license packaging', () => {
  it('ships the declared ISC license with the Windows application', () => {
    const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { license?: string };
    const licensePath = resolve('LICENSE');
    const builderConfig = readFileSync(resolve('electron-builder.yml'), 'utf8');

    expect(packageJson.license).toBe('ISC');
    expect(existsSync(licensePath)).toBe(true);
    expect(readFileSync(licensePath, 'utf8')).toContain('The ISC License');
    expect(builderConfig).toContain('from: LICENSE');
    expect(builderConfig).toContain('to: LICENSE');
  });
});
