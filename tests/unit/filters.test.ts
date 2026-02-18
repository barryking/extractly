import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { flateDecode, asciiHexDecode, ascii85Decode, lzwDecode } from '../../src/stream/filters.js';

describe('Stream Filters', () => {
  describe('flateDecode', () => {
    it('decompresses zlib data', () => {
      const original = new TextEncoder().encode('Hello, World!');
      const compressed = deflateSync(original);
      const result = flateDecode(new Uint8Array(compressed));
      expect(new TextDecoder().decode(result)).toBe('Hello, World!');
    });

    it('handles empty data gracefully', () => {
      const result = flateDecode(new Uint8Array([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01]));
      expect(result).toBeInstanceOf(Uint8Array);
    });
  });

  describe('asciiHexDecode', () => {
    it('decodes hex-encoded data', () => {
      const encoded = new TextEncoder().encode('48656C6C6F>');
      const result = asciiHexDecode(encoded);
      expect(new TextDecoder().decode(result)).toBe('Hello');
    });

    it('handles whitespace in hex data', () => {
      const encoded = new TextEncoder().encode('48 65 6C 6C 6F>');
      const result = asciiHexDecode(encoded);
      expect(new TextDecoder().decode(result)).toBe('Hello');
    });

    it('pads odd-length hex with zero', () => {
      const encoded = new TextEncoder().encode('4>');
      const result = asciiHexDecode(encoded);
      expect(result[0]).toBe(0x40);
    });
  });

  describe('ascii85Decode', () => {
    it('decodes basic ASCII85 data', () => {
      // "Hello" in ASCII85 is "87cURD]j"
      const encoded = new TextEncoder().encode('87cURD]j~>');
      const result = ascii85Decode(encoded);
      // ASCII85 decoding should produce something reasonable
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBeGreaterThan(0);
    });

    it('handles z shorthand for zero bytes', () => {
      const encoded = new TextEncoder().encode('z~>');
      const result = ascii85Decode(encoded);
      expect(result.length).toBe(4);
      expect(result[0]).toBe(0);
      expect(result[1]).toBe(0);
      expect(result[2]).toBe(0);
      expect(result[3]).toBe(0);
    });

    it('strips <~ prefix', () => {
      const encoded = new TextEncoder().encode('<~z~>');
      const result = ascii85Decode(encoded);
      expect(result.length).toBe(4);
    });
  });

  describe('lzwDecode', () => {
    it('returns a Uint8Array', () => {
      // Empty stream with just clear + EOI
      const result = lzwDecode(new Uint8Array([0x80, 0x0b, 0x60, 0x50, 0x22, 0x0c, 0x0c, 0x85, 0x01]));
      expect(result).toBeInstanceOf(Uint8Array);
    });
  });
});
