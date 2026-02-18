/**
 * PDF stream decompression filters.
 * Inflate implementation is injected at startup via src/stream/inflate.ts.
 */

import { inflate } from './inflate.js';
import { PdfParseError } from '../errors.js';

/** Decompress FlateDecode (zlib/deflate) data */
export function flateDecode(data: Uint8Array): Uint8Array {
  try {
    return inflate(data);
  } catch {
    throw new PdfParseError('FlateDecode decompression failed');
  }
}

/** Decode ASCIIHexDecode filter */
export function asciiHexDecode(data: Uint8Array): Uint8Array {
  const result: number[] = [];
  let high = -1;

  for (let i = 0; i < data.length; i++) {
    const c = data[i];

    if (c === 0x3e) break; // > = EOD marker

    // Skip whitespace
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0c) continue;

    const val = hexDigitValue(c);
    if (val === -1) continue;

    if (high === -1) {
      high = val;
    } else {
      result.push((high << 4) | val);
      high = -1;
    }
  }

  // Odd trailing digit: pad with 0
  if (high !== -1) {
    result.push(high << 4);
  }

  return new Uint8Array(result);
}

/** Decode ASCII85Decode (btoa) filter */
export function ascii85Decode(data: Uint8Array): Uint8Array {
  const result: number[] = [];
  let i = 0;

  // Skip leading <~ if present
  if (data.length >= 2 && data[0] === 0x3c && data[1] === 0x7e) {
    i = 2;
  }

  while (i < data.length) {
    const c = data[i];

    // End of data marker ~>
    if (c === 0x7e && i + 1 < data.length && data[i + 1] === 0x3e) break;

    // Skip whitespace
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0c) {
      i++;
      continue;
    }

    // 'z' shorthand for 4 zero bytes
    if (c === 0x7a) {
      result.push(0, 0, 0, 0);
      i++;
      continue;
    }

    // Collect up to 5 ASCII85 digits
    const group: number[] = [];
    while (group.length < 5 && i < data.length) {
      const ch = data[i];
      if (ch === 0x7e) break; // ~> end
      if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d || ch === 0x0c) {
        i++;
        continue;
      }
      if (ch < 0x21 || ch > 0x75) {
        i++;
        continue;
      }
      group.push(ch - 0x21);
      i++;
    }

    if (group.length === 0) break;

    // Pad incomplete groups with 'u' (84)
    const padding = 5 - group.length;
    while (group.length < 5) group.push(84);

    let value = 0;
    value += group[0] * 85 * 85 * 85 * 85;
    value += group[1] * 85 * 85 * 85;
    value += group[2] * 85 * 85;
    value += group[3] * 85;
    value += group[4];

    result.push((value >>> 24) & 0xff);
    if (padding < 3) result.push((value >>> 16) & 0xff);
    if (padding < 2) result.push((value >>> 8) & 0xff);
    if (padding < 1) result.push(value & 0xff);
  }

  return new Uint8Array(result);
}

/** Decode LZWDecode filter */
export function lzwDecode(data: Uint8Array, earlyChange = 1): Uint8Array {
  const result: number[] = [];
  let bitPos = 0;
  let codeSize = 9;
  const clearCode = 256;
  const eoiCode = 257;

  type DictEntry = number[];
  let dictionary: DictEntry[] = [];
  let prevEntry: DictEntry | null = null;

  function resetDictionary(): void {
    dictionary = [];
    for (let i = 0; i < 256; i++) {
      dictionary.push([i]);
    }
    dictionary.push([]); // 256 = clear
    dictionary.push([]); // 257 = EOI
    codeSize = 9;
    prevEntry = null;
  }

  function readBits(n: number): number {
    let value = 0;
    for (let i = 0; i < n; i++) {
      const byteIndex = (bitPos + i) >> 3;
      const bitIndex = 7 - ((bitPos + i) & 7);
      if (byteIndex < data.length) {
        value = (value << 1) | ((data[byteIndex] >> bitIndex) & 1);
      }
    }
    bitPos += n;
    return value;
  }

  resetDictionary();

  while (bitPos + codeSize <= data.length * 8) {
    const code = readBits(codeSize);

    if (code === eoiCode) break;

    if (code === clearCode) {
      resetDictionary();
      continue;
    }

    let entry: DictEntry;
    if (code < dictionary.length) {
      entry = dictionary[code];
    } else if (code === dictionary.length && prevEntry) {
      entry = [...prevEntry, prevEntry[0]];
    } else {
      break; // invalid
    }

    for (const b of entry) result.push(b);

    if (prevEntry) {
      dictionary.push([...prevEntry, entry[0]]);
    }

    prevEntry = entry;

    // Increase code size when dictionary reaches threshold
    if (dictionary.length >= (1 << codeSize) - earlyChange && codeSize < 12) {
      codeSize++;
    }
  }

  return new Uint8Array(result);
}

/** Apply PNG predictor to decoded data */
export function applyPNGPredictor(data: Uint8Array, columns: number, colors = 1, bitsPerComponent = 8): Uint8Array {
  if (columns <= 0) return data;

  const bytesPerPixel = Math.ceil((colors * bitsPerComponent) / 8);
  const rowBytes = Math.ceil((columns * colors * bitsPerComponent) / 8);
  if (rowBytes <= 0) return data;
  const rows = Math.floor(data.length / (rowBytes + 1));
  const result = new Uint8Array(rows * rowBytes);

  let srcOffset = 0;
  let dstOffset = 0;

  for (let row = 0; row < rows; row++) {
    const filterType = data[srcOffset++];
    const prevRow = row > 0 ? dstOffset - rowBytes : -1;

    for (let col = 0; col < rowBytes; col++) {
      const raw = data[srcOffset++];
      let left = col >= bytesPerPixel ? result[dstOffset - bytesPerPixel] : 0;
      let above = prevRow >= 0 ? result[prevRow + col] : 0;
      let upperLeft = (prevRow >= 0 && col >= bytesPerPixel) ? result[prevRow + col - bytesPerPixel] : 0;

      let value: number;
      switch (filterType) {
        case 0: // None
          value = raw;
          break;
        case 1: // Sub
          value = (raw + left) & 0xff;
          break;
        case 2: // Up
          value = (raw + above) & 0xff;
          break;
        case 3: // Average
          value = (raw + ((left + above) >> 1)) & 0xff;
          break;
        case 4: // Paeth
          value = (raw + paethPredictor(left, above, upperLeft)) & 0xff;
          break;
        default:
          value = raw;
      }

      result[dstOffset++] = value;
    }
  }

  return result;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function hexDigitValue(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
  return -1;
}
