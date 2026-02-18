/**
 * Markdown output example.
 * Extracts text as structured markdown, useful for LLM context windows.
 *
 * Markdown is opt-in via the 'extractly/markdown' subpath. Consumers who
 * only need plain text can import from 'extractly' and the markdown code
 * is tree-shaken away.
 *
 * Usage:
 *   npx tsx examples/markdown-output.ts path/to/document.pdf
 */

import { Extractly } from '../src/index.js';
import { docToMarkdown } from '../src/markdown-entry.js';

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: pnpm tsx examples/markdown-output.ts <path-to-pdf>');
  process.exit(1);
}

const doc = await Extractly.load(filePath);

console.log(docToMarkdown(doc));
