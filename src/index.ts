/**
 * extractly - Zero-dependency TypeScript PDF text extraction for RAG and AI pipelines
 *
 * @example
 * ```typescript
 * import { Extractly } from 'extractly';
 *
 * const doc = await Extractly.load('document.pdf');
 *
 * // Full text
 * console.log(doc.text);
 *
 * // Page by page
 * for (const page of doc) {
 *   console.log(`Page ${page.number}: ${page.text}`);
 * }
 * ```
 */

import { inflateSync } from 'node:zlib';
import { createHash, createDecipheriv } from 'node:crypto';
import { setInflate } from './stream/inflate.js';
import { setCryptoImpl } from './crypto/crypto-impl.js';

function nodeInflate(data: Uint8Array): Uint8Array {
  try {
    return new Uint8Array(inflateSync(data));
  } catch {
    return new Uint8Array(inflateSync(data, { finishFlush: 0 }));
  }
}

setInflate(nodeInflate);

setCryptoImpl(
  (data) => new Uint8Array(createHash('md5').update(data).digest()),
  (key, iv, data) => {
    const decipher = createDecipheriv('aes-128-cbc', key, iv);
    decipher.setAutoPadding(true);
    const a = decipher.update(data);
    const b = decipher.final();
    const result = new Uint8Array(a.length + b.length);
    result.set(new Uint8Array(a.buffer, a.byteOffset, a.length));
    result.set(new Uint8Array(b.buffer, b.byteOffset, b.length), a.length);
    return result;
  },
);

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
