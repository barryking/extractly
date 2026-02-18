import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfParser } from '../../src/parser/parser.js';
import { extractTextItems } from '../../src/content/interpreter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', 'fixtures');

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, name)));
}

describe('Content Stream Interpreter', () => {
  it('extracts text items from a simple page', () => {
    const data = loadFixture('simple.pdf');
    const parser = new PdfParser(data);
    parser.parse();

    const pages = parser.getPages();
    const items = extractTextItems(pages[0], parser);

    expect(items.length).toBeGreaterThan(0);
    expect(items.some(i => i.text.includes('Hello'))).toBe(true);
  });

  it('extracts text from TJ array operator', () => {
    const data = loadFixture('tj-array.pdf');
    const parser = new PdfParser(data);
    parser.parse();

    const pages = parser.getPages();
    const items = extractTextItems(pages[0], parser);

    const allText = items.map(i => i.text).join('');
    expect(allText).toContain('H');
    expect(allText).toContain('ello');
    expect(allText).toContain('W');
    expect(allText).toContain('orld');
  });

  it('extracts text from multiple text operations', () => {
    const data = loadFixture('multitext.pdf');
    const parser = new PdfParser(data);
    parser.parse();

    const pages = parser.getPages();
    const items = extractTextItems(pages[0], parser);

    const texts = items.map(i => i.text);
    expect(texts).toContain('Large Heading');
    expect(texts.some(t => t.includes('body text'))).toBe(true);
  });

  it('records font size in text items', () => {
    const data = loadFixture('multitext.pdf');
    const parser = new PdfParser(data);
    parser.parse();

    const pages = parser.getPages();
    const items = extractTextItems(pages[0], parser);

    // The heading should have a larger font size than body text
    const headingItem = items.find(i => i.text === 'Large Heading');
    const bodyItem = items.find(i => i.text.includes('body text'));

    expect(headingItem).toBeDefined();
    expect(bodyItem).toBeDefined();

    if (headingItem && bodyItem) {
      expect(headingItem.fontSize).toBeGreaterThan(bodyItem.fontSize);
    }
  });

  it('returns empty array for empty page', () => {
    const data = loadFixture('empty.pdf');
    const parser = new PdfParser(data);
    parser.parse();

    const pages = parser.getPages();
    const items = extractTextItems(pages[0], parser);

    expect(items.length).toBe(0);
  });
});
