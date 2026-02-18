/**
 * extractly/browser - Browser-compatible PDF text extraction for RAG and AI pipelines
 *
 * Uses fflate for decompression instead of node:zlib.
 * Only Extractly.fromBuffer() is available (no file-path loading).
 *
 * @example
 * ```typescript
 * import { Extractly } from 'extractly';
 *
 * const response = await fetch('/document.pdf');
 * const bytes = new Uint8Array(await response.arrayBuffer());
 * const doc = Extractly.fromBuffer(bytes);
 * console.log(doc.text);
 * ```
 */

import { decompressSync } from 'fflate';
import { setInflate } from './stream/inflate.js';

setInflate((data) => decompressSync(data));

export { Extractly } from './document.js';
export { PDFPage } from './page.js';
export { ExtractlyError, PdfParseError, PdfUnsupportedError } from './errors.js';
export type {
  DocumentMetadata,
  TextItem,
  LoadOptions,
  PageData,
  DocumentData,
} from './types.js';
