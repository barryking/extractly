import { describe, it, expect } from 'vitest';
import {
  decodeTextString,
  computeTextMetrics,
  getCharWidth,
  type FontInfo,
} from '../../src/content/font-resolver.js';

function fontWithToUnicode(toUnicode: Map<number, string>, isIdentity = false): FontInfo {
  return {
    toUnicode,
    encoding: null,
    differences: null,
    isIdentity,
    baseFont: 'TestFont',
    widths: new Map(),
    defaultWidth: 600,
  };
}

function fontWithEncoding(
  encoding: readonly number[] | null,
  differences: Map<number, string> | null
): FontInfo {
  return {
    toUnicode: null,
    encoding,
    differences,
    isIdentity: false,
    baseFont: 'TestFont',
    widths: new Map(),
    defaultWidth: 600,
  };
}

describe('decodeTextString', () => {
  it('with a ToUnicode map returns correct Unicode', () => {
    const toUnicode = new Map<number, string>([
      [72, 'H'],
      [101, 'e'],
      [108, 'l'],
      [111, 'o'],
    ]);
    const font = fontWithToUnicode(toUnicode);
    const bytes = new Uint8Array([72, 101, 108, 108, 111]);
    expect(decodeTextString(bytes, font)).toBe('Hello');
  });

  it('with encoding + differences resolves glyph names', () => {
    // Encoding: byte 65 -> A (0x41), byte 32 -> space (0x20)
    // Differences: byte 65 -> 'A', byte 66 -> 'B'
    const encoding = new Array<number>(256).fill(0);
    encoding[65] = 0x41;
    encoding[66] = 0x42;
    encoding[32] = 0x20;
    const differences = new Map<number, string>([
      [65, 'A'],
      [66, 'B'],
    ]);
    const font = fontWithEncoding(encoding, differences);
    const bytes = new Uint8Array([65, 66, 32]);
    expect(decodeTextString(bytes, font)).toBe('AB ');
  });

  it('identity mapping for 2-byte codes', () => {
    const toUnicode = new Map<number, string>([
      [0x0048, 'H'],
      [0x0065, 'e'],
    ]);
    const font = fontWithToUnicode(toUnicode, true);
    // Big-endian: H=0x0048 -> bytes [0x00, 0x48]; e=0x0065 -> bytes [0x00, 0x65]
    const bytes = new Uint8Array([0x00, 0x48, 0x00, 0x65]);
    expect(decodeTextString(bytes, font)).toBe('He');
  });

  it('Latin-1 fallback for unknown encoding', () => {
    const font: FontInfo = {
      toUnicode: null,
      encoding: null,
      differences: null,
      isIdentity: false,
      baseFont: 'TestFont',
      widths: new Map(),
      defaultWidth: 600,
    };
    const bytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // Hello
    expect(decodeTextString(bytes, font)).toBe('Hello');
  });
});

describe('computeTextMetrics', () => {
  it('returns correct width/count/spaces for single-byte font', () => {
    const font: FontInfo = {
      toUnicode: null,
      encoding: null,
      differences: null,
      isIdentity: false,
      baseFont: 'TestFont',
      widths: new Map([
        [72, 500],
        [101, 200],
        [32, 250],
      ]),
      defaultWidth: 600,
    };
    const bytes = new Uint8Array([72, 101, 32, 101]); // H e e
    const m = computeTextMetrics(bytes, font);
    expect(m.charCount).toBe(4);
    expect(m.spaceCount).toBe(1);
    // 500/1000 + 200/1000 + 250/1000 + 200/1000 = 1.15
    expect(m.totalWidth).toBeCloseTo(1.15);
  });

  it('handles identity (2-byte) font metrics', () => {
    const font: FontInfo = {
      toUnicode: null,
      encoding: null,
      differences: null,
      isIdentity: true,
      baseFont: 'CIDFont',
      widths: new Map([
        [0x0048, 500],
        [0x0065, 200],
        [0x0020, 250],
      ]),
      defaultWidth: 1000,
    };
    // H (0x0048) e (0x0065) space (0x0020)
    const bytes = new Uint8Array([0x00, 0x48, 0x00, 0x65, 0x00, 0x20]);
    const m = computeTextMetrics(bytes, font);
    expect(m.charCount).toBe(3);
    expect(m.spaceCount).toBe(1);
    expect(m.totalWidth).toBeCloseTo(0.5 + 0.2 + 0.25);
  });
});

describe('getCharWidth', () => {
  it('returns font width when available, defaultWidth otherwise', () => {
    const font: FontInfo = {
      toUnicode: null,
      encoding: null,
      differences: null,
      isIdentity: false,
      baseFont: 'TestFont',
      widths: new Map([[72, 500]]),
      defaultWidth: 600,
    };
    expect(getCharWidth(72, font)).toBe(0.5);
    expect(getCharWidth(99, font)).toBe(0.6); // defaultWidth/1000
  });
});
