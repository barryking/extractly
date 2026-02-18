import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Extractly } from '../../src/index.js';
import { PdfParseError } from '../../src/errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, '..', 'fixtures');

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

describe('xref fallback recovery (full document scan)', () => {
  it('recovers from a bad startxref offset', () => {
    const doc = Extractly.fromBuffer(loadFixture('bad-xref.pdf'));
    expect(doc.pageCount).toBe(1);
    expect(doc.text).toContain('Bad XRef Recovery Test');
    doc.dispose();
  });

  it('extracts correct page count after recovery', () => {
    const doc = Extractly.fromBuffer(loadFixture('bad-xref.pdf'));
    expect(doc.pageCount).toBe(1);
    expect(doc.pages[0].text).toContain('Bad XRef Recovery Test');
    doc.dispose();
  });
});

describe('/Root in /Prev trailer recovery', () => {
  it('finds /Root in earlier trailer via /Prev chain', () => {
    const doc = Extractly.fromBuffer(loadFixture('root-in-prev.pdf'));
    expect(doc.pageCount).toBe(1);
    expect(doc.text).toContain('Root In Prev Test');
    doc.dispose();
  });
});

describe('unrecoverable PDFs still throw', () => {
  it('throws PdfParseError for completely empty content', () => {
    const data = new TextEncoder().encode('%PDF-1.4\ngarbage without any obj markers\nstartxref\n0\n%%EOF\n');
    expect(() => Extractly.fromBuffer(data)).toThrow(PdfParseError);
  });

  it('throws PdfParseError for PDF with no /Root anywhere', () => {
    const enc = new TextEncoder();
    const parts = [
      '%PDF-1.4\n',
      '1 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n\n',
      'xref\n0 2\n0000000000 65535 f \r\n0000000010 00000 n \r\n',
      'trailer\n<< /Size 2 >>\n',
      'startxref\n9999\n%%EOF\n',
    ];
    const data = enc.encode(parts.join(''));
    expect(() => Extractly.fromBuffer(data)).toThrow('Trailer missing /Root entry');
  });
});
