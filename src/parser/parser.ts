/**
 * PDF Object Parser
 *
 * High-level parser that:
 * - Reads the xref table and trailer
 * - Resolves indirect object references
 * - Parses objects on demand (lazy)
 * - Handles object streams (PDF 1.5+)
 */

import { PdfLexer, TokenType } from './lexer.js';
import { PdfParseError, PdfUnsupportedError } from '../errors.js';
import type {
  PdfObject, PdfDict, PdfStream, PdfArray, PdfRef,
  XRefTable, TrailerInfo,
} from './types.js';
import {
  pdfRef, pdfDict, pdfName, pdfNumber, pdfArray, pdfString,
  pdfBool, pdfStream, PDF_NULL,
  isRef, isDict, isStream, isNumber, isName, isArray, isString,
  dictGet, dictGetNumber, dictGetName, dictGetRef,
} from './types.js';
import { findStartXRef, parseXRefTable, parseXRefStream, scanForObjects } from './xref.js';
import { decodeStream } from '../stream/decoder.js';
import { tryEmptyPassword, decryptData } from '../crypto/security-handler.js';
import type { EncryptionInfo } from '../crypto/security-handler.js';

/** Pre-computed byte marker for stream end detection */
const ENDSTREAM_MARKER = new Uint8Array([
  0x65, 0x6e, 0x64, 0x73, 0x74, 0x72, 0x65, 0x61, 0x6d, // 'endstream'
]);

/** Parse a single PDF value from the given lexer position. */
function parseValue(lexer: PdfLexer): PdfObject {
  const token = lexer.nextToken();

  switch (token.type) {
    case TokenType.Number: {
      const next = lexer.nextToken();
      if (next.type === TokenType.Number) {
        const next2 = lexer.nextToken();
        if (next2.type === TokenType.Keyword && next2.value === 'R') {
          return pdfRef(token.value as number, next.value as number);
        }
        lexer.position = next.offset;
      } else {
        lexer.position = next.offset;
      }
      return pdfNumber(token.value as number);
    }

    case TokenType.String:
    case TokenType.HexString:
      return pdfString(token.value as Uint8Array);

    case TokenType.Name:
      return pdfName(token.value as string);

    case TokenType.Bool:
      return pdfBool(token.value as boolean);

    case TokenType.Null:
      return PDF_NULL;

    case TokenType.DictStart: {
      const entries = new Map<string, PdfObject>();
      while (true) {
        lexer.skipWhitespaceAndComments();
        const keyToken = lexer.nextToken();
        if (keyToken.type === TokenType.DictEnd || keyToken.type === TokenType.EOF) break;
        if (keyToken.type !== TokenType.Name) continue;
        const value = parseValue(lexer);
        entries.set(keyToken.value as string, value);
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
        items.push(parseValue(lexer));
      }
      return pdfArray(items);
    }

    default:
      return PDF_NULL;
  }
}

const MAX_RESOLVE_DEPTH = 100;

export class PdfParser {
  private _lexer: PdfLexer | null;
  private readonly xref: XRefTable = new Map();
  private readonly objectCache = new Map<string, PdfObject>();
  private trailer!: TrailerInfo;
  private resolveDepth = 0;
  private encryptionInfo: EncryptionInfo | null = null;

  constructor(data: Uint8Array) {
    this._lexer = new PdfLexer(data);
  }

  private get lexer(): PdfLexer {
    return this._lexer!;
  }

  /** Parse the PDF structure: locate xref, parse trailer, build object index */
  parse(): void {
    try {
      const startXRefOffset = findStartXRef(this.lexer);
      this.parseXRefAt(startXRefOffset);
    } catch {
      // XRef parsing failed -- fall back to full document scan
      this.xref.clear();
      this.trailer = undefined as unknown as TrailerInfo;
      const recovery = scanForObjects(this.lexer);
      this.mergeXRef(recovery.table);
      this.trailer = recovery.trailer;
    }

    if (!this.trailer?.root) {
      throw new PdfParseError('Trailer missing /Root entry');
    }

    const encryptRef = dictGet(this.trailer.dict, 'Encrypt');
    if (encryptRef) {
      const encryptDict = this.resolveDict(encryptRef);
      if (!encryptDict) {
        throw new PdfUnsupportedError('Encrypted PDF: cannot read encryption dictionary');
      }

      const idRef = dictGet(this.trailer.dict, 'ID');
      const idArray = idRef ? this.resolveArray(idRef) : null;
      const firstId = idArray?.items[0];
      if (!firstId || !isString(firstId)) {
        throw new PdfUnsupportedError('Encrypted PDF: missing file ID');
      }

      const info = tryEmptyPassword(encryptDict, firstId.value);
      if (!info) {
        throw new PdfUnsupportedError('Encrypted PDF requires a password');
      }
      this.encryptionInfo = info;
    }
  }

  /** Get the trailer info */
  getTrailer(): TrailerInfo {
    return this.trailer;
  }

  /** Resolve an indirect reference to its value */
  resolve(obj: PdfObject): PdfObject {
    if (isRef(obj)) {
      if (this.resolveDepth >= MAX_RESOLVE_DEPTH) return PDF_NULL;
      this.resolveDepth++;
      try {
        return this.getObject(obj.objNum, obj.gen);
      } finally {
        this.resolveDepth--;
      }
    }
    return obj;
  }

  /** Resolve a reference and ensure it's a dict */
  resolveDict(obj: PdfObject): PdfDict | null {
    const resolved = this.resolve(obj);
    if (isDict(resolved)) return resolved;
    if (isStream(resolved)) return resolved.dict;
    return null;
  }

  /** Resolve a reference and ensure it's an array */
  resolveArray(obj: PdfObject): PdfArray | null {
    const resolved = this.resolve(obj);
    return isArray(resolved) ? resolved : null;
  }

  /** Get a specific indirect object by number and generation */
  getObject(objNum: number, gen = 0): PdfObject {
    const cacheKey = `${objNum}:${gen}`;
    const cached = this.objectCache.get(cacheKey);
    if (cached) return cached;

    const entry = this.xref.get(objNum);
    if (!entry || entry.free) return PDF_NULL;

    let obj: PdfObject;

    if (entry.streamObjNum !== undefined) {
      obj = this.getCompressedObject(entry.streamObjNum, entry.streamIndex!);
    } else {
      obj = this.parseObjectAt(entry.offset);
      if (this.encryptionInfo) {
        obj = this.decryptParsedObject(obj, objNum, gen);
      }
    }

    this.objectCache.set(cacheKey, obj);
    return obj;
  }

  /** Decode a stream's data, applying its filters */
  decodeStreamData(stream: PdfStream): Uint8Array {
    return decodeStream(stream.data, stream.dict, (obj) => this.resolve(obj));
  }

  /** Get the catalog (root) dictionary */
  getCatalog(): PdfDict {
    if (!this.trailer.root) {
      throw new PdfParseError('Trailer missing /Root entry');
    }
    const root = this.resolve(this.trailer.root);
    if (!isDict(root)) {
      throw new PdfParseError('Root catalog is not a dictionary');
    }
    return root;
  }

  /** Get all page dictionaries in order */
  getPages(): PdfDict[] {
    const catalog = this.getCatalog();
    const pagesRef = dictGet(catalog, 'Pages');
    if (!pagesRef) throw new PdfParseError('Catalog missing /Pages');

    const pages: PdfDict[] = [];
    this.collectPages(this.resolve(pagesRef), pages);
    return pages;
  }

  /** Get the info dictionary if present */
  getInfoDict(): PdfDict | null {
    if (!this.trailer.info) return null;
    const info = this.resolve(this.trailer.info);
    return isDict(info) ? info : null;
  }

  /** Release the PDF buffer and object cache for garbage collection. */
  dispose(): void {
    this.objectCache.clear();
    this.xref.clear();
    this._lexer = null;
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  // ─── Private ───

  private parseXRefAt(offset: number): void {
    this.lexer.position = offset;
    this.lexer.skipWhitespaceAndComments();

    // Check if this is a traditional xref table or an xref stream
    const savedPos = this.lexer.position;
    const firstToken = this.lexer.nextToken();
    this.lexer.position = savedPos;

    let trailer: TrailerInfo;

    if (firstToken.type === TokenType.Keyword && firstToken.value === 'xref') {
      // Traditional xref table
      const result = parseXRefTable(this.lexer, offset);
      this.mergeXRef(result.table);
      trailer = result.trailer;
    } else if (firstToken.type === TokenType.Number) {
      // XRef stream
      const result = parseXRefStream(
        this.lexer,
        offset,
        (data, dict) => decodeStream(data, dict),
        (dict) => this.resolveIndirectLength(dict),
      );
      this.mergeXRef(result.table);
      trailer = result.trailer;
    } else {
      throw new PdfParseError(`Unexpected token at xref offset ${offset}: ${firstToken.type}`, offset);
    }

    // Store trailer -- first one with /Root wins, but keep the first
    // trailer dict regardless so /Prev chain continues.
    if (!this.trailer) {
      this.trailer = trailer;
    } else if (!this.trailer.root && trailer.root) {
      this.trailer = { ...this.trailer, root: trailer.root };
    }

    // Follow /Prev chain for incremental updates
    if (trailer.prev !== undefined) {
      this.parseXRefAt(trailer.prev);
    }
  }

  private mergeXRef(table: XRefTable): void {
    for (const [objNum, entry] of table) {
      // First entry wins (most recent update is parsed first)
      if (!this.xref.has(objNum)) {
        this.xref.set(objNum, entry);
      }
    }
  }

  private parseObjectAt(offset: number): PdfObject {
    this.lexer.position = offset;

    // Read "objNum gen obj"
    const objNumToken = this.lexer.nextToken();
    const genToken = this.lexer.nextToken();
    const objKeyword = this.lexer.nextToken();

    if (objKeyword.type !== TokenType.Keyword || objKeyword.value !== 'obj') {
      return PDF_NULL;
    }

    const obj = this.parseValue();

    // Check if it's followed by a stream
    this.lexer.skipWhitespaceAndComments();
    const savedPos = this.lexer.position;
    const nextToken = this.lexer.nextToken();

    if (nextToken.type === TokenType.Keyword && nextToken.value === 'stream') {
      // Skip the single line ending after "stream"
      let b = this.lexer.peek();
      if (b === 0x0d) { // CR
        this.lexer.read();
        if (this.lexer.peek() === 0x0a) this.lexer.read(); // CRLF
      } else if (b === 0x0a) { // LF
        this.lexer.read();
      }

      if (isDict(obj)) {
        const streamStart = this.lexer.position;
        const length = this.resolveLength(obj);
        if (length >= 0) {
          const streamData = this.lexer.slice(streamStart, streamStart + length);
          return pdfStream(obj, streamData);
        }

        // If length is unknown, search for endstream
        const endPos = this.lexer.findNext(ENDSTREAM_MARKER, streamStart);
        if (endPos !== -1) {
          let dataEnd = endPos;
          while (dataEnd > streamStart && (
            this.lexer.slice(dataEnd - 1, dataEnd)[0] === 0x0a ||
            this.lexer.slice(dataEnd - 1, dataEnd)[0] === 0x0d
          )) {
            dataEnd--;
          }
          const streamData = this.lexer.slice(streamStart, dataEnd);
          return pdfStream(obj, streamData);
        }
      }
    } else {
      this.lexer.position = savedPos;
    }

    return obj;
  }

  private resolveIndirectLength(dict: PdfDict): number | undefined {
    const lengthObj = dictGet(dict, 'Length');
    if (!lengthObj) return undefined;
    if (isNumber(lengthObj)) return lengthObj.value;
    if (isRef(lengthObj)) {
      const entry = this.xref.get(lengthObj.objNum);
      if (entry && !entry.free && entry.streamObjNum === undefined) {
        const resolved = this.parseObjectAt(entry.offset);
        if (isNumber(resolved)) return resolved.value;
      }
    }
    return undefined;
  }

  private resolveLength(dict: PdfDict): number {
    const lengthObj = dictGet(dict, 'Length');
    if (!lengthObj) return -1;

    if (isNumber(lengthObj)) return lengthObj.value;

    // Length may be an indirect reference
    if (isRef(lengthObj)) {
      const resolved = this.getObject(lengthObj.objNum, lengthObj.gen);
      if (isNumber(resolved)) return resolved.value;
    }

    return -1;
  }

  private parseValue(): PdfObject {
    return parseValue(this.lexer);
  }

  private getCompressedObject(streamObjNum: number, index: number): PdfObject {
    const streamObj = this.getObject(streamObjNum);
    if (!isStream(streamObj)) return PDF_NULL;

    const decoded = this.decodeStreamData(streamObj);
    const n = dictGetNumber(streamObj.dict, 'N') ?? 0;
    const first = dictGetNumber(streamObj.dict, 'First') ?? 0;

    const headerLexer = new PdfLexer(decoded);
    const pairs: Array<{ objNum: number; offset: number }> = [];

    for (let i = 0; i < n; i++) {
      const numToken = headerLexer.nextToken();
      const offsetToken = headerLexer.nextToken();
      if (numToken.type === TokenType.Number && offsetToken.type === TokenType.Number) {
        pairs.push({
          objNum: numToken.value as number,
          offset: (offsetToken.value as number) + first,
        });
      }
    }

    if (index >= pairs.length) return PDF_NULL;

    const objLexer = new PdfLexer(decoded, pairs[index].offset);
    return parseValue(objLexer);
  }

  /**
   * Decrypt a parsed object in place. Per PDF spec, only strings and
   * stream data are encrypted. Uses the parent object's number/gen for
   * the per-object key derivation.
   */
  private decryptParsedObject(obj: PdfObject, objNum: number, gen: number): PdfObject {
    const enc = this.encryptionInfo!;

    if (isStream(obj)) {
      const decryptedData = decryptData(enc, obj.data, objNum, gen);
      const decryptedDict = this.decryptDictStrings(obj.dict, objNum, gen);
      return pdfStream(decryptedDict, decryptedData);
    }

    if (isDict(obj)) {
      return this.decryptDictStrings(obj, objNum, gen);
    }

    if (isString(obj)) {
      return pdfString(decryptData(enc, obj.value, objNum, gen));
    }

    if (isArray(obj)) {
      return this.decryptArrayStrings(obj, objNum, gen);
    }

    return obj;
  }

  private decryptDictStrings(dict: PdfDict, objNum: number, gen: number): PdfDict {
    const enc = this.encryptionInfo!;
    let changed = false;
    const newEntries = new Map<string, PdfObject>();
    for (const [key, val] of dict.entries) {
      if (isString(val)) {
        newEntries.set(key, pdfString(decryptData(enc, val.value, objNum, gen)));
        changed = true;
      } else if (isDict(val)) {
        const d = this.decryptDictStrings(val, objNum, gen);
        newEntries.set(key, d);
        if (d !== val) changed = true;
      } else if (isArray(val)) {
        const a = this.decryptArrayStrings(val, objNum, gen);
        newEntries.set(key, a);
        if (a !== val) changed = true;
      } else {
        newEntries.set(key, val);
      }
    }
    return changed ? pdfDict(newEntries) : dict;
  }

  private decryptArrayStrings(arr: PdfArray, objNum: number, gen: number): PdfArray {
    const enc = this.encryptionInfo!;
    let changed = false;
    const newItems: PdfObject[] = [];
    for (const item of arr.items) {
      if (isString(item)) {
        newItems.push(pdfString(decryptData(enc, item.value, objNum, gen)));
        changed = true;
      } else if (isDict(item)) {
        const d = this.decryptDictStrings(item, objNum, gen);
        newItems.push(d);
        if (d !== item) changed = true;
      } else if (isArray(item)) {
        const a = this.decryptArrayStrings(item, objNum, gen);
        newItems.push(a);
        if (a !== item) changed = true;
      } else {
        newItems.push(item);
      }
    }
    return changed ? pdfArray(newItems) : arr;
  }

  private collectPages(node: PdfObject, pages: PdfDict[]): void {
    const dict = isDict(node) ? node : isStream(node) ? node.dict : null;
    if (!dict) return;

    const type = dictGetName(dict, 'Type');

    if (type === 'Pages') {
      const kids = dictGet(dict, 'Kids');
      if (kids) {
        const kidsArr = this.resolveArray(kids);
        if (kidsArr) {
          for (const kid of kidsArr.items) {
            const resolvedKid = this.resolve(kid);
            this.collectPages(resolvedKid, pages);
          }
        }
      }
    } else if (type === 'Page') {
      pages.push(dict);
    } else {
      // No /Type? Try to detect if it's a page or pages node
      const kids = dictGet(dict, 'Kids');
      if (kids) {
        const kidsArr = this.resolveArray(kids);
        if (kidsArr) {
          for (const kid of kidsArr.items) {
            const resolvedKid = this.resolve(kid);
            this.collectPages(resolvedKid, pages);
          }
        }
      } else {
        // Assume it's a page
        pages.push(dict);
      }
    }
  }
}
