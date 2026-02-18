import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfParser } from '../../src/parser/parser.js';
import { isDict, isName, dictGetName, dictGetNumber } from '../../src/parser/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', 'fixtures');

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, name)));
}

describe('PdfParser', () => {
  it('parses a simple PDF structure', () => {
    const data = loadFixture('simple.pdf');
    const parser = new PdfParser(data);
    parser.parse();

    const trailer = parser.getTrailer();
    expect(trailer.root).toBeDefined();
    expect(trailer.root.objNum).toBe(1);
  });

  it('resolves the catalog', () => {
    const data = loadFixture('simple.pdf');
    const parser = new PdfParser(data);
    parser.parse();

    const catalog = parser.getCatalog();
    expect(isDict(catalog)).toBe(true);
    expect(dictGetName(catalog, 'Type')).toBe('Catalog');
  });

  it('enumerates pages', () => {
    const data = loadFixture('simple.pdf');
    const parser = new PdfParser(data);
    parser.parse();

    const pages = parser.getPages();
    expect(pages.length).toBe(1);
    expect(dictGetName(pages[0], 'Type')).toBe('Page');
  });

  it('enumerates pages in multi-page PDF', () => {
    const data = loadFixture('multipage.pdf');
    const parser = new PdfParser(data);
    parser.parse();

    const pages = parser.getPages();
    expect(pages.length).toBe(2);
  });

  it('reads info dictionary', () => {
    const data = loadFixture('metadata.pdf');
    const parser = new PdfParser(data);
    parser.parse();

    const info = parser.getInfoDict();
    expect(info).not.toBeNull();
  });

  it('handles empty page', () => {
    const data = loadFixture('empty.pdf');
    const parser = new PdfParser(data);
    parser.parse();

    const pages = parser.getPages();
    expect(pages.length).toBe(1);
  });
});
