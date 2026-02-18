/**
 * Basic text extraction example.
 *
 * Usage:
 *   npx tsx examples/basic-extraction.ts path/to/document.pdf
 */

import { Extractly } from '../src/index.js';

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: pnpm tsx examples/basic-extraction.ts <path-to-pdf>');
  process.exit(1);
}

const doc = await Extractly.load(filePath);

console.log(`Pages: ${doc.pageCount}`);
console.log(`Title: ${doc.metadata.title ?? '(none)'}`);
console.log('---');
console.log(doc.text);
