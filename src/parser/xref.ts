/**
 * PDF Cross-Reference Table Parser
 *
 * Handles both:
 * - Traditional xref tables (text-based, PDF 1.0+)
 * - Cross-reference streams (compressed, PDF 1.5+)
 */

import { PdfLexer, TokenType } from './lexer.js';
import { PdfParseError } from '../errors.js';
import type { XRefTable, XRefEntry, TrailerInfo, PdfDict, PdfObject } from './types.js';
import {
  pdfRef, pdfDict, pdfName, pdfNumber, pdfArray, pdfString,
  pdfBool, PDF_NULL, pdfStream,
  isRef, isNumber, isDict, isStream, isArray,
  dictGet, dictGetNumber, dictGetName, dictGetRef,
} from './types.js';

const STARTXREF_MARKER = new TextEncoder().encode('startxref');
const OBJ_MARKER = new TextEncoder().encode(' obj');
const TRAILER_MARKER = new TextEncoder().encode('trailer');

/**
 * Locate the startxref offset by scanning backward from the end of the file.
 */
export function findStartXRef(lexer: PdfLexer): number {
  const pos = lexer.findLast(STARTXREF_MARKER);
  if (pos === -1) {
    throw new PdfParseError('Could not find startxref marker');
  }

  lexer.position = pos + STARTXREF_MARKER.length;
  lexer.skipWhitespaceAndComments();

  const token = lexer.nextToken();
  if (token.type !== TokenType.Number || typeof token.value !== 'number') {
    throw new PdfParseError('Invalid startxref offset');
  }

  return token.value;
}

/**
 * Parse a traditional xref table section.
 * Returns the xref table and trailer info.
 */
export function parseXRefTable(lexer: PdfLexer, offset: number): { table: XRefTable; trailer: TrailerInfo } {
  const table: XRefTable = new Map();

  lexer.position = offset;
  lexer.skipWhitespaceAndComments();

  // Read "xref" keyword
  const line = lexer.readLine().trim();
  if (line !== 'xref') {
    throw new PdfParseError(`Expected 'xref' at offset ${offset}`, offset);
  }

  // Read subsections
  while (true) {
    lexer.skipWhitespaceAndComments();
    const savedPos = lexer.position;

    const firstLine = lexer.readLine().trim();
    if (firstLine === 'trailer' || firstLine.startsWith('trailer')) {
      // We've reached the trailer
      if (firstLine === 'trailer') {
        // trailer on its own line
      } else {
        // trailer might be on same line, back up
        lexer.position = savedPos;
        lexer.readLine(); // skip "trailer"
      }
      break;
    }

    const parts = firstLine.split(/\s+/);
    if (parts.length < 2) {
      lexer.position = savedPos;
      break;
    }

    const startObj = parseInt(parts[0], 10);
    const count = parseInt(parts[1], 10);

    if (isNaN(startObj) || isNaN(count)) {
      lexer.position = savedPos;
      break;
    }

    for (let i = 0; i < count; i++) {
      const entryLine = lexer.readLine();
      const entryParts = entryLine.trim().split(/\s+/);
      if (entryParts.length < 3) continue;

      const entryOffset = parseInt(entryParts[0], 10);
      const gen = parseInt(entryParts[1], 10);
      const type = entryParts[2];
      const objNum = startObj + i;

      if (type === 'n' && !table.has(objNum)) {
        table.set(objNum, { offset: entryOffset, gen, free: false });
      } else if (type === 'f' && !table.has(objNum)) {
        table.set(objNum, { offset: entryOffset, gen, free: true });
      }
    }
  }

  // Parse trailer dictionary
  lexer.skipWhitespaceAndComments();
  const trailerDict = parseInlineDict(lexer);
  const trailer = extractTrailerInfo(trailerDict);

  return { table, trailer };
}

/**
 * Parse a cross-reference stream (PDF 1.5+).
 * The stream at the given offset is an indirect object containing both the
 * xref entries and the trailer dictionary.
 */
export function parseXRefStream(
  lexer: PdfLexer,
  offset: number,
  decodeStreamFn: (data: Uint8Array, dict: PdfDict) => Uint8Array,
  resolveIndirectLength?: (dict: PdfDict) => number | undefined,
): { table: XRefTable; trailer: TrailerInfo } {
  const table: XRefTable = new Map();

  lexer.position = offset;

  // Read "objNum gen obj"
  const objNumToken = lexer.nextToken();
  const genToken = lexer.nextToken();
  const objKeyword = lexer.nextToken();

  if (objKeyword.type !== TokenType.Keyword || objKeyword.value !== 'obj') {
    throw new PdfParseError(`Expected 'obj' at xref stream offset ${offset}`, offset);
  }

  // Parse the stream object
  const dict = parseInlineDict(lexer);

  // Read stream data
  lexer.skipWhitespaceAndComments();
  const streamKeywordPos = lexer.position;

  // Find "stream" keyword
  const streamLine = lexer.readLine().trim();
  if (streamLine !== 'stream') {
    throw new PdfParseError('Expected stream keyword in xref stream');
  }

  const length = dictGetNumber(dict, 'Length')
    ?? resolveIndirectLength?.(dict)
    ?? 0;
  const streamData = lexer.slice(lexer.position, lexer.position + length);
  const decoded = decodeStreamFn(streamData, dict);

  // Parse W array for field widths
  const wObj = dictGet(dict, 'W');
  if (!wObj || !isArray(wObj)) {
    throw new PdfParseError('Missing /W array in xref stream');
  }
  const w = wObj.items.map(item => isNumber(item) ? item.value : 0);
  if (w.length < 3) {
    throw new PdfParseError('/W array must have 3 entries');
  }

  // Parse Size
  const size = dictGetNumber(dict, 'Size') ?? 0;

  // Parse Index array (default: [0 Size])
  let indexPairs: number[] = [0, size];
  const indexObj = dictGet(dict, 'Index');
  if (indexObj && isArray(indexObj)) {
    indexPairs = indexObj.items.map(item => isNumber(item) ? item.value : 0);
  }

  const entrySize = w[0] + w[1] + w[2];
  let dataPos = 0;

  for (let idx = 0; idx < indexPairs.length; idx += 2) {
    const startObj = indexPairs[idx];
    const count = indexPairs[idx + 1];

    for (let i = 0; i < count; i++) {
      if (dataPos + entrySize > decoded.length) break;

      const field1 = readFieldValue(decoded, dataPos, w[0]);
      const field2 = readFieldValue(decoded, dataPos + w[0], w[1]);
      const field3 = readFieldValue(decoded, dataPos + w[0] + w[1], w[2]);
      dataPos += entrySize;

      const objNum = startObj + i;

      // Default type is 1 if w[0] is 0
      const type = w[0] === 0 ? 1 : field1;

      if (table.has(objNum)) continue;

      switch (type) {
        case 0: // free object
          table.set(objNum, { offset: 0, gen: field3, free: true });
          break;
        case 1: // uncompressed object
          table.set(objNum, { offset: field2, gen: field3, free: false });
          break;
        case 2: // compressed object in an object stream
          table.set(objNum, {
            offset: 0,
            gen: 0,
            free: false,
            streamObjNum: field2,
            streamIndex: field3,
          });
          break;
      }
    }
  }

  const trailer = extractTrailerInfo(dict);

  return { table, trailer };
}

/**
 * Read an integer value from a byte sequence of a given width.
 */
function readFieldValue(data: Uint8Array, offset: number, width: number): number {
  let value = 0;
  for (let i = 0; i < width; i++) {
    value = (value << 8) | (data[offset + i] ?? 0);
  }
  return value;
}

/**
 * Parse a dictionary inline (used for trailer and xref stream dicts).
 */
function parseInlineDict(lexer: PdfLexer): PdfDict {
  const token = lexer.nextToken();
  if (token.type !== TokenType.DictStart) {
    throw new PdfParseError(`Expected << but got ${token.type}`);
  }

  const entries = new Map<string, PdfObject>();

  while (true) {
    const keyToken = lexer.nextToken();
    if (keyToken.type === TokenType.DictEnd) break;
    if (keyToken.type === TokenType.EOF) break;

    if (keyToken.type !== TokenType.Name || typeof keyToken.value !== 'string') {
      continue;
    }

    const value = parseInlineValue(lexer);
    entries.set(keyToken.value, value);
  }

  return pdfDict(entries);
}

function parseInlineValue(lexer: PdfLexer): PdfObject {
  const token = lexer.nextToken();

  switch (token.type) {
    case TokenType.Number: {
      // Look ahead for "gen R" pattern (indirect reference)
      const next = lexer.nextToken();
      if (next.type === TokenType.Number) {
        const next2 = lexer.nextToken();
        if (next2.type === TokenType.Keyword && next2.value === 'R') {
          return pdfRef(token.value as number, next.value as number);
        }
      }
      // Not a ref — back up so only the first number is consumed
      lexer.position = next.offset;
      return pdfNumber(token.value as number);
    }
    case TokenType.String:
      return pdfString(token.value as Uint8Array);
    case TokenType.HexString:
      return pdfString(token.value as Uint8Array);
    case TokenType.Name:
      return pdfName(token.value as string);
    case TokenType.Bool:
      return pdfBool(token.value as boolean);
    case TokenType.Null:
      return PDF_NULL;
    case TokenType.DictStart: {
      // Parse nested dict
      const entries = new Map<string, PdfObject>();
      while (true) {
        const kt = lexer.nextToken();
        if (kt.type === TokenType.DictEnd || kt.type === TokenType.EOF) break;
        if (kt.type !== TokenType.Name) continue;
        const v = parseInlineValue(lexer);
        entries.set(kt.value as string, v);
      }
      return pdfDict(entries);
    }
    case TokenType.ArrayStart: {
      const items: PdfObject[] = [];
      while (true) {
        lexer.skipWhitespaceAndComments();
        if (lexer.peek() === 0x5d) { // ]
          lexer.nextToken();
          break;
        }
        if (lexer.atEnd) break;
        items.push(parseInlineValue(lexer));
      }
      return pdfArray(items);
    }
    default:
      return PDF_NULL;
  }
}

function extractTrailerInfo(dict: PdfDict): TrailerInfo {
  const size = dictGetNumber(dict, 'Size') ?? 0;
  const rootRef = dictGetRef(dict, 'Root');

  return {
    size,
    root: rootRef ?? undefined,
    info: dictGetRef(dict, 'Info') ?? undefined,
    prev: dictGetNumber(dict, 'Prev') ?? undefined,
    dict,
  };
}

/**
 * Full document scan fallback. Scans the entire file for `N N obj` patterns
 * to rebuild the xref table, then searches for a trailer dictionary.
 * Mirrors PDF.js's "Indexing all PDF objects" recovery strategy.
 */
export function scanForObjects(lexer: PdfLexer): { table: XRefTable; trailer: TrailerInfo } {
  const table: XRefTable = new Map();

  // Scan for "N N obj" patterns by searching for " obj" marker
  let searchPos = 0;
  while (searchPos < lexer.length) {
    const objPos = lexer.findNext(OBJ_MARKER, searchPos);
    if (objPos === -1) break;

    // Walk backward from the space before " obj" to find "gen" and "objNum"
    const objInfo = parseObjHeader(lexer, objPos);
    if (objInfo) {
      if (!table.has(objInfo.objNum)) {
        table.set(objInfo.objNum, {
          offset: objInfo.headerStart,
          gen: objInfo.gen,
          free: false,
        });
      }
    }

    searchPos = objPos + OBJ_MARKER.length;
  }

  // Try to find trailer dictionary by searching for "trailer" keyword
  let trailer: TrailerInfo | null = null;

  let trailerPos = lexer.findNext(TRAILER_MARKER, 0);
  while (trailerPos !== -1) {
    try {
      lexer.position = trailerPos + TRAILER_MARKER.length;
      lexer.skipWhitespaceAndComments();
      const dict = parseInlineDict(lexer);
      const info = extractTrailerInfo(dict);
      if (info.root) {
        trailer = info;
        break;
      }
      if (!trailer) {
        trailer = info;
      }
    } catch {
      // Malformed trailer, keep searching
    }
    trailerPos = lexer.findNext(TRAILER_MARKER, trailerPos + TRAILER_MARKER.length);
  }

  // If no trailer found (or no /Root), scan xref stream objects for /Root
  if (!trailer?.root) {
    for (const [objNum, entry] of table) {
      if (entry.free) continue;
      try {
        lexer.position = entry.offset;
        const t1 = lexer.nextToken();
        const t2 = lexer.nextToken();
        const t3 = lexer.nextToken();
        if (t3.type !== TokenType.Keyword || t3.value !== 'obj') continue;

        lexer.skipWhitespaceAndComments();
        if (lexer.peek() !== 0x3c) continue; // not <<

        const dict = parseInlineDict(lexer);
        const typeVal = dictGetName(dict, 'Type');
        if (typeVal === 'XRef' || dictGetRef(dict, 'Root')) {
          const info = extractTrailerInfo(dict);
          if (info.root) {
            trailer = info;
            break;
          }
        }
      } catch {
        // Skip malformed objects
      }
    }
  }

  if (!trailer) {
    throw new PdfParseError('Could not recover PDF structure: no trailer found during full scan');
  }

  return { table, trailer };
}

/**
 * Parse backward from a " obj" marker to extract objNum and gen.
 * Returns null if the bytes before " obj" don't form a valid "N N" pattern.
 */
function parseObjHeader(
  lexer: PdfLexer,
  objSpacePos: number,
): { objNum: number; gen: number; headerStart: number } | null {
  // objSpacePos points to the space in " obj"
  // We need to look backward to find digits, then a space, then more digits
  let pos = objSpacePos - 1;
  const data = lexer.slice(0, objSpacePos);

  // Skip any whitespace before " obj"
  while (pos >= 0 && (data[pos] === 0x20 || data[pos] === 0x0a || data[pos] === 0x0d || data[pos] === 0x09)) {
    pos--;
  }

  // Read gen number digits backward
  let genEnd = pos + 1;
  while (pos >= 0 && data[pos] >= 0x30 && data[pos] <= 0x39) {
    pos--;
  }
  let genStart = pos + 1;
  if (genStart >= genEnd) return null;

  // Expect whitespace
  if (pos < 0 || (data[pos] !== 0x20 && data[pos] !== 0x0a && data[pos] !== 0x0d && data[pos] !== 0x09)) {
    return null;
  }

  // Skip whitespace
  while (pos >= 0 && (data[pos] === 0x20 || data[pos] === 0x0a || data[pos] === 0x0d || data[pos] === 0x09)) {
    pos--;
  }

  // Read objNum digits backward
  let numEnd = pos + 1;
  while (pos >= 0 && data[pos] >= 0x30 && data[pos] <= 0x39) {
    pos--;
  }
  let numStart = pos + 1;
  if (numStart >= numEnd) return null;

  // The byte before objNum should be whitespace or start of file/line
  if (pos >= 0 && data[pos] !== 0x20 && data[pos] !== 0x0a && data[pos] !== 0x0d && data[pos] !== 0x09) {
    return null;
  }

  const objNum = parseInt(textDecoder.decode(data.subarray(numStart, numEnd)), 10);
  const gen = parseInt(textDecoder.decode(data.subarray(genStart, genEnd)), 10);

  if (isNaN(objNum) || isNaN(gen) || objNum < 0) return null;

  return { objNum, gen, headerStart: numStart };
}

const textDecoder = new TextDecoder();
