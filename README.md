# extractly

[![npm version](https://img.shields.io/npm/v/extractly)](https://www.npmjs.com/package/extractly)
[![bundle size](https://img.shields.io/bundlephobia/minzip/extractly)](https://bundlephobia.com/package/extractly)
[![license](https://img.shields.io/npm/l/extractly)](./LICENSE)

Zero-dependency PDF text extraction built for RAG and AI pipelines. Parses PDFs from scratch -- no PDF.js, no WASM, no native addons. Works in Node.js and the browser.

## Performance

| Library | Small PDF (31 KB) | Large PDF (1.3 MB) | Bundle (gzip) | Dependencies |
|---------|------------------:|-------------------:|--------------:|:-------------|
| **extractly** | **3 ms** | **40 ms** | **~24 KB** | **0** |
| pdfjs-dist | 5 ms | 244 ms | ~1.3 MB | 0 (but large) |
| pdf-parse | 5 ms | 279 ms | ~780 KB | 1 (pdfjs) |
| unpdf | 6 ms | 232 ms | ~320 KB | 2 (pdfjs) |

*Median of 3 runs, Node.js, Apple Silicon. Full methodology in [`benchmarks/`](./benchmarks).*

extractly is purpose-built for text extraction in RAG/AI workflows -- not a general PDF toolkit. It does one thing and does it fast.

## Install

```bash
# Node.js (zero dependencies)
pnpm add extractly

# Browser / bundler (add fflate for decompression, ~3 KB gzip)
pnpm add extractly fflate
```

Requires Node.js 18+. Browser builds target ES2020+.

## Quick Start

```typescript
import { Extractly } from 'extractly';

const doc = await Extractly.load('document.pdf');
console.log(doc.text);
```

### Structured Markdown

```typescript
import { Extractly } from 'extractly';
import { docToMarkdown, pageToMarkdown } from 'extractly/markdown';

const doc = await Extractly.load('document.pdf');
console.log(docToMarkdown(doc));       // headings, bold, tables, links
console.log(pageToMarkdown(doc.pages[0]));
```

### Browser

```typescript
import { Extractly } from 'extractly';

const response = await fetch('/document.pdf');
const bytes = new Uint8Array(await response.arrayBuffer());
const doc = Extractly.fromBuffer(bytes);
console.log(doc.text);
```

### Page-by-page

```typescript
for (const page of doc) {
  console.log(`Page ${page.number}: ${page.text}`);
}
```

## Key Features

- **Zero dependencies** in Node.js. Single optional peer dep (fflate) for browser.
- **~24 KB gzipped** -- 50x smaller than pdfjs-dist.
- **6x faster** than alternatives on real-world documents.
- **Plain text + structured markdown** output (headings inferred from font size, bold/italic, tables, links).
- **Lazy extraction** -- accessing `page.text` only processes that page.
- **Full PDF parsing** -- xref tables, stream filters, font encodings, ToUnicode CMaps, form XObjects.
- **Encrypted PDF support** -- handles permission-encrypted PDFs (empty password, RC4/AES-128).
- **Runs everywhere** -- Node.js and browser via conditional exports.
- **ESM only** -- modern module system, tree-shakeable.
- **TypeScript first** -- full type definitions included.

## Documentation

For the full API reference, architecture details, and a live playground, see the **[documentation site](https://barryking.github.io/extractly/)**.

## License

MIT
