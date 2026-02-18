import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Extractly } from '../../src/index.js';
import { PdfUnsupportedError } from '../../src/errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', 'fixtures');

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, name)));
}

describe('indirect /Length resolution', () => {
  it('correctly parses streams with indirect Length references', () => {
    const data = loadFixture('indirect-length.pdf');
    const doc = Extractly.fromBuffer(data);
    expect(doc.pageCount).toBe(1);
    expect(doc.pages[0].text).toContain('Indirect Length Test');
    expect(doc.pages[0].error).toBeNull();
  });
});

describe('encrypted PDF with empty user password', () => {
  it('decrypts and extracts text from AES-128-CBC encrypted PDF', () => {
    const data = loadFixture('encrypted-empty-password.pdf');
    const doc = Extractly.fromBuffer(data);
    expect(doc.pageCount).toBe(1);
    expect(doc.pages[0].text).toContain('Hello encrypted world');
    expect(doc.pages[0].error).toBeNull();
  });

  it('throws PdfUnsupportedError for truly password-protected PDFs', () => {
    const enc = new TextEncoder();
    const parts = [
      '%PDF-1.4\n',
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n\n',
      '2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n\n',
      '3 0 obj\n<< /Filter /Standard /V 1 /R 2 /O (xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx) /U (xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx) /P -3904 >>\nendobj\n\n',
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
    const fileId = '6162636465666768696a6b6c6d6e6f70';
    parts.push(`trailer\n<< /Size 4 /Root 1 0 R /Encrypt 3 0 R /ID [<${fileId}> <${fileId}>] >>\n`);
    parts.push(`startxref\n${xrefOffset}\n%%EOF\n`);

    const data = enc.encode(parts.join(''));
    expect(() => Extractly.fromBuffer(data)).toThrow(PdfUnsupportedError);
    expect(() => Extractly.fromBuffer(data)).toThrow('Encrypted PDF requires a password');
  });
});
