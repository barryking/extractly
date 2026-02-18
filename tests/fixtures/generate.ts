/**
 * Test PDF fixture generator.
 * Creates minimal valid PDFs for testing with correctly computed xref offsets.
 * Run with: npx tsx tests/fixtures/generate.ts
 */

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Helper to build a PDF with correct offsets */
class PdfBuilder {
  private objects: Array<{ num: number; gen: number; content: string }> = [];
  private infoRef: string | null = null;

  addObject(num: number, content: string, gen = 0): void {
    this.objects.push({ num, gen, content });
  }

  setInfo(ref: string): void {
    this.infoRef = ref;
  }

  build(): Uint8Array {
    const header = '%PDF-1.4\n';
    const parts: string[] = [header];
    const offsets = new Map<number, number>();

    let currentOffset = header.length;

    // Write objects
    for (const obj of this.objects) {
      offsets.set(obj.num, currentOffset);
      const objStr = `${obj.num} ${obj.gen} obj\n${obj.content}\nendobj\n\n`;
      parts.push(objStr);
      currentOffset += objStr.length;
    }

    // Write xref
    const xrefOffset = currentOffset;
    const maxObj = Math.max(...this.objects.map(o => o.num));
    const xrefLines: string[] = [
      `xref\n`,
      `0 ${maxObj + 1}\n`,
      `0000000000 65535 f \r\n`,
    ];

    for (let i = 1; i <= maxObj; i++) {
      const offset = offsets.get(i);
      if (offset !== undefined) {
        xrefLines.push(`${String(offset).padStart(10, '0')} 00000 n \r\n`);
      } else {
        xrefLines.push(`0000000000 65535 f \r\n`);
      }
    }

    parts.push(xrefLines.join(''));

    // Trailer
    let trailerExtra = '';
    if (this.infoRef) {
      trailerExtra = ` /Info ${this.infoRef}`;
    }
    parts.push(`trailer\n<< /Size ${maxObj + 1} /Root 1 0 R${trailerExtra} >>\n`);
    parts.push(`startxref\n${xrefOffset}\n%%EOF\n`);

    const fullContent = parts.join('');
    const encoder = new TextEncoder();
    return encoder.encode(fullContent);
  }
}

function save(name: string, data: Uint8Array): void {
  const path = join(__dirname, name);
  writeFileSync(path, data);
  console.log(`  Created ${name} (${data.length} bytes)`);
}

// ─── 1. Simple single-page PDF with plain text ───

function generateSimple(): void {
  const builder = new PdfBuilder();

  builder.addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  builder.addObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  builder.addObject(3,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]\n' +
    '   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>');

  const stream = 'BT\n/F1 12 Tf\n100 700 Td\n(Hello World) Tj\nET';
  builder.addObject(4, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  builder.addObject(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  save('simple.pdf', builder.build());
}

// ─── 2. Multi-page PDF ───

function generateMultiPage(): void {
  const builder = new PdfBuilder();

  builder.addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  builder.addObject(2, '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>');

  // Page 1
  builder.addObject(3,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]\n' +
    '   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>');
  const stream1 = 'BT\n/F1 12 Tf\n100 700 Td\n(Page One Text) Tj\nET';
  builder.addObject(4, `<< /Length ${stream1.length} >>\nstream\n${stream1}\nendstream`);
  builder.addObject(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  // Page 2
  builder.addObject(6,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]\n' +
    '   /Contents 7 0 R /Resources << /Font << /F1 5 0 R >> >> >>');
  const stream2 = 'BT\n/F1 12 Tf\n100 700 Td\n(Page Two Text) Tj\nET';
  builder.addObject(7, `<< /Length ${stream2.length} >>\nstream\n${stream2}\nendstream`);

  save('multipage.pdf', builder.build());
}

// ─── 3. PDF with metadata ───

function generateWithMetadata(): void {
  const builder = new PdfBuilder();

  builder.addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  builder.addObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  builder.addObject(3,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]\n' +
    '   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>');

  const stream = 'BT\n/F1 12 Tf\n100 700 Td\n(Hello Metadata) Tj\nET';
  builder.addObject(4, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  builder.addObject(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  builder.addObject(6,
    '<< /Title (Test Document)\n' +
    '   /Author (extractly Test Suite)\n' +
    '   /Subject (Testing metadata extraction)\n' +
    '   /Creator (extractly fixture generator)\n' +
    '   /Producer (extractly) >>');
  builder.setInfo('6 0 R');

  save('metadata.pdf', builder.build());
}

// ─── 4. PDF with multiple text operations (heading + body) ───

function generateMultiText(): void {
  const builder = new PdfBuilder();

  builder.addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  builder.addObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  builder.addObject(3,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]\n' +
    '   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>');

  const stream = [
    'BT',
    '/F1 24 Tf',
    '72 750 Td',
    '(Large Heading) Tj',
    '/F1 12 Tf',
    '0 -30 Td',
    '(This is body text on the first line.) Tj',
    '0 -15 Td',
    '(This is the second line of body text.) Tj',
    '0 -30 Td',
    '(A new paragraph after a gap.) Tj',
    'ET',
  ].join('\n');

  builder.addObject(4, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  builder.addObject(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  save('multitext.pdf', builder.build());
}

// ─── 5. PDF with TJ array operator ───

function generateTJArray(): void {
  const builder = new PdfBuilder();

  builder.addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  builder.addObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  builder.addObject(3,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]\n' +
    '   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>');

  const stream = 'BT\n/F1 12 Tf\n100 700 Td\n[(H) 20 (ello) -300 (W) 20 (orld)] TJ\nET';
  builder.addObject(4, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  builder.addObject(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  save('tj-array.pdf', builder.build());
}

// ─── 6. Empty page (no content stream) ───

function generateEmptyPage(): void {
  const builder = new PdfBuilder();

  builder.addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  builder.addObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  builder.addObject(3,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>');

  save('empty.pdf', builder.build());
}

// ─── 7. PDF with per-character positioning and font widths ───
// Reproduces the common pattern of CIDFont-like PDFs that position each
// glyph individually. Without accurate width handling, this produces
// spurious spaces like "Am ount" instead of "Amount".

function generateCharPositioned(): void {
  const builder = new PdfBuilder();

  builder.addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  builder.addObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  builder.addObject(3,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]\n' +
    '   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>');

  // Each character is positioned individually with Td, simulating per-glyph positioning.
  // Widths vary: 'A' is wide (7.22), 'm' is wide (8.89), 'o' is medium (6.11),
  // 'u' is medium (6.11), 'n' is medium (6.11), 't' is narrow (3.33)
  // After "Amount" there's a gap, then "due"
  const stream = [
    'BT',
    '/F1 12 Tf',
    // "Amount" - characters placed with realistic widths (no gaps within word)
    '100 700 Td', '(A) Tj',
    '8.67 0 Td', '(m) Tj',
    '10.67 0 Td', '(o) Tj',
    '7.33 0 Td', '(u) Tj',
    '7.33 0 Td', '(n) Tj',
    '7.33 0 Td', '(t) Tj',
    // Word gap: ~15pt advance from narrow "t" (4pt glyph) = ~11pt space
    '15.0 0 Td', '(d) Tj',
    '7.33 0 Td', '(u) Tj',
    '7.33 0 Td', '(e) Tj',
    'ET',
    // Second line: "Wire" with wide W
    'BT',
    '/F1 12 Tf',
    '100 680 Td', '(W) Tj',
    '10.0 0 Td', '(i) Tj',
    '3.33 0 Td', '(r) Tj',
    '4.0 0 Td', '(e) Tj',
    'ET',
    // Third line: "November" with TJ kerning
    'BT',
    '/F1 12 Tf',
    '100 660 Td',
    '[(N) -20 (o) -20 (v) -20 (e) -20 (m) -20 (b) -20 (e) -20 (r)] TJ',
    'ET',
  ].join('\n');

  // Font WITH /Widths array (Helvetica-like widths, partial coverage)
  // FirstChar=32 (space), covering printable ASCII
  // Widths in 1/1000 units for chars 32-122
  const widths = [
    250, // 32: space
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 33-43: punctuation (unused)
    0, 0, 0, 0, // 44-47
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 48-57: digits (unused)
    0, 0, 0, 0, 0, 0, 0, // 58-64
    722, // 65: A
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 66-75: B-K
    0, 0, 778, // 76-78: L, M, N
    0, 0, 0, 0, 0, 0, 0, 0, // 79-86: O-V
    944, // 87: W
    0, 0, 0, 0, 0, 0, 0, // 88-94
    0, 0, // 95-96: underscore, backtick
    556, // 97: a
    611, // 98: b
    556, // 99: c
    611, // 100: d
    556, // 101: e
    0, 0, 0, // 102-104: f, g, h
    222, // 105: i
    0, 0, 0, // 106-108
    889, // 109: m
    611, // 110: n
    611, // 111: o
    0, 0, // 112-113
    389, // 114: r
    556, // 115: s
    333, // 116: t
    611, // 117: u
    556, // 118: v
    0, 0, 0, 0, // 119-122
  ].join(' ');

  builder.addObject(4, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  builder.addObject(5,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica\n' +
    `   /Encoding /WinAnsiEncoding /FirstChar 32 /LastChar 122\n` +
    `   /Widths [${widths}] >>`);

  save('char-positioned.pdf', builder.build());
}

// ─── 8. PDF with bold and italic fonts ───

function generateBoldItalic(): void {
  const builder = new PdfBuilder();

  builder.addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  builder.addObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  builder.addObject(3,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]\n' +
    '   /Contents 4 0 R /Resources << /Font <<\n' +
    '     /F1 5 0 R /F2 6 0 R /F3 7 0 R /F4 8 0 R\n' +
    '   >> >> >>');

  // Line 1: "This is normal and bold and italic text"
  const stream = [
    'BT',
    '/F1 12 Tf',
    '72 700 Td',
    '(This is normal and ) Tj',
    '/F2 12 Tf',
    '(bold) Tj',
    '/F1 12 Tf',
    '( and ) Tj',
    '/F3 12 Tf',
    '(italic) Tj',
    '/F1 12 Tf',
    '( text) Tj',
    'ET',
    // Line 2: All bold line
    'BT',
    '/F2 12 Tf',
    '72 680 Td',
    '(Entirely bold line) Tj',
    'ET',
    // Line 3: Bold italic
    'BT',
    '/F4 12 Tf',
    '72 660 Td',
    '(Bold and italic combined) Tj',
    'ET',
  ].join('\n');

  builder.addObject(4, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  builder.addObject(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  builder.addObject(6, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  builder.addObject(7, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>');
  builder.addObject(8, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-BoldOblique /Encoding /WinAnsiEncoding >>');

  save('bold-italic.pdf', builder.build());
}

// ─── 9. PDF with link annotations ───

function generateLinks(): void {
  const builder = new PdfBuilder();

  builder.addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  builder.addObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  builder.addObject(3,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]\n' +
    '   /Contents 4 0 R\n' +
    '   /Resources << /Font << /F1 5 0 R >> >>\n' +
    '   /Annots [6 0 R] >>');

  const stream = [
    'BT',
    '/F1 12 Tf',
    '72 700 Td',
    '(Visit ) Tj',
    '(Example Site) Tj',
    '( for more info.) Tj',
    '0 -20 Td',
    '(Plain URL: https://example.org/path) Tj',
    'ET',
  ].join('\n');

  builder.addObject(4, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  builder.addObject(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  // Link annotation covering "Example Site" text area
  builder.addObject(6,
    '<< /Type /Annot /Subtype /Link\n' +
    '   /Rect [108 695 200 710]\n' +
    '   /A << /Type /Action /S /URI /URI (https://example.com) >> >>');

  save('links.pdf', builder.build());
}

// ─── 10. PDF with tabular data ───

function generateTable(): void {
  const builder = new PdfBuilder();

  builder.addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  builder.addObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  builder.addObject(3,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]\n' +
    '   /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>');

  // Table header uses bold, data rows use regular
  // 3 columns: Name, Price, Qty
  const stream = [
    'BT',
    // Title
    '/F1 18 Tf',
    '72 750 Td',
    '(Product List) Tj',
    'ET',
    // Header row (bold)
    'BT',
    '/F2 12 Tf',
    '72 720 Td',
    '(Name) Tj',
    'ET',
    'BT',
    '/F2 12 Tf',
    '250 720 Td',
    '(Price) Tj',
    'ET',
    'BT',
    '/F2 12 Tf',
    '400 720 Td',
    '(Qty) Tj',
    'ET',
    // Row 1
    'BT',
    '/F1 12 Tf',
    '72 705 Td',
    '(Widget A) Tj',
    'ET',
    'BT',
    '/F1 12 Tf',
    '250 705 Td',
    '($10.00) Tj',
    'ET',
    'BT',
    '/F1 12 Tf',
    '400 705 Td',
    '(5) Tj',
    'ET',
    // Row 2
    'BT',
    '/F1 12 Tf',
    '72 690 Td',
    '(Gadget B) Tj',
    'ET',
    'BT',
    '/F1 12 Tf',
    '250 690 Td',
    '($25.50) Tj',
    'ET',
    'BT',
    '/F1 12 Tf',
    '400 690 Td',
    '(12) Tj',
    'ET',
    // Row 3
    'BT',
    '/F1 12 Tf',
    '72 675 Td',
    '(Doohickey C) Tj',
    'ET',
    'BT',
    '/F1 12 Tf',
    '250 675 Td',
    '($7.99) Tj',
    'ET',
    'BT',
    '/F1 12 Tf',
    '400 675 Td',
    '(30) Tj',
    'ET',
    // Regular text after table
    'BT',
    '/F1 12 Tf',
    '72 645 Td',
    '(Total items: 47) Tj',
    'ET',
  ].join('\n');

  builder.addObject(4, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  builder.addObject(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  builder.addObject(6, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  save('table.pdf', builder.build());
}

// ─── 11. PDF with flipped Y-axis (CTM with [1, 0, 0, -1, 0, 792]) ───
// Simulates PDFs generated by web tools (Stripe, etc.) where Y=0 is at
// the top of the page and Y increases downward.

function generateFlippedY(): void {
  const builder = new PdfBuilder();

  builder.addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  builder.addObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  builder.addObject(3,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]\n' +
    '   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>');

  // The CTM flips Y: [1, 0, 0, -1, 0, 792]
  // In this system, y=50 is near the TOP of the page, y=750 is near the BOTTOM.
  const stream = [
    // Set up flipped coordinate system
    '1 0 0 -1 0 792 cm',
    // Title at the top (low Y in flipped space)
    'BT',
    '/F1 18 Tf',
    '72 50 Td',
    '(Invoice Title) Tj',
    'ET',
    // Body text in the middle
    'BT',
    '/F1 12 Tf',
    '72 100 Td',
    '(Line item one) Tj',
    'ET',
    'BT',
    '/F1 12 Tf',
    '72 120 Td',
    '(Line item two) Tj',
    'ET',
    'BT',
    '/F1 12 Tf',
    '72 140 Td',
    '(Line item three) Tj',
    'ET',
    // Footer at the bottom (high Y in flipped space)
    'BT',
    '/F1 10 Tf',
    '72 750 Td',
    '(Page 1 of 1) Tj',
    'ET',
  ].join('\n');

  builder.addObject(4, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  builder.addObject(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  save('flipped-y.pdf', builder.build());
}

// ─── 12. PDF with cross-reference stream (instead of traditional xref table) ───
// Tests the xref stream parser, specifically the /W array parsing.

function generateXRefStream(): void {
  const enc = new TextEncoder();

  // Build objects as raw strings and track offsets
  const header = '%PDF-1.7\n';
  const parts: string[] = [header];
  let offset = header.length;
  const offsets: number[] = []; // index = obj num

  // Obj 0 is the free entry (handled in xref stream)
  offsets[0] = 0;

  // Obj 1: Catalog
  offsets[1] = offset;
  const obj1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n\n';
  parts.push(obj1);
  offset += obj1.length;

  // Obj 2: Pages
  offsets[2] = offset;
  const obj2 = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n\n';
  parts.push(obj2);
  offset += obj2.length;

  // Obj 3: Page
  offsets[3] = offset;
  const obj3 = '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]\n' +
    '   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n\n';
  parts.push(obj3);
  offset += obj3.length;

  // Obj 4: Content stream
  const stream = 'BT\n/F1 12 Tf\n100 700 Td\n(XRef Stream Test) Tj\nET';
  offsets[4] = offset;
  const obj4 = `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n\n`;
  parts.push(obj4);
  offset += obj4.length;

  // Obj 5: Font
  offsets[5] = offset;
  const obj5 = '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n\n';
  parts.push(obj5);
  offset += obj5.length;

  // Obj 6: XRef stream (replaces traditional xref table + trailer)
  const xrefStreamOffset = offset;

  // Build xref stream data: /W [1 2 1] means 1 byte type, 2 bytes offset, 1 byte gen
  // Entry format: [type(1)] [field2(2)] [field3(1)]
  // type 0 = free, type 1 = in-use (offset), type 2 = compressed
  const entryCount = 7; // objects 0-6
  const xrefData = new Uint8Array(entryCount * 4); // 4 bytes per entry (1+2+1)
  let pos = 0;

  // Obj 0: free entry (type=0, next free=0, gen=255)
  xrefData[pos++] = 0; // type
  xrefData[pos++] = 0; xrefData[pos++] = 0; // next free obj (2 bytes)
  xrefData[pos++] = 255; // gen

  // Objs 1-5: in-use entries
  for (let i = 1; i <= 5; i++) {
    xrefData[pos++] = 1; // type = in-use
    xrefData[pos++] = (offsets[i] >> 8) & 0xFF; // offset high byte
    xrefData[pos++] = offsets[i] & 0xFF; // offset low byte
    xrefData[pos++] = 0; // gen
  }

  // Obj 6: the xref stream itself (in-use)
  xrefData[pos++] = 1;
  xrefData[pos++] = (xrefStreamOffset >> 8) & 0xFF;
  xrefData[pos++] = xrefStreamOffset & 0xFF;
  xrefData[pos++] = 0;

  // Convert xref data to hex string for a hex-encoded stream
  const hexStr = Array.from(xrefData).map(b => b.toString(16).padStart(2, '0')).join('');

  const obj6 = `6 0 obj\n<< /Type /XRef /Size ${entryCount} /W [1 2 1]\n` +
    `   /Root 1 0 R /Length ${xrefData.length}\n` +
    `   /Filter /ASCIIHexDecode >>\nstream\n${hexStr}>\nendstream\nendobj\n\n`;
  parts.push(obj6);

  parts.push(`startxref\n${xrefStreamOffset}\n%%EOF\n`);

  save('xref-stream.pdf', enc.encode(parts.join('')));
}

// ─── 13. PDF with DocuSign-style form anchor tags ───
// Simulates a signed contract where DocuSign embeds anchor tags like
// \signature1\, \titlehere1\, \namehere2\ as literal text in the content stream.

function generateDocuSignPlaceholders(): void {
  const builder = new PdfBuilder();

  builder.addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  builder.addObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  builder.addObject(3,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]\n' +
    '   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>');

  // DocuSign places anchor tags as separate text objects at the same position
  // as the actual values. Tags are self-closing: \tag\
  const stream = [
    'BT',
    '/F1 12 Tf',
    '72 700 Td',
    '(CUSTOMER) Tj',
    '300 0 Td',
    '(VENDOR) Tj',
    'ET',
    // Signature anchor tags (standalone, no value overlay)
    'BT',
    '/F1 12 Tf',
    '72 670 Td',
    '(\\\\signature1\\\\) Tj',
    'ET',
    'BT',
    '/F1 12 Tf',
    '300 670 Td',
    '(\\\\signature2\\\\) Tj',
    'ET',
    // Name anchor tags at same position as real names
    'BT',
    '/F1 12 Tf',
    '72 650 Td',
    '(\\\\namehere1\\\\) Tj',
    'ET',
    'BT',
    '/F1 12 Tf',
    '72 650 Td',
    '(Peter Horst) Tj',
    'ET',
    'BT',
    '/F1 12 Tf',
    '300 650 Td',
    '(\\\\namehere2\\\\) Tj',
    'ET',
    'BT',
    '/F1 12 Tf',
    '300 650 Td',
    '(Jeff Miller) Tj',
    'ET',
    // Title anchor tags at same position as real titles
    'BT',
    '/F1 12 Tf',
    '72 630 Td',
    '(\\\\titlehere1\\\\) Tj',
    'ET',
    'BT',
    '/F1 12 Tf',
    '72 630 Td',
    '(Chief Technology Officer) Tj',
    'ET',
    'BT',
    '/F1 12 Tf',
    '300 630 Td',
    '(\\\\titlehere2\\\\) Tj',
    'ET',
    'BT',
    '/F1 12 Tf',
    '300 630 Td',
    '(Senior Deal Desk Manager) Tj',
    'ET',
    // Date anchor tags at same position as real dates
    'BT',
    '/F1 12 Tf',
    '72 610 Td',
    '(\\\\datehere1\\\\) Tj',
    'ET',
    'BT',
    '/F1 12 Tf',
    '72 610 Td',
    '(November 24, 2023) Tj',
    'ET',
    'BT',
    '/F1 12 Tf',
    '300 610 Td',
    '(\\\\datehere2\\\\) Tj',
    'ET',
    'BT',
    '/F1 12 Tf',
    '300 610 Td',
    '(November 22, 2023) Tj',
    'ET',
    // PO placeholder on its own (no value)
    'BT',
    '/F1 12 Tf',
    '72 580 Td',
    '(\\\\POhere1\\\\) Tj',
    'ET',
    // IIO-style underscore placeholders (self-closing with trailing backslash)
    'BT',
    '/F1 12 Tf',
    '72 560 Td',
    '(\\\\IIO_Finance_Contact_Name_1\\\\) Tj',
    'ET',
    'BT',
    '/F1 12 Tf',
    '72 560 Td',
    '(Jane Doe) Tj',
    'ET',
    // IIO-style underscore placeholder (open tag, no trailing backslash)
    'BT',
    '/F1 12 Tf',
    '300 560 Td',
    '(\\\\IIO_Finance_Contact_Email_2) Tj',
    'ET',
    'BT',
    '/F1 12 Tf',
    '300 560 Td',
    '(jane@example.com) Tj',
    'ET',
  ].join('\n');

  builder.addObject(4, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  builder.addObject(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  save('docusign-placeholders.pdf', builder.build());
}

// ─── 14. PDF with corrupted xref offset (triggers full document scan fallback) ───
// The startxref value points to garbage, forcing the parser to recover by
// scanning for "N N obj" patterns throughout the file.

function generateBadXRef(): void {
  const enc = new TextEncoder();
  const header = '%PDF-1.4\n';
  const parts: string[] = [header];
  let offset = header.length;
  const offsets = new Map<number, number>();

  const objects = [
    { num: 1, content: '<< /Type /Catalog /Pages 2 0 R >>' },
    { num: 2, content: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { num: 3, content: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]\n   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>' },
    { num: 5, content: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>' },
  ];

  const stream = 'BT\n/F1 12 Tf\n100 700 Td\n(Bad XRef Recovery Test) Tj\nET';

  for (const obj of objects) {
    offsets.set(obj.num, offset);
    const s = `${obj.num} 0 obj\n${obj.content}\nendobj\n\n`;
    parts.push(s);
    offset += s.length;
  }

  offsets.set(4, offset);
  const streamObj = `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n\n`;
  parts.push(streamObj);
  offset += streamObj.length;

  // Write a valid xref + trailer (so the trailer keyword can be found by scan)
  const xrefOffset = offset;
  const xrefLines: string[] = [
    'xref\n',
    '0 6\n',
    '0000000000 65535 f \r\n',
  ];
  for (let i = 1; i <= 5; i++) {
    const o = offsets.get(i) ?? 0;
    xrefLines.push(`${String(o).padStart(10, '0')} 00000 n \r\n`);
  }
  parts.push(xrefLines.join(''));
  parts.push('trailer\n<< /Size 6 /Root 1 0 R >>\n');

  // Deliberately write a WRONG startxref offset (points to garbage)
  parts.push(`startxref\n9999999\n%%EOF\n`);

  save('bad-xref.pdf', enc.encode(parts.join('')));
}

// ─── 15. PDF with /Root in /Prev trailer only ───
// Simulates a linearized or incrementally-updated PDF where the most recent
// trailer lacks /Root but the earlier trailer (via /Prev) has it.

function generateRootInPrevTrailer(): void {
  const enc = new TextEncoder();
  const header = '%PDF-1.4\n';
  const parts: string[] = [header];
  let offset = header.length;
  const offsets = new Map<number, number>();

  const objects = [
    { num: 1, content: '<< /Type /Catalog /Pages 2 0 R >>' },
    { num: 2, content: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { num: 3, content: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]\n   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>' },
    { num: 5, content: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>' },
  ];

  const stream = 'BT\n/F1 12 Tf\n100 700 Td\n(Root In Prev Test) Tj\nET';

  for (const obj of objects) {
    offsets.set(obj.num, offset);
    const s = `${obj.num} 0 obj\n${obj.content}\nendobj\n\n`;
    parts.push(s);
    offset += s.length;
  }

  offsets.set(4, offset);
  const streamObj = `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n\n`;
  parts.push(streamObj);
  offset += streamObj.length;

  // First xref section (old) -- has /Root
  const xref1Offset = offset;
  const xref1Lines: string[] = [
    'xref\n',
    '0 6\n',
    '0000000000 65535 f \r\n',
  ];
  for (let i = 1; i <= 5; i++) {
    const o = offsets.get(i) ?? 0;
    xref1Lines.push(`${String(o).padStart(10, '0')} 00000 n \r\n`);
  }
  parts.push(xref1Lines.join(''));
  parts.push('trailer\n<< /Size 6 /Root 1 0 R >>\n');
  offset = enc.encode(parts.join('')).length;

  // Second xref section (new) -- NO /Root, but has /Prev pointing to first
  const xref2Offset = offset;
  parts.push(`xref\n0 1\n0000000000 65535 f \r\n`);
  parts.push(`trailer\n<< /Size 6 /Prev ${xref1Offset} >>\n`);
  parts.push(`startxref\n${xref2Offset}\n%%EOF\n`);

  save('root-in-prev.pdf', enc.encode(parts.join('')));
}

// ─── Generate all fixtures ───

console.log('Generating test PDF fixtures...');
generateSimple();
generateMultiPage();
generateWithMetadata();
generateMultiText();
generateTJArray();
generateEmptyPage();
generateCharPositioned();
generateBoldItalic();
generateLinks();
generateTable();
generateFlippedY();
generateXRefStream();
generateDocuSignPlaceholders();
generateBadXRef();
generateRootInPrevTrailer();
console.log('Done!');
