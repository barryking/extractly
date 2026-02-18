import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Extractly } from '../../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', 'fixtures');

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, name)));
}

describe('PDFPage', () => {
  describe('error boundaries', () => {
    it('page.error is null for successfully extracted pages', () => {
      const data = loadFixture('simple.pdf');
      const doc = Extractly.fromBuffer(data);
      const page = doc.pages[0];

      void page.textItems;
      expect(page.error).toBeNull();
    });

    it('doc.text skips failed pages gracefully', () => {
      const data = loadFixture('simple.pdf');
      const doc = Extractly.fromBuffer(data);

      expect(doc.text.length).toBeGreaterThan(0);
      expect(doc.text).toContain('Hello World');
    });

    it('page.error triggers extraction when accessed before textItems', () => {
      const data = loadFixture('simple.pdf');
      const doc = Extractly.fromBuffer(data);
      const page = doc.pages[0];

      expect(page.error).toBeNull();
      expect(page.text.length).toBeGreaterThan(0);
    });
  });
});
