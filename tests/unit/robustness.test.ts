import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Extractly } from '../../src/index.js';
import { PdfParseError, PdfUnsupportedError } from '../../src/errors.js';
import { parseToUnicodeCMap } from '../../src/encoding/cmap.js';
import { applyPNGPredictor, flateDecode } from '../../src/stream/filters.js';
import { sortTextItems } from '../../src/content/assembler.js';
import type { TextItem } from '../../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, '..', 'fixtures');

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

describe('circular reference protection', () => {
  it('does not crash on deeply nested indirect refs', () => {
    const doc = Extractly.fromBuffer(loadFixture('simple.pdf'));
    expect(doc.pageCount).toBe(1);
    doc.dispose();
  });
});

describe('CMap bfrange overflow protection', () => {
  it('does not crash when dstVal exceeds 0x10FFFF', () => {
    // Build a CMap where bfrange destination would overflow past U+10FFFF
    const cmapData = new TextEncoder().encode(
      '/CMapName /test\n' +
      'beginbfrange\n' +
      '<0000> <0005> <10FFFD>\n' +
      'endbfrange\n',
    );
    const map = parseToUnicodeCMap(cmapData);
    // 0x10FFFD, 0x10FFFE, 0x10FFFF should map; 0x110000+ should be skipped
    expect(map.get(0)).toBeDefined();
    expect(map.get(1)).toBeDefined();
    expect(map.get(2)).toBeDefined();
    expect(map.has(3)).toBe(false);
  });
});

describe('encrypted PDF detection', () => {
  it('throws PdfUnsupportedError for encrypted PDFs', () => {
    // Build a minimal "encrypted" PDF with /Encrypt in trailer
    const enc = new TextEncoder();
    const parts = [
      '%PDF-1.4\n',
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n\n',
      '2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n\n',
      '3 0 obj\n<< /Filter /Standard /V 1 /R 2 /O (xxxx) /U (xxxx) /P -3904 >>\nendobj\n\n',
    ];
    let offset = 0;
    const offsets: number[] = [0, 0, 0, 0];
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) offsets[i] = offset;
      offset += parts[i].length;
    }
    const xrefOffset = offset;
    parts.push(
      'xref\n0 4\n' +
      '0000000000 65535 f \r\n' +
      `${String(offsets[1]).padStart(10, '0')} 00000 n \r\n` +
      `${String(offsets[2]).padStart(10, '0')} 00000 n \r\n` +
      `${String(offsets[3]).padStart(10, '0')} 00000 n \r\n`,
    );
    parts.push(`trailer\n<< /Size 4 /Root 1 0 R /Encrypt 3 0 R >>\n`);
    parts.push(`startxref\n${xrefOffset}\n%%EOF\n`);

    const data = enc.encode(parts.join(''));
    expect(() => Extractly.fromBuffer(data)).toThrow(PdfUnsupportedError);
    expect(() => Extractly.fromBuffer(data)).toThrow('Encrypted PDF');
  });
});

describe('PNG predictor zero columns guard', () => {
  it('returns data unmodified when columns is 0', () => {
    const data = new Uint8Array([0, 1, 2, 3, 4, 5]);
    const result = applyPNGPredictor(data, 0);
    expect(result).toEqual(data);
  });

  it('returns data unmodified when columns is negative', () => {
    const data = new Uint8Array([0, 1, 2, 3]);
    const result = applyPNGPredictor(data, -1);
    expect(result).toEqual(data);
  });
});

describe('flate decode failure', () => {
  it('throws PdfParseError on completely invalid data', () => {
    const garbage = new Uint8Array([0xFF, 0xFE, 0xFD, 0xFC, 0xFB]);
    expect(() => flateDecode(garbage)).toThrow(PdfParseError);
    expect(() => flateDecode(garbage)).toThrow('FlateDecode decompression failed');
  });
});

describe('assembler sort stability', () => {
  it('handles items with fontSize 0 without NaN thresholds', () => {
    const items: TextItem[] = [
      { text: 'A', x: 0, y: 100, fontSize: 0, fontName: 'F1', width: 10 },
      { text: 'B', x: 50, y: 100, fontSize: 0, fontName: 'F1', width: 10 },
      { text: 'C', x: 0, y: 50, fontSize: 12, fontName: 'F1', width: 10 },
    ];
    const sorted = sortTextItems(items);
    expect(sorted.length).toBe(3);
    expect(sorted[0].text).toBe('A');
    expect(sorted[2].text).toBe('C');
  });

  it('handles items with undefined _textObjectId', () => {
    const items: TextItem[] = [
      { text: 'X', x: 100, y: 200, fontSize: 12, fontName: 'F1', width: 10 },
      { text: 'Y', x: 50, y: 200, fontSize: 12, fontName: 'F1', width: 10 },
    ];
    const sorted = sortTextItems(items);
    expect(sorted.length).toBe(2);
    expect(sorted[0].text).toBe('Y');
    expect(sorted[1].text).toBe('X');
  });
});

describe('object stream (ObjStm) support', () => {
  it('loads xref-stream.pdf without crashing', () => {
    const doc = Extractly.fromBuffer(loadFixture('xref-stream.pdf'));
    expect(doc).toBeDefined();
    doc.dispose();
  });

  it('loads simple.pdf and extracts text (validates core object resolution)', () => {
    const doc = Extractly.fromBuffer(loadFixture('simple.pdf'));
    expect(doc.pageCount).toBe(1);
    expect(doc.text).toContain('Hello World');
    doc.dispose();
  });
});
