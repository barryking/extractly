/**
 * RAG Pipeline example.
 * Demonstrates a typical RAG workflow: extract -> chunk -> prepare for embedding.
 *
 * Usage:
 *   npx tsx examples/rag-pipeline.ts path/to/document.pdf
 */

import { Extractly } from '../src/index.js';
import type { DocumentMetadata } from '../src/types.js';

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: pnpm tsx examples/rag-pipeline.ts <path-to-pdf>');
  process.exit(1);
}

// ─── Step 1: Extract ───

const doc = await Extractly.load(filePath);

console.log('Step 1: Extraction');
console.log(`  Pages: ${doc.pageCount}`);
console.log(`  Title: ${doc.metadata.title ?? '(untitled)'}`);

// ─── Step 2: Chunk by page ───

interface Chunk {
  id: string;
  text: string;
  metadata: {
    source: string;
    page: number;
    title?: string;
    author?: string;
  };
}

const chunks: Chunk[] = [];

for (const page of doc) {
  const text = page.text.trim();
  if (!text) continue;

  chunks.push({
    id: `${filePath}#page-${page.number}`,
    text,
    metadata: {
      source: filePath,
      page: page.number,
      title: doc.metadata.title,
      author: doc.metadata.author,
    },
  });
}

console.log(`\nStep 2: Chunking`);
console.log(`  Chunks created: ${chunks.length}`);

// ─── Step 3: Optionally split large chunks ───

const MAX_CHUNK_SIZE = 1000; // characters

const finalChunks: Chunk[] = [];

for (const chunk of chunks) {
  if (chunk.text.length <= MAX_CHUNK_SIZE) {
    finalChunks.push(chunk);
  } else {
    // Split by paragraphs (double newline)
    const paragraphs = chunk.text.split(/\n\n+/);
    let current = '';
    let subIndex = 0;

    for (const para of paragraphs) {
      if (current.length + para.length > MAX_CHUNK_SIZE && current.length > 0) {
        finalChunks.push({
          id: `${chunk.id}-${subIndex}`,
          text: current.trim(),
          metadata: chunk.metadata,
        });
        current = '';
        subIndex++;
      }
      current += (current ? '\n\n' : '') + para;
    }

    if (current.trim()) {
      finalChunks.push({
        id: `${chunk.id}-${subIndex}`,
        text: current.trim(),
        metadata: chunk.metadata,
      });
    }
  }
}

console.log(`\nStep 3: Split large chunks`);
console.log(`  Final chunks: ${finalChunks.length}`);

// ─── Step 4: Preview ───

console.log(`\nStep 4: Preview (first 3 chunks)`);
for (const chunk of finalChunks.slice(0, 3)) {
  console.log(`\n  [${chunk.id}]`);
  console.log(`  Length: ${chunk.text.length} chars`);
  console.log(`  Preview: ${chunk.text.substring(0, 100)}...`);
}

console.log('\n--- Ready for embedding ---');
console.log('Each chunk can now be sent to an embedding model (OpenAI, Cohere, etc.)');
