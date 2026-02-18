/**
 * Public types for the extractly library.
 */

/** Metadata extracted from the PDF document info dictionary */
export interface DocumentMetadata {
  readonly title?: string;
  readonly author?: string;
  readonly subject?: string;
  readonly keywords?: string;
  readonly creator?: string;
  readonly producer?: string;
  readonly creationDate?: string;
  readonly modDate?: string;
  readonly pageCount: number;
}

/** A text item with position info, used internally for text assembly */
export interface TextItem {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly fontSize: number;
  readonly fontName: string;
  readonly width: number;
  /** @internal BT/ET text object index for run merging */
  readonly _textObjectId?: number;
}

/** A formatted text span within a line (used for rich markdown output) */
export interface TextSpan {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
  /** URI if this span is a hyperlink */
  readonly link?: string;
}

/** Options for loading a PDF */
export interface LoadOptions {
  /** Password for encrypted PDFs (not yet supported) */
  readonly password?: string;
  /** Separator between pages when concatenating full text. Default: '\n\n' */
  readonly pageSeparator?: string;
  /** Strip DocuSign-style form anchor tags (e.g. \signature1\, \titlehere2\) from extracted text. Default: true */
  readonly stripFormPlaceholders?: boolean;
  /** Include invisible text (rendering mode 3). Useful for OCR-only PDFs. Default: false */
  readonly includeInvisibleText?: boolean;
}

/** Serializable page representation */
export interface PageData {
  readonly number: number;
  readonly text: string;
  readonly markdown?: string;
}

/** Serializable document representation */
export interface DocumentData {
  readonly metadata: DocumentMetadata;
  readonly pages: PageData[];
}
