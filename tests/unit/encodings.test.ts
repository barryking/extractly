import { describe, it, expect } from 'vitest';
import {
  getEncodingByName,
  decodePdfString,
  WinAnsiEncoding,
  MacRomanEncoding,
} from '../../src/encoding/encodings.js';
import { glyphNameToUnicode } from '../../src/encoding/glyphlist.js';

describe('encodings', () => {
  describe('getEncodingByName', () => {
    it('returns WinAnsiEncoding for "WinAnsiEncoding"', () => {
      expect(getEncodingByName('WinAnsiEncoding')).toBe(WinAnsiEncoding);
    });

    it('returns MacRomanEncoding for "MacRomanEncoding"', () => {
      expect(getEncodingByName('MacRomanEncoding')).toBe(MacRomanEncoding);
    });

    it('returns null for unknown encoding', () => {
      expect(getEncodingByName('UnknownEncoding')).toBeNull();
    });
  });

  describe('decodePdfString', () => {
    it('decodes UTF-16 BE with BOM (bytes [0xFE, 0xFF, 0x00, 0x48, 0x00, 0x69] → "Hi")', () => {
      const bytes = new Uint8Array([0xfe, 0xff, 0x00, 0x48, 0x00, 0x69]);
      expect(decodePdfString(bytes)).toBe('Hi');
    });

    it('decodes UTF-8 with BOM (bytes [0xEF, 0xBB, 0xBF, 0x48, 0x69] → "Hi")', () => {
      const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x48, 0x69]);
      expect(decodePdfString(bytes)).toBe('Hi');
    });

    it('falls back to PDFDocEncoding (bytes [0x48, 0x69] → "Hi")', () => {
      const bytes = new Uint8Array([0x48, 0x69]);
      expect(decodePdfString(bytes)).toBe('Hi');
    });
  });
});

describe('glyphNameToUnicode', () => {
  it('maps standard names (e.g., "ampersand" → "&")', () => {
    expect(glyphNameToUnicode('ampersand')).toBe('&');
  });

  it('handles uniXXXX convention (e.g., "uni0041" → "A")', () => {
    expect(glyphNameToUnicode('uni0041')).toBe('A');
  });

  it('returns null for unknown names', () => {
    expect(glyphNameToUnicode('UnknownGlyph123')).toBeNull();
  });
});
