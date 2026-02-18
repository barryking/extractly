/**
 * PDFPage - represents a single page in a PDF document.
 * Provides lazy text extraction in plain text format.
 * Markdown output is available via the `extractly/markdown` subpath.
 */

import type { PdfDict } from './parser/types.js';
import type { PdfParser } from './parser/parser.js';
import type { TextItem, PageData } from './types.js';
import { extractTextItems } from './content/interpreter.js';
import { assembleText } from './content/assembler.js';
import type { AssemblyOptions } from './content/assembler.js';

/** @internal Symbol key for accessing page internals from sibling modules */
export const PAGE_INTERNALS = Symbol('page-internals');

export interface PageInternals {
  pageDict: PdfDict | null;
  parser: PdfParser | null;
  assemblyOptions: AssemblyOptions;
}

export interface PageOptions {
  stripFormPlaceholders?: boolean;
  includeInvisibleText?: boolean;
}

export class PDFPage {
  /** 1-based page number */
  readonly number: number;

  private _pageDict: PdfDict | null;
  private _parser: PdfParser | null;
  private readonly _assemblyOptions: AssemblyOptions;

  private _textItems: TextItem[] | null = null;
  private _text: string | null = null;
  private _error: Error | null = null;

  private readonly _includeInvisibleText: boolean;

  constructor(pageDict: PdfDict, parser: PdfParser, pageNumber: number, options?: PageOptions) {
    this._pageDict = pageDict;
    this._parser = parser;
    this.number = pageNumber;
    this._assemblyOptions = {
      stripFormPlaceholders: options?.stripFormPlaceholders ?? true,
    };
    this._includeInvisibleText = options?.includeInvisibleText ?? false;
  }

  /** @internal Access page internals from sibling modules (markdown-entry). */
  get [PAGE_INTERNALS](): PageInternals {
    return {
      pageDict: this._pageDict,
      parser: this._parser,
      assemblyOptions: this._assemblyOptions,
    };
  }

  /** Get the raw text items with position information */
  get textItems(): TextItem[] {
    if (this._textItems === null) {
      if (!this._pageDict || !this._parser) return [];
      try {
        this._textItems = extractTextItems(this._pageDict, this._parser, {
          includeInvisibleText: this._includeInvisibleText,
        });
      } catch (err) {
        this._error = err instanceof Error ? err : new Error(String(err));
        this._textItems = [];
      }
    }
    return this._textItems;
  }

  /** Error encountered during text extraction, or null if successful */
  get error(): Error | null {
    if (this._textItems === null) {
      void this.textItems;
    }
    return this._error;
  }

  /** Get the page text as a plain string */
  get text(): string {
    if (this._text === null) {
      this._text = assembleText(this.textItems, this._assemblyOptions);
    }
    return this._text;
  }

  /** Convert to a plain serializable object */
  toJSON(): PageData {
    return {
      number: this.number,
      text: this.text,
    };
  }

  /** Release internal references for garbage collection. */
  dispose(): void {
    this._textItems = null;
    this._text = null;
    this._pageDict = null;
    this._parser = null;
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}
