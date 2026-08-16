import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

interface IcoEntry {
  width: number;
  height: number;
}

interface PngImage {
  width: number;
  height: number;
  bytesPerPixel: number;
  pixels: Buffer;
}

const paeth = (left: number, above: number, upperLeft: number) => {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);

  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
};

const decodePng = (png: Buffer): PngImage => {
  let offset = 8;
  let width = 0;
  let height = 0;
  let bytesPerPixel = 0;
  const compressedChunks: Buffer[] = [];

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data.readUInt8(8)).toBe(8);
      expect([2, 6]).toContain(data.readUInt8(9));
      expect([...data.subarray(10, 13)]).toEqual([0, 0, 0]);
      bytesPerPixel = data.readUInt8(9) === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      compressedChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  const stride = width * bytesPerPixel;
  const filtered = inflateSync(Buffer.concat(compressedChunks));
  const pixels = Buffer.alloc(width * height * bytesPerPixel);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (stride + 1);
    const filter = filtered[rowOffset];
    for (let x = 0; x < stride; x += 1) {
      const source = filtered[rowOffset + 1 + x];
      const outputOffset = y * stride + x;
      const left = x >= bytesPerPixel ? pixels[outputOffset - bytesPerPixel] : 0;
      const above = y > 0 ? pixels[outputOffset - stride] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel
        ? pixels[outputOffset - stride - bytesPerPixel]
        : 0;
      const predictor = filter === 0
        ? 0
        : filter === 1
          ? left
          : filter === 2
            ? above
            : filter === 3
              ? Math.floor((left + above) / 2)
              : paeth(left, above, upperLeft);
      pixels[outputOffset] = (source + predictor) & 0xff;
    }
  }

  return { width, height, bytesPerPixel, pixels };
};

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
  it('contains the archive icon source for website and Windows packaging', () => {
    expect(existsSync(resolve('build/component-vault-archive-icon.png'))).toBe(true);
  });

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

  it('keeps the generated master flat on an exact chroma-key background', () => {
    const master = decodePng(readFileSync(resolve('build/icon-html-tag-master.png')));
    const rgbAt = (x: number, y: number) => {
      const offset = (y * master.width + x) * master.bytesPerPixel;
      return [...master.pixels.subarray(offset, offset + 3)];
    };
    const palette = new Set<string>();
    for (let offset = 0; offset < master.pixels.length; offset += master.bytesPerPixel) {
      palette.add(master.pixels.subarray(offset, offset + 3).join(','));
    }

    expect([
      rgbAt(0, 0),
      rgbAt(master.width - 1, 0),
      rgbAt(0, master.height - 1),
      rgbAt(master.width - 1, master.height - 1),
    ]).toEqual(Array.from({ length: 4 }, () => [0, 255, 0]));
    expect(palette).toContain('0,255,0');
    expect(palette).toContain('91,33,182');
    expect(palette).toContain('248,247,255');
    expect(palette.size).toBeLessThanOrEqual(512);
  });
});
