import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Extractly, PDFPage } from '../../src/index.js';
import { PAGE_INTERNALS } from '../../src/page.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', 'fixtures');

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, name)));
}

describe('dispose pattern', () => {
  describe('Extractly.dispose()', () => {
    it('after doc.dispose(), internal page references are null', () => {
      const data = loadFixture('simple.pdf');
      const doc = Extractly.fromBuffer(data);
      const page = doc.pages[0];
      expect(page[PAGE_INTERNALS].pageDict).not.toBeNull();
      expect(page[PAGE_INTERNALS].parser).not.toBeNull();

      doc.dispose();
      expect(page[PAGE_INTERNALS].pageDict).toBeNull();
      expect(page[PAGE_INTERNALS].parser).toBeNull();
    });
  });

  describe('PDFPage.dispose()', () => {
    it('after page.dispose(), page.textItems is empty array', () => {
      const data = loadFixture('simple.pdf');
      const doc = Extractly.fromBuffer(data);
      const page = doc.pages[0];
      expect(page.textItems.length).toBeGreaterThan(0);

      page.dispose();
      expect(page.textItems).toEqual([]);
    });
  });

  describe('Symbol.dispose', () => {
    it('PDFPage [Symbol.dispose]() is alias for dispose()', () => {
      const data = loadFixture('simple.pdf');
      const doc = Extractly.fromBuffer(data);
      const page = doc.pages[0];
      expect(page.textItems.length).toBeGreaterThan(0);

      page[Symbol.dispose]();
      expect(page.textItems).toEqual([]);
      expect(page[PAGE_INTERNALS].pageDict).toBeNull();
      expect(page[PAGE_INTERNALS].parser).toBeNull();
    });

    it('Extractly [Symbol.dispose]() is alias for dispose()', () => {
      const data = loadFixture('simple.pdf');
      const doc = Extractly.fromBuffer(data);
      const page = doc.pages[0];
      expect(page[PAGE_INTERNALS].pageDict).not.toBeNull();

      doc[Symbol.dispose]();
      expect(page[PAGE_INTERNALS].pageDict).toBeNull();
      expect(page[PAGE_INTERNALS].parser).toBeNull();
    });
  });
});
