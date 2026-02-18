import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Extractly } from '../../src/index.js';
import { docToMarkdown, pageToMarkdown } from '../../src/markdown-entry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', 'fixtures');

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, name)));
}

describe('markdown-entry', () => {
  describe('pageToMarkdown', () => {
    it('returns markdown string for a page with headings', () => {
      const data = loadFixture('multitext.pdf');
      const doc = Extractly.fromBuffer(data);
      const result = pageToMarkdown(doc.pages[0]);

      expect(result).toMatch(/#+\s+Large Heading/);
      expect(result).toContain('Large Heading');
    });

    it('returns empty string for empty page', () => {
      const data = loadFixture('empty.pdf');
      const doc = Extractly.fromBuffer(data);

      expect(pageToMarkdown(doc.pages[0])).toBe('');
    });

    it('includes bold/italic formatting', () => {
      const data = loadFixture('bold-italic.pdf');
      const doc = Extractly.fromBuffer(data);
      const result = pageToMarkdown(doc.pages[0]);

      expect(result).toContain('**');
      expect(result).toContain('*');
    });

    it('includes link annotations', () => {
      const data = loadFixture('links.pdf');
      const doc = Extractly.fromBuffer(data);
      const result = pageToMarkdown(doc.pages[0]);

      expect(result).toMatch(/\[.*\]\(/);
    });

    it('includes detected tables', () => {
      const data = loadFixture('table.pdf');
      const doc = Extractly.fromBuffer(data);
      const result = pageToMarkdown(doc.pages[0]);

      expect(result).toContain('| Name');
    });
  });

  describe('docToMarkdown', () => {
    it('concatenates all pages', () => {
      const data = loadFixture('multipage.pdf');
      const doc = Extractly.fromBuffer(data);
      const result = docToMarkdown(doc);

      expect(result).toContain('Page One');
      expect(result).toContain('Page Two');
    });

    it('respects custom separator', () => {
      const data = loadFixture('multipage.pdf');
      const doc = Extractly.fromBuffer(data);
      const result = docToMarkdown(doc, '---');

      expect(result).toContain('---');
    });

    it('skips empty pages', () => {
      const data = loadFixture('empty.pdf');
      const doc = Extractly.fromBuffer(data);

      expect(docToMarkdown(doc)).toBe('');
    });
  });
});
