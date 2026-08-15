import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

interface IcoEntry {
  width: number;
  height: number;
}

const parseIcoEntries = (ico: Buffer): IcoEntry[] => {
  const imageCount = ico.readUInt16LE(4);

  return Array.from({ length: imageCount }, (_, index) => {
    const offset = 6 + index * 16;
    const encodedWidth = ico.readUInt8(offset);
    const encodedHeight = ico.readUInt8(offset + 1);

    return {
      width: encodedWidth === 0 ? 256 : encodedWidth,
      height: encodedHeight === 0 ? 256 : encodedHeight,
    };
  });
};

describe('Windows application icon', () => {
  it('contains the required Windows icon sizes', () => {
    const ico = readFileSync(resolve('build/icon.ico'));

    expect(parseIcoEntries(ico).map(({ width, height }) => `${width}x${height}`)).toEqual([
      '16x16',
      '24x24',
      '32x32',
      '48x48',
      '64x64',
      '128x128',
      '256x256',
    ]);
  });
});
