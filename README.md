# docutext

[![npm version](https://img.shields.io/npm/v/docutext)](https://www.npmjs.com/package/docutext)
[![bundle size](https://img.shields.io/badge/bundle-~24KB_gzip-blue)](https://www.npmjs.com/package/docutext)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

Zero-dependency PDF text extraction built for RAG and AI pipelines. Parses PDFs from scratch -- no PDF.js, no WASM, no native addons. Works in Node.js and the browser.

## Performance

| Library | Small PDF (31 KB) | Large PDF (1.3 MB) | Bundle (gzip) | Dependencies |
|---------|------------------:|-------------------:|--------------:|:-------------|
| **docutext** | **3 ms** | **40 ms** | **~24 KB** | **0** |
| pdfjs-dist | 5 ms | 244 ms | ~1.3 MB | 0 (but large) |
| pdf-parse | 5 ms | 279 ms | ~780 KB | 1 (pdfjs) |
| unpdf | 6 ms | 232 ms | ~320 KB | 2 (pdfjs) |

*Median of 3 runs, Node.js, Apple Silicon.*

docutext is purpose-built for text extraction in RAG/AI workflows -- not a general PDF toolkit. It does one thing and does it fast.

## Install

```bash
# Node.js (zero dependencies)
pnpm add docutext

# Browser / bundler (add fflate for decompression, ~3 KB gzip)
pnpm add docutext fflate
```

Requires Node.js 18+. Browser builds target ES2020+.

## Quick Start

```typescript
import { DocuText } from 'docutext';

const doc = await DocuText.load('document.pdf');
console.log(doc.text);
```

### Structured Markdown

```typescript
import { DocuText } from 'docutext';
import { docToMarkdown, pageToMarkdown } from 'docutext/markdown';

const doc = await DocuText.load('document.pdf');
console.log(docToMarkdown(doc));       // headings, bold, links
console.log(pageToMarkdown(doc.pages[0]));
```

### Browser

```typescript
import { DocuText } from 'docutext';

const response = await fetch('/document.pdf');
const bytes = new Uint8Array(await response.arrayBuffer());
const doc = DocuText.fromBuffer(bytes);
console.log(doc.text);
```

### Page-by-page

```typescript
for (const page of doc) {
  console.log(`Page ${page.number}: ${page.text}`);
}
```

### Layout-Fidelity Opt-In

```typescript
import { DocuText } from 'docutext';

const doc = await DocuText.load('document.pdf', { textMode: 'layout' });
console.log(doc.text);
```

`textMode: 'layout'` keeps more literal spacing and text-object behavior. The default `textMode: 'clean'` favors semantic text reconstruction and fixes fragmented form PDFs.

## Key Features

- **Zero dependencies** in Node.js. Single optional peer dep (fflate) for browser.
- **~24 KB gzipped browser bundle** -- 50x smaller than pdfjs-dist.
- **6x faster** than alternatives on real-world documents.
- **Clean semantic text by default** -- fragmented form PDFs are reconstructed without spurious intra-word splits.
- **Plain text + structured markdown** output (headings inferred from font size, bold/italic, links).
- **Opt-in layout fidelity mode** via `textMode: 'layout'` when you want more literal spacing/object ordering.
- **Column-aware text flow** -- side-by-side columns (e.g. signature blocks) are read column-first to keep related data together.
- **Lazy extraction** -- accessing `page.text` only processes that page.
- **Full PDF parsing** -- xref tables, stream filters, font encodings, ToUnicode CMaps, form XObjects.
- **Encrypted PDF support** -- handles permission-encrypted PDFs (empty password, RC4/AES-128).
- **Runs everywhere** -- Node.js and browser via conditional exports.
- **ESM only** -- modern module system, tree-shakeable.
- **TypeScript first** -- full type definitions included.

## Documentation

For the full API reference, architecture details, and a live playground, see the **[documentation site](https://barryking.github.io/docutext/)**.

## Security

Please see [SECURITY.md](./SECURITY.md) for vulnerability reporting guidance.

## License

MIT
