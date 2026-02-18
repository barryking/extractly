import { describe, it, expect } from 'vitest';
import {
  ExtractlyError,
  PdfParseError,
  PdfUnsupportedError,
} from '../../src/errors.js';
import { Extractly } from '../../src/index.js';

describe('ExtractlyError', () => {
  it('PdfParseError is instanceof ExtractlyError and Error', () => {
    const err = new PdfParseError('test');
    expect(err).toBeInstanceOf(ExtractlyError);
    expect(err).toBeInstanceOf(Error);
  });

  it('PdfUnsupportedError is instanceof ExtractlyError and Error', () => {
    const err = new PdfUnsupportedError('test');
    expect(err).toBeInstanceOf(ExtractlyError);
    expect(err).toBeInstanceOf(Error);
  });

  it('PdfParseError.offset stores the byte offset', () => {
    const err = new PdfParseError('parse failed', 42);
    expect(err.offset).toBe(42);
  });

  it('PdfParseError.offset is undefined when not provided', () => {
    const err = new PdfParseError('parse failed');
    expect(err.offset).toBeUndefined();
  });

  it('error.name is correct for ExtractlyError', () => {
    const err = new ExtractlyError('test');
    expect(err.name).toBe('ExtractlyError');
  });

  it('error.name is correct for PdfParseError', () => {
    const err = new PdfParseError('test');
    expect(err.name).toBe('PdfParseError');
  });

  it('error.name is correct for PdfUnsupportedError', () => {
    const err = new PdfUnsupportedError('test');
    expect(err.name).toBe('PdfUnsupportedError');
  });
});

describe('invalid PDF loading', () => {
  it('loading garbage bytes throws PdfParseError', () => {
    expect(() => Extractly.fromBuffer(new Uint8Array([1, 2, 3]))).toThrow(
      PdfParseError,
    );
  });

  it('loading truncated PDF (just %PDF-1.4) throws PdfParseError', () => {
    const truncated = new TextEncoder().encode('%PDF-1.4');
    expect(() => Extractly.fromBuffer(truncated)).toThrow(PdfParseError);
  });
});
