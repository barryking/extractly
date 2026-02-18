/**
 * Custom error types for extractly.
 * Provides structured errors for PDF parsing failures and unsupported features.
 */

export class ExtractlyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractlyError';
  }
}

export class PdfParseError extends ExtractlyError {
  constructor(message: string, public readonly offset?: number) {
    super(message);
    this.name = 'PdfParseError';
  }
}

export class PdfUnsupportedError extends ExtractlyError {
  constructor(message: string) {
    super(message);
    this.name = 'PdfUnsupportedError';
  }
}
