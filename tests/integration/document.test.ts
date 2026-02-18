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

describe('Extractly - Document API', () => {
  describe('loading', () => {
    it('loads from a Uint8Array', async () => {
      const data = loadFixture('simple.pdf');
      const doc = await Extractly.load(data);
      expect(doc).toBeInstanceOf(Extractly);
    });

    it('loads from a file path', async () => {
      const path = join(fixturesDir, 'simple.pdf');
      const doc = await Extractly.load(path);
      expect(doc).toBeInstanceOf(Extractly);
    });

    it('loads synchronously from buffer', () => {
      const data = loadFixture('simple.pdf');
      const doc = Extractly.fromBuffer(data);
      expect(doc).toBeInstanceOf(Extractly);
    });
  });

  describe('text extraction', () => {
    it('extracts text from a simple PDF', async () => {
      const data = loadFixture('simple.pdf');
      const doc = await Extractly.load(data);

      expect(doc.text).toContain('Hello World');
    });

    it('extracts text from each page separately', async () => {
      const data = loadFixture('multipage.pdf');
      const doc = await Extractly.load(data);

      expect(doc.pageCount).toBe(2);
      expect(doc.pages[0].text).toContain('Page One');
      expect(doc.pages[1].text).toContain('Page Two');
    });

    it('concatenates page text with separator', async () => {
      const data = loadFixture('multipage.pdf');
      const doc = await Extractly.load(data);

      expect(doc.text).toContain('Page One');
      expect(doc.text).toContain('Page Two');
    });

    it('uses custom page separator', async () => {
      const data = loadFixture('multipage.pdf');
      const doc = await Extractly.load(data, { pageSeparator: '\n---\n' });

      expect(doc.text).toContain('---');
    });

    it('handles TJ operator text', async () => {
      const data = loadFixture('tj-array.pdf');
      const doc = await Extractly.load(data);

      const text = doc.text;
      expect(text).toContain('H');
      expect(text).toContain('ello');
      expect(text).toContain('orld');
    });

    it('returns empty text for empty pages', async () => {
      const data = loadFixture('empty.pdf');
      const doc = await Extractly.load(data);

      expect(doc.text).toBe('');
      expect(doc.pages[0].text).toBe('');
    });

    it('does not insert spurious spaces in per-character-positioned text', async () => {
      const data = loadFixture('char-positioned.pdf');
      const doc = await Extractly.load(data);

      const text = doc.text;
      // "Amount" must not be split as "Am ount" or similar
      expect(text).toContain('Amount');
      expect(text).not.toMatch(/Am\s+ount/);

      // "Wire" must not be split as "W ire"
      expect(text).toContain('Wire');
      expect(text).not.toMatch(/W\s+ire/);

      // "November" must not be split (TJ kerning)
      expect(text).toContain('November');
      expect(text).not.toMatch(/Novem\s+ber/);
    });

    it('preserves word boundaries in per-character-positioned text', async () => {
      const data = loadFixture('char-positioned.pdf');
      const doc = await Extractly.load(data);

      // "Amount" and "due" should be separate words
      expect(doc.text).toMatch(/Amount\s+due/);
    });
  });

  describe('markdown output', () => {
    it('produces markdown output', async () => {
      const data = loadFixture('multitext.pdf');
      const doc = await Extractly.load(data);

      const md = docToMarkdown(doc);
      expect(md.length).toBeGreaterThan(0);
      expect(md).toContain('Large Heading');
      expect(md).toContain('body text');
    });

    it('infers headings from font size', async () => {
      const data = loadFixture('multitext.pdf');
      const doc = await Extractly.load(data);

      const md = pageToMarkdown(doc.pages[0]);
      expect(md).toMatch(/^#+\s+Large Heading/m);
    });

    it('returns empty markdown for empty pages', async () => {
      const data = loadFixture('empty.pdf');
      const doc = await Extractly.load(data);

      expect(docToMarkdown(doc)).toBe('');
    });

    it('wraps bold text in ** markers', async () => {
      const data = loadFixture('bold-italic.pdf');
      const doc = await Extractly.load(data);
      const md = pageToMarkdown(doc.pages[0]);

      expect(md).toContain('**bold**');
      expect(md).toContain('**Entirely bold line**');
    });

    it('wraps italic text in * markers', async () => {
      const data = loadFixture('bold-italic.pdf');
      const doc = await Extractly.load(data);
      const md = pageToMarkdown(doc.pages[0]);

      expect(md).toContain('*italic*');
      expect(md).not.toContain('**italic**');
    });

    it('wraps bold+italic text in *** markers', async () => {
      const data = loadFixture('bold-italic.pdf');
      const doc = await Extractly.load(data);
      const md = pageToMarkdown(doc.pages[0]);

      expect(md).toContain('***Bold and italic combined***');
    });

    it('renders annotation links as markdown links', async () => {
      const data = loadFixture('links.pdf');
      const doc = await Extractly.load(data);
      const md = pageToMarkdown(doc.pages[0]);

      expect(md).toContain('[Example Site](https://example.com)');
    });

    it('auto-detects plain-text URLs as markdown links', async () => {
      const data = loadFixture('links.pdf');
      const doc = await Extractly.load(data);
      const md = pageToMarkdown(doc.pages[0]);

      expect(md).toContain('[https://example.org/path](https://example.org/path)');
    });

    it('detects and renders tables as markdown tables', async () => {
      const data = loadFixture('table.pdf');
      const doc = await Extractly.load(data);
      const md = pageToMarkdown(doc.pages[0]);

      expect(md).toContain('| Name');
      expect(md).toContain('| Widget A');
      expect(md).toContain('| $25.50');
      expect(md).toMatch(/\| -+/);
      expect(md).toMatch(/^#+\s+Product List/m);
      expect(md).toContain('Total items: 47');
    });
  });

  describe('metadata', () => {
    it('extracts metadata from PDF', async () => {
      const data = loadFixture('metadata.pdf');
      const doc = await Extractly.load(data);

      expect(doc.metadata.title).toBe('Test Document');
      expect(doc.metadata.author).toBe('extractly Test Suite');
      expect(doc.metadata.subject).toBe('Testing metadata extraction');
      expect(doc.metadata.creator).toBe('extractly fixture generator');
      expect(doc.metadata.producer).toBe('extractly');
    });

    it('reports page count', async () => {
      const data = loadFixture('multipage.pdf');
      const doc = await Extractly.load(data);

      expect(doc.metadata.pageCount).toBe(2);
    });

    it('handles missing metadata gracefully', async () => {
      const data = loadFixture('simple.pdf');
      const doc = await Extractly.load(data);

      expect(doc.metadata.pageCount).toBe(1);
      // Optional fields should be undefined
      expect(doc.metadata.title).toBeUndefined();
    });
  });

  describe('page iteration', () => {
    it('supports for...of iteration', async () => {
      const data = loadFixture('multipage.pdf');
      const doc = await Extractly.load(data);

      const pageNumbers: number[] = [];
      for (const page of doc) {
        pageNumbers.push(page.number);
      }
      expect(pageNumbers).toEqual([1, 2]);
    });

    it('pages have 1-based numbering', async () => {
      const data = loadFixture('simple.pdf');
      const doc = await Extractly.load(data);

      expect(doc.pages[0].number).toBe(1);
    });
  });

  describe('coordinate transforms (CTM)', () => {
    it('produces correct reading order for flipped-Y coordinate PDFs', async () => {
      const data = loadFixture('flipped-y.pdf');
      const doc = await Extractly.load(data);
      const text = doc.pages[0].text;

      // "Invoice Title" should come FIRST (it's at the visual top)
      // "Page 1 of 1" should come LAST (it's at the visual bottom)
      const titleIndex = text.indexOf('Invoice Title');
      const footerIndex = text.indexOf('Page 1 of 1');
      expect(titleIndex).toBeGreaterThanOrEqual(0);
      expect(footerIndex).toBeGreaterThan(titleIndex);
    });

    it('preserves line ordering within flipped-Y content', async () => {
      const data = loadFixture('flipped-y.pdf');
      const doc = await Extractly.load(data);
      const text = doc.pages[0].text;

      const idx1 = text.indexOf('Line item one');
      const idx2 = text.indexOf('Line item two');
      const idx3 = text.indexOf('Line item three');
      expect(idx1).toBeLessThan(idx2);
      expect(idx2).toBeLessThan(idx3);
    });

    it('applies CTM to markdown output as well', async () => {
      const data = loadFixture('flipped-y.pdf');
      const doc = await Extractly.load(data);
      const md = pageToMarkdown(doc.pages[0]);

      const titleIndex = md.indexOf('Invoice Title');
      const footerIndex = md.indexOf('Page 1 of 1');
      expect(titleIndex).toBeGreaterThanOrEqual(0);
      expect(footerIndex).toBeGreaterThan(titleIndex);
    });
  });

  describe('xref stream parsing', () => {
    it('loads PDFs with cross-reference streams without error', async () => {
      const data = loadFixture('xref-stream.pdf');
      // The key assertion: this should NOT throw "extractly: /W array must have 3 entries"
      const doc = await Extractly.load(data);
      expect(doc).toBeDefined();
    });
  });

  describe('serialization', () => {
    it('produces JSON-serializable output', async () => {
      const data = loadFixture('metadata.pdf');
      const doc = await Extractly.load(data);

      const json = doc.toJSON();
      expect(json.metadata.title).toBe('Test Document');
      expect(json.pages.length).toBe(1);
      expect(json.pages[0].number).toBe(1);
      expect(json.pages[0].text.length).toBeGreaterThan(0);

      // Should be serializable
      const str = JSON.stringify(json);
      const parsed = JSON.parse(str);
      expect(parsed.metadata.title).toBe('Test Document');
    });
  });

  describe('form placeholder stripping', () => {
    it('strips DocuSign placeholders by default', async () => {
      const data = loadFixture('docusign-placeholders.pdf');
      const doc = await Extractly.load(data);
      const text = doc.text;

      expect(text).not.toContain('\\signature1\\');
      expect(text).not.toContain('\\namehere1\\');
      expect(text).not.toContain('\\titlehere2\\');
      expect(text).not.toContain('\\POhere1\\');

      // Underscore-style placeholders (self-closing and open tag)
      expect(text).not.toContain('\\IIO_Finance_Contact_Name_1\\');
      expect(text).not.toContain('\\IIO_Finance_Contact_Email_2');

      expect(text).toContain('Peter Horst');
      expect(text).toContain('Jeff Miller');
      expect(text).toContain('Chief Technology Officer');
      expect(text).toContain('Senior Deal Desk Manager');
      expect(text).toContain('November 24, 2023');
      expect(text).toContain('Jane Doe');
      expect(text).toContain('jane@example.com');
    });

    it('preserves placeholders when stripFormPlaceholders is false', async () => {
      const data = loadFixture('docusign-placeholders.pdf');
      const doc = await Extractly.load(data, { stripFormPlaceholders: false });
      const text = doc.text;

      expect(text).toContain('\\signature1\\');
      expect(text).toContain('\\namehere1\\');
      expect(text).toContain('\\titlehere2\\');
      expect(text).toContain('\\POhere1\\');
      expect(text).toContain('\\IIO_Finance_Contact_Name_1\\');
      expect(text).toContain('\\IIO_Finance_Contact_Email_2');
      expect(text).toContain('Peter Horst');
    });

    it('strips placeholders from markdown output by default', async () => {
      const data = loadFixture('docusign-placeholders.pdf');
      const doc = await Extractly.load(data);
      const md = pageToMarkdown(doc.pages[0]);

      expect(md).not.toContain('\\signature1\\');
      expect(md).not.toContain('\\titlehere1\\');
      expect(md).not.toContain('\\IIO_Finance_Contact_Name_1');
      expect(md).toContain('Chief Technology Officer');
      expect(md).toContain('Jeff Miller');
      expect(md).toContain('Jane Doe');
    });

    it('preserves placeholders in markdown when opted out', async () => {
      const data = loadFixture('docusign-placeholders.pdf');
      const doc = await Extractly.load(data, { stripFormPlaceholders: false });
      const md = pageToMarkdown(doc.pages[0]);

      expect(md).toContain('\\signature1\\');
      expect(md).toContain('\\titlehere1\\');
      expect(md).toContain('\\IIO_Finance_Contact_Name_1');
      expect(md).toContain('Chief Technology Officer');
    });
  });
});
