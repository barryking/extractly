/**
 * Page-by-page text extraction example.
 * Iterates through each page and prints its content individually.
 *
 * Usage:
 *   npx tsx examples/page-by-page.ts path/to/document.pdf
 */

import { Extractly } from '../src/index.js';

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: pnpm tsx examples/page-by-page.ts <path-to-pdf>');
  process.exit(1);
}

const doc = await Extractly.load(filePath);

console.log(`Document: ${doc.metadata.title ?? filePath}`);
console.log(`Total pages: ${doc.pageCount}`);
console.log('='.repeat(60));

for (const page of doc) {
  console.log(`\n--- Page ${page.number} ---\n`);
  console.log(page.text || '(empty page)');
}
