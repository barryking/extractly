/**
 * PDF Lexer / Tokenizer
 *
 * Reads raw PDF bytes and produces a stream of tokens. The lexer handles:
 * - Whitespace and comment skipping
 * - Numbers (integer and real)
 * - Literal strings ( ... ) with escape sequences and nesting
 * - Hex strings < ... >
 * - Names /SomeName
 * - Booleans true/false
 * - null
 * - Keywords (obj, endobj, stream, endstream, xref, trailer, startxref, R)
 * - Array delimiters [ ]
 * - Dictionary delimiters << >>
 */

export const enum TokenType {
  Number = 'Number',
  String = 'String',
  HexString = 'HexString',
  Name = 'Name',
  Bool = 'Bool',
  Null = 'Null',
  Keyword = 'Keyword',
  ArrayStart = 'ArrayStart',
  ArrayEnd = 'ArrayEnd',
  DictStart = 'DictStart',
  DictEnd = 'DictEnd',
  EOF = 'EOF',
}

export interface Token {
  readonly type: TokenType;
  readonly value: string | number | boolean | Uint8Array | null;
  readonly offset: number;
}

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0d, 0x0c, 0x20]);
const DELIMITERS = new Set([
  0x28, 0x29, // ( )
  0x3c, 0x3e, // < >
  0x5b, 0x5d, // [ ]
  0x7b, 0x7d, // { }
  0x2f,       // /
  0x25,       // %
]);

function isWhitespace(byte: number): boolean {
  return WHITESPACE.has(byte);
}

function isDelimiter(byte: number): boolean {
  return DELIMITERS.has(byte);
}

function isDigit(byte: number): boolean {
  return byte >= 0x30 && byte <= 0x39;
}

function isOctalDigit(byte: number): boolean {
  return byte >= 0x30 && byte <= 0x37;
}

function isHexDigit(byte: number): boolean {
  return (byte >= 0x30 && byte <= 0x39) ||
         (byte >= 0x41 && byte <= 0x46) ||
         (byte >= 0x61 && byte <= 0x66);
}

function hexVal(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  return 0;
}

export class PdfLexer {
  private readonly data: Uint8Array;
  private pos: number;

  constructor(data: Uint8Array, offset = 0) {
    this.data = data;
    this.pos = offset;
  }

  get position(): number {
    return this.pos;
  }

  set position(offset: number) {
    this.pos = offset;
  }

  get length(): number {
    return this.data.length;
  }

  get atEnd(): boolean {
    return this.pos >= this.data.length;
  }

  peek(): number {
    return this.pos < this.data.length ? this.data[this.pos] : -1;
  }

  read(): number {
    return this.pos < this.data.length ? this.data[this.pos++] : -1;
  }

  /** Skip whitespace and comments */
  skipWhitespaceAndComments(): void {
    while (this.pos < this.data.length) {
      const b = this.data[this.pos];
      if (isWhitespace(b)) {
        this.pos++;
        continue;
      }
      if (b === 0x25) { // % comment
        this.pos++;
        while (this.pos < this.data.length) {
          const c = this.data[this.pos++];
          if (c === 0x0a || c === 0x0d) break;
        }
        continue;
      }
      break;
    }
  }

  /** Read the next token */
  nextToken(): Token {
    this.skipWhitespaceAndComments();

    if (this.pos >= this.data.length) {
      return { type: TokenType.EOF, value: null, offset: this.pos };
    }

    const startOffset = this.pos;
    const b = this.data[this.pos];

    // Dictionary start <<
    if (b === 0x3c && this.pos + 1 < this.data.length && this.data[this.pos + 1] === 0x3c) {
      this.pos += 2;
      return { type: TokenType.DictStart, value: '<<', offset: startOffset };
    }

    // Dictionary end >>
    if (b === 0x3e && this.pos + 1 < this.data.length && this.data[this.pos + 1] === 0x3e) {
      this.pos += 2;
      return { type: TokenType.DictEnd, value: '>>', offset: startOffset };
    }

    // Hex string <...>
    if (b === 0x3c) {
      return this.readHexString(startOffset);
    }

    // Literal string (...)
    if (b === 0x28) {
      return this.readLiteralString(startOffset);
    }

    // Array start
    if (b === 0x5b) {
      this.pos++;
      return { type: TokenType.ArrayStart, value: '[', offset: startOffset };
    }

    // Array end
    if (b === 0x5d) {
      this.pos++;
      return { type: TokenType.ArrayEnd, value: ']', offset: startOffset };
    }

    // Name
    if (b === 0x2f) {
      return this.readName(startOffset);
    }

    // Number (including negative and real)
    if (isDigit(b) || b === 0x2d || b === 0x2b || b === 0x2e) {
      return this.readNumber(startOffset);
    }

    // Keyword or boolean or null
    if (b >= 0x41 && b <= 0x7a) {
      return this.readKeyword(startOffset);
    }

    // Unknown - skip and try again
    this.pos++;
    return this.nextToken();
  }

  private readHexString(startOffset: number): Token {
    this.pos++; // skip <
    const bytes: number[] = [];
    let high = -1;

    while (this.pos < this.data.length) {
      const c = this.data[this.pos++];
      if (c === 0x3e) break; // >
      if (isWhitespace(c)) continue;

      if (isHexDigit(c)) {
        if (high === -1) {
          high = hexVal(c);
        } else {
          bytes.push((high << 4) | hexVal(c));
          high = -1;
        }
      }
    }

    // Odd number of hex digits: pad with 0
    if (high !== -1) {
      bytes.push(high << 4);
    }

    return { type: TokenType.HexString, value: new Uint8Array(bytes), offset: startOffset };
  }

  private readLiteralString(startOffset: number): Token {
    this.pos++; // skip (
    const bytes: number[] = [];
    let depth = 1;

    while (this.pos < this.data.length && depth > 0) {
      const c = this.data[this.pos++];

      if (c === 0x28) { // (
        depth++;
        bytes.push(c);
      } else if (c === 0x29) { // )
        depth--;
        if (depth > 0) bytes.push(c);
      } else if (c === 0x5c) { // backslash
        if (this.pos >= this.data.length) break;
        const esc = this.data[this.pos++];
        switch (esc) {
          case 0x6e: bytes.push(0x0a); break; // \n
          case 0x72: bytes.push(0x0d); break; // \r
          case 0x74: bytes.push(0x09); break; // \t
          case 0x62: bytes.push(0x08); break; // \b
          case 0x66: bytes.push(0x0c); break; // \f
          case 0x28: bytes.push(0x28); break; // \(
          case 0x29: bytes.push(0x29); break; // \)
          case 0x5c: bytes.push(0x5c); break; // \\
          case 0x0a: break; // line continuation LF
          case 0x0d: // line continuation CR or CRLF
            if (this.pos < this.data.length && this.data[this.pos] === 0x0a) this.pos++;
            break;
          default:
            // Octal escape
            if (isOctalDigit(esc)) {
              let octal = esc - 0x30;
              if (this.pos < this.data.length && isOctalDigit(this.data[this.pos])) {
                octal = (octal << 3) | (this.data[this.pos++] - 0x30);
                if (this.pos < this.data.length && isOctalDigit(this.data[this.pos])) {
                  octal = (octal << 3) | (this.data[this.pos++] - 0x30);
                }
              }
              bytes.push(octal & 0xff);
            } else {
              bytes.push(esc);
            }
        }
      } else {
        bytes.push(c);
      }
    }

    return { type: TokenType.String, value: new Uint8Array(bytes), offset: startOffset };
  }

  private readName(startOffset: number): Token {
    this.pos++; // skip /
    let name = '';

    while (this.pos < this.data.length) {
      const c = this.data[this.pos];
      if (isWhitespace(c) || isDelimiter(c)) break;

      if (c === 0x23 && this.pos + 2 < this.data.length) {
        // #XX hex escape in names
        const h1 = this.data[this.pos + 1];
        const h2 = this.data[this.pos + 2];
        if (isHexDigit(h1) && isHexDigit(h2)) {
          name += String.fromCharCode((hexVal(h1) << 4) | hexVal(h2));
          this.pos += 3;
          continue;
        }
      }

      name += String.fromCharCode(c);
      this.pos++;
    }

    return { type: TokenType.Name, value: name, offset: startOffset };
  }

  private readNumber(startOffset: number): Token {
    let numStr = '';
    let isReal = false;

    // Sign
    if (this.data[this.pos] === 0x2d || this.data[this.pos] === 0x2b) {
      numStr += String.fromCharCode(this.data[this.pos++]);
    }

    while (this.pos < this.data.length) {
      const c = this.data[this.pos];
      if (isDigit(c)) {
        numStr += String.fromCharCode(c);
        this.pos++;
      } else if (c === 0x2e && !isReal) {
        isReal = true;
        numStr += '.';
        this.pos++;
      } else {
        break;
      }
    }

    const value = isReal ? parseFloat(numStr) : parseInt(numStr, 10);

    if (isNaN(value)) {
      // Not actually a number, treat as keyword
      return this.readKeyword(startOffset);
    }

    return { type: TokenType.Number, value, offset: startOffset };
  }

  private readKeyword(startOffset: number): Token {
    let word = '';

    while (this.pos < this.data.length) {
      const c = this.data[this.pos];
      if (isWhitespace(c) || isDelimiter(c)) break;
      word += String.fromCharCode(c);
      this.pos++;
    }

    if (word === 'true') {
      return { type: TokenType.Bool, value: true, offset: startOffset };
    }
    if (word === 'false') {
      return { type: TokenType.Bool, value: false, offset: startOffset };
    }
    if (word === 'null') {
      return { type: TokenType.Null, value: null, offset: startOffset };
    }

    return { type: TokenType.Keyword, value: word, offset: startOffset };
  }

  /** Read a line of bytes ending at LF or CRLF, returning the content without the line ending. */
  readLine(): string {
    let line = '';
    while (this.pos < this.data.length) {
      const c = this.data[this.pos++];
      if (c === 0x0a) break;
      if (c === 0x0d) {
        if (this.pos < this.data.length && this.data[this.pos] === 0x0a) this.pos++;
        break;
      }
      line += String.fromCharCode(c);
    }
    return line;
  }

  /** Get the raw bytes from the buffer */
  slice(start: number, end: number): Uint8Array {
    return this.data.subarray(start, end);
  }

  /** Find a byte sequence searching backward from the end of the file */
  findLast(needle: Uint8Array): number {
    const len = needle.length;
    for (let i = this.data.length - len; i >= 0; i--) {
      let match = true;
      for (let j = 0; j < len; j++) {
        if (this.data[i + j] !== needle[j]) {
          match = false;
          break;
        }
      }
      if (match) return i;
    }
    return -1;
  }

  /** Find a byte sequence searching forward from the current position */
  findNext(needle: Uint8Array, from?: number): number {
    const start = from ?? this.pos;
    const len = needle.length;
    for (let i = start; i <= this.data.length - len; i++) {
      let match = true;
      for (let j = 0; j < len; j++) {
        if (this.data[i + j] !== needle[j]) {
          match = false;
          break;
        }
      }
      if (match) return i;
    }
    return -1;
  }
}
