import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Browser entry point', () => {
  it('exports Extractly, PDFPage, and error classes', async () => {
    const browser = await import('../../src/browser.js');
    expect(browser.Extractly).toBeDefined();
    expect(browser.PDFPage).toBeDefined();
    expect(browser.ExtractlyError).toBeDefined();
    expect(browser.PdfParseError).toBeDefined();
    expect(browser.PdfUnsupportedError).toBeDefined();
  });

  it('fromBuffer works via the browser entry', async () => {
    const { Extractly } = await import('../../src/browser.js');
    const fixture = new Uint8Array(
      readFileSync(join(__dirname, '../fixtures/simple.pdf')),
    );
    const doc = Extractly.fromBuffer(fixture);
    expect(doc.pageCount).toBeGreaterThan(0);
    expect(doc.text).toBeTruthy();
  });

  it('browser build artifact has no node:zlib or node:fs imports', () => {
    const browserBundle = readFileSync(
      join(__dirname, '../../dist/browser.js'),
      'utf-8',
    );
    expect(browserBundle).not.toMatch(/['"]node:zlib['"]/);
    expect(browserBundle).not.toMatch(/['"]node:fs['"]/);
    expect(browserBundle).not.toMatch(/['"]node:fs\/promises['"]/);
    expect(browserBundle).toMatch(/from ['"]fflate['"]/);
  });
});
