import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { decodeStream } from '../../src/stream/decoder.js';
import { pdfDict, pdfName } from '../../src/parser/types.js';

describe('decodeStream', () => {
  it('returns data unchanged with no /Filter (empty Map dict)', () => {
    const data = new Uint8Array([0x48, 0x69]);
    const dict = pdfDict(new Map());
    const result = decodeStream(data, dict);
    expect(result).toEqual(data);
  });

  it('applies FlateDecode', () => {
    const original = Buffer.from('hello');
    const compressed = deflateSync(original);
    const dict = pdfDict(new Map([['Filter', pdfName('FlateDecode')]]));
    const result = decodeStream(new Uint8Array(compressed), dict);
    expect(new TextDecoder().decode(result)).toBe('hello');
  });

  it('applies ASCIIHexDecode (hex encoding of AB is 4142>)', () => {
    const encoded = new TextEncoder().encode('4142>');
    const dict = pdfDict(new Map([['Filter', pdfName('ASCIIHexDecode')]]));
    const result = decodeStream(encoded, dict);
    expect(new TextDecoder().decode(result)).toBe('AB');
  });

  it('returns data as-is for unsupported filter (e.g. CCITTFaxDecode)', () => {
    const data = new Uint8Array([0x01, 0x02, 0x03]);
    const dict = pdfDict(new Map([['Filter', pdfName('CCITTFaxDecode')]]));
    const result = decodeStream(data, dict);
    expect(result).toEqual(data);
  });
});
