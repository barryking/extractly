/**
 * Extractly - the main entry point for extractly.
 *
 * Provides a high-level API for loading PDFs and extracting text
 * in plain text or markdown format.
 */

import { PdfParser } from './parser/parser.js';
import { PDFPage } from './page.js';
import { decodePdfString } from './encoding/encodings.js';
import { dictGetString, dictGetName } from './parser/types.js';
import type { DocumentMetadata, LoadOptions, DocumentData } from './types.js';

export class Extractly {
  /** All pages in the document */
  readonly pages: readonly PDFPage[];

  /** Document metadata */
  readonly metadata: DocumentMetadata;

  private readonly _pageSeparator: string;

  private _text: string | null = null;

  private constructor(
    pages: PDFPage[],
    metadata: DocumentMetadata,
    pageSeparator: string,
  ) {
    this.pages = pages;
    this.metadata = metadata;
    this._pageSeparator = pageSeparator;
  }

  /**
   * Load a PDF from a file path or Uint8Array buffer.
   *
   * @param source - file path (string) or raw PDF bytes (Uint8Array)
   * @param options - optional loading configuration
   */
  static async load(
    source: string | Uint8Array,
    options?: LoadOptions,
  ): Promise<Extractly> {
    let data: Uint8Array;

    if (typeof source === 'string') {
      const { readFile } = await import('node:fs/promises');
      const buffer = await readFile(source);
      data = new Uint8Array(buffer);
    } else {
      data = source;
    }

    return Extractly.fromBuffer(data, options);
  }

  /**
   * Synchronously create an Extractly instance from a buffer.
   * Useful when you already have the bytes in memory.
   */
  static fromBuffer(data: Uint8Array, options?: LoadOptions): Extractly {
    const parser = new PdfParser(data);
    parser.parse();

    const pageSeparator = options?.pageSeparator ?? '\n\n';
    const stripFormPlaceholders = options?.stripFormPlaceholders ?? true;
    const includeInvisibleText = options?.includeInvisibleText ?? false;

    // Extract metadata
    const metadata = extractMetadata(parser);

    // Build page objects
    const pageDicts = parser.getPages();
    const pages = pageDicts.map(
      (dict, index) => new PDFPage(dict, parser, index + 1, { stripFormPlaceholders, includeInvisibleText }),
    );

    return new Extractly(pages, { ...metadata, pageCount: pages.length }, pageSeparator);
  }

  /** Full document text (all pages concatenated) */
  get text(): string {
    if (this._text === null) {
      this._text = this.pages
        .map(page => page.text)
        .filter(text => text.length > 0)
        .join(this._pageSeparator);
    }
    return this._text;
  }

  /** Number of pages */
  get pageCount(): number {
    return this.pages.length;
  }

  /** Iterate over pages */
  [Symbol.iterator](): Iterator<PDFPage> {
    let index = 0;
    const pages = this.pages;
    return {
      next(): IteratorResult<PDFPage> {
        if (index < pages.length) {
          return { value: pages[index++], done: false };
        }
        return { value: undefined as never, done: true };
      },
    };
  }

  /** Convert to a plain serializable object */
  toJSON(): DocumentData {
    return {
      metadata: this.metadata,
      pages: this.pages.map(page => page.toJSON()),
    };
  }

  /** Release all internal references for garbage collection. */
  dispose(): void {
    for (const page of this.pages) {
      page.dispose();
    }
    this._text = null;
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

function extractMetadata(parser: PdfParser): DocumentMetadata {
  const infoDict = parser.getInfoDict();

  const getString = (key: string): string | undefined => {
    if (!infoDict) return undefined;
    const bytes = dictGetString(infoDict, key);
    if (!bytes) return undefined;
    const decoded = decodePdfString(bytes);
    return decoded || undefined;
  };

  return {
    title: getString('Title'),
    author: getString('Author'),
    subject: getString('Subject'),
    keywords: getString('Keywords'),
    creator: getString('Creator'),
    producer: getString('Producer'),
    creationDate: getString('CreationDate'),
    modDate: getString('ModDate'),
    pageCount: 0, // Filled in by caller
  };
}
