/**
 * Font Resolution and Text Decoding
 *
 * Resolves PDF font resources and decodes glyph codes into Unicode strings.
 * Handles ToUnicode CMaps, encoding differences, identity mappings, and
 * glyph width extraction for accurate text positioning.
 */

import type { PdfParser } from '../parser/parser.js';
import type { PdfDict, PdfObject, PdfArray } from '../parser/types.js';
import {
  isDict, isStream, isName, isNumber, isArray,
  dictGet, dictGetName, dictGetNumber, dictGetArray,
} from '../parser/types.js';
import { getEncodingByName, WinAnsiEncoding } from '../encoding/encodings.js';
import { glyphNameToUnicode } from '../encoding/glyphlist.js';
import { parseToUnicodeCMap, type ToUnicodeMap } from '../encoding/cmap.js';

/** Resolved font info for text extraction */
export interface FontInfo {
  toUnicode: ToUnicodeMap | null;
  encoding: readonly number[] | null;
  differences: Map<number, string> | null;
  isIdentity: boolean;
  baseFont: string;
  /** Character code -> glyph width in 1/1000 text space units */
  widths: Map<number, number>;
  /** Default glyph width in 1/1000 text space units (600 for simple fonts, 1000 for CID) */
  defaultWidth: number;
}

/** Resolve the resources dictionary for a page, walking up the parent chain if needed. */
export function resolveResources(
  pageDict: PdfDict,
  parser: PdfParser,
  _visited?: Set<PdfDict>,
): PdfDict | null {
  const resourcesObj = dictGet(pageDict, 'Resources');
  if (resourcesObj) {
    return parser.resolveDict(resourcesObj);
  }

  const parentObj = dictGet(pageDict, 'Parent');
  if (parentObj) {
    const parent = parser.resolveDict(parentObj);
    if (parent) {
      const visited = _visited ?? new Set<PdfDict>();
      if (visited.has(parent)) return null;
      visited.add(parent);
      return resolveResources(parent, parser, visited);
    }
  }

  return null;
}

/** Resolve font resources from an already-resolved resources dictionary. */
export function resolveFonts(
  resources: PdfDict | null,
  parser: PdfParser,
): Map<string, FontInfo> {
  const fonts = new Map<string, FontInfo>();
  if (!resources) return fonts;

  const fontDict = dictGet(resources, 'Font');
  if (!fontDict) return fonts;

  const resolvedFontDict = parser.resolveDict(fontDict);
  if (!resolvedFontDict) return fonts;

  for (const [name, fontRef] of resolvedFontDict.entries) {
    const fontObj = parser.resolveDict(fontRef);
    if (!fontObj) continue;

    const fontInfo = buildFontInfo(fontObj, parser);
    fonts.set(name, fontInfo);
  }

  return fonts;
}

export function buildFontInfo(fontDict: PdfDict, parser: PdfParser): FontInfo {
  const baseFont = dictGetName(fontDict, 'BaseFont') ?? 'unknown';
  const subtype = dictGetName(fontDict, 'Subtype');

  // Check for ToUnicode CMap
  let toUnicode: ToUnicodeMap | null = null;
  const toUnicodeRef = dictGet(fontDict, 'ToUnicode');
  if (toUnicodeRef) {
    const toUnicodeObj = parser.resolve(toUnicodeRef);
    if (isStream(toUnicodeObj)) {
      const decoded = parser.decodeStreamData(toUnicodeObj);
      toUnicode = parseToUnicodeCMap(decoded);
    }
  }

  // Determine encoding
  let encoding: readonly number[] | null = null;
  let differences: Map<number, string> | null = null;
  let isIdentity = false;

  const encodingObj = dictGet(fontDict, 'Encoding');
  if (encodingObj) {
    if (isName(encodingObj)) {
      const encName = encodingObj.value;
      if (encName === 'Identity-H' || encName === 'Identity-V') {
        isIdentity = true;
      } else {
        encoding = getEncodingByName(encName);
      }
    } else {
      const encDict = parser.resolveDict(encodingObj);
      if (encDict) {
        const baseEnc = dictGetName(encDict, 'BaseEncoding');
        if (baseEnc) {
          encoding = getEncodingByName(baseEnc);
        }

        const diffsArr = dictGetArray(encDict, 'Differences');
        if (diffsArr) {
          differences = parseDifferences(diffsArr, parser);
        }
      }
    }
  }

  if (!encoding && !toUnicode && !isIdentity) {
    if (subtype === 'Type1' || subtype === 'TrueType' || subtype === 'MMType1' || subtype === 'Type3') {
      encoding = WinAnsiEncoding;
    }
  }

  if (subtype === 'Type0' && !toUnicode) {
    isIdentity = true;
  }

  // Extract glyph widths
  const widths = new Map<number, number>();
  let defaultWidth = 600;

  if (subtype === 'Type0') {
    defaultWidth = 1000;
    const descendantsArr = dictGetArray(fontDict, 'DescendantFonts');
    if (descendantsArr && descendantsArr.items.length > 0) {
      const cidFont = parser.resolveDict(descendantsArr.items[0]);
      if (cidFont) {
        const dw = dictGetNumber(cidFont, 'DW');
        if (dw !== undefined) defaultWidth = dw;

        const wArr = dictGetArray(cidFont, 'W');
        if (wArr) {
          parseCIDWidths(wArr, widths, parser);
        }

        const descRef = dictGet(cidFont, 'FontDescriptor');
        if (descRef) {
          const desc = parser.resolveDict(descRef);
          if (desc) {
            const mw = dictGetNumber(desc, 'MissingWidth');
            if (mw !== undefined && mw > 0) defaultWidth = mw;
          }
        }
      }
    }
  } else if (subtype === 'Type1' || subtype === 'TrueType' || subtype === 'MMType1' || subtype === 'Type3') {
    const firstChar = dictGetNumber(fontDict, 'FirstChar') ?? 0;
    const widthsArr = dictGetArray(fontDict, 'Widths');
    if (widthsArr) {
      for (let i = 0; i < widthsArr.items.length; i++) {
        const w = parser.resolve(widthsArr.items[i]);
        if (isNumber(w)) {
          widths.set(firstChar + i, w.value);
        }
      }
    }

    const descRef = dictGet(fontDict, 'FontDescriptor');
    if (descRef) {
      const desc = parser.resolveDict(descRef);
      if (desc) {
        const mw = dictGetNumber(desc, 'MissingWidth');
        if (mw !== undefined && mw > 0) defaultWidth = mw;
      }
    }
  }

  // DW=0 fallback: use average of known widths to avoid catastrophic spacing
  if (defaultWidth === 0 && widths.size > 0) {
    let sum = 0;
    let count = 0;
    for (const w of widths.values()) {
      if (w > 0) { sum += w; count++; }
    }
    if (count > 0) {
      defaultWidth = sum / count;
    }
  }

  return { toUnicode, encoding, differences, isIdentity, baseFont, widths, defaultWidth };
}

function parseDifferences(
  diffsArr: { items: PdfObject[] },
  parser: PdfParser,
): Map<number, string> {
  const diffs = new Map<number, string>();
  let currentCode = 0;

  for (const item of diffsArr.items) {
    const resolved = parser.resolve(item);
    if (isNumber(resolved)) {
      currentCode = resolved.value;
    } else if (isName(resolved)) {
      diffs.set(currentCode, resolved.value);
      currentCode++;
    }
  }

  return diffs;
}

/**
 * Parse CIDFont /W array into a widths map.
 */
export function parseCIDWidths(
  wArr: PdfArray,
  widths: Map<number, number>,
  parser: PdfParser,
): void {
  const items = wArr.items;
  const numBuf: number[] = [];

  for (let i = 0; i < items.length; i++) {
    const resolved = parser.resolve(items[i]);

    if (isArray(resolved)) {
      if (numBuf.length > 0) {
        const startCID = Math.floor(numBuf[numBuf.length - 1]);

        for (let j = 0; j + 1 < numBuf.length - 1; j += 2) {
          widths.set(Math.floor(numBuf[j]), numBuf[j + 1]);
        }

        for (let j = 0; j < resolved.items.length; j++) {
          const w = parser.resolve(resolved.items[j]);
          if (isNumber(w)) {
            widths.set(startCID + j, w.value);
          }
        }
        numBuf.length = 0;
      }
    } else if (isNumber(resolved)) {
      numBuf.push(resolved.value);

      if (numBuf.length === 3) {
        const [c1, c2, w] = numBuf;
        if (Number.isInteger(c1) && Number.isInteger(c2) && c2 >= c1) {
          for (let cid = c1; cid <= c2; cid++) {
            widths.set(cid, w);
          }
          numBuf.length = 0;
        } else {
          widths.set(Math.floor(c1), c2);
          numBuf.length = 0;
          numBuf.push(w);
        }
      }
    }
  }

  for (let j = 0; j + 1 < numBuf.length; j += 2) {
    widths.set(Math.floor(numBuf[j]), numBuf[j + 1]);
  }
}

/** Get the width of a single character code in text space units (0..~1) */
export function getCharWidth(charCode: number, font: FontInfo): number {
  const w = font.widths.get(charCode);
  return (w !== undefined ? w : font.defaultWidth) / 1000;
}

/**
 * Compute text metrics from raw bytes using actual font glyph widths.
 * Returns total glyph width (in text space units), character count, and space count.
 */
export function computeTextMetrics(
  bytes: Uint8Array,
  font: FontInfo,
): { totalWidth: number; charCount: number; spaceCount: number } {
  let totalWidth = 0;
  let charCount = 0;
  let spaceCount = 0;

  if (font.isIdentity && bytes.length % 2 === 0) {
    for (let i = 0; i < bytes.length; i += 2) {
      const code = (bytes[i] << 8) | bytes[i + 1];
      totalWidth += getCharWidth(code, font);
      charCount++;
      if (code === 32) spaceCount++;
    }
  } else {
    for (const b of bytes) {
      totalWidth += getCharWidth(b, font);
      charCount++;
      if (b === 32) spaceCount++;
    }
  }

  return { totalWidth, charCount, spaceCount };
}

/** Decode a PDF text string to Unicode using font encoding information. */
export function decodeTextString(bytes: Uint8Array, font: FontInfo): string {
  if (font.toUnicode) {
    return decodeWithToUnicode(bytes, font.toUnicode, font.isIdentity);
  }

  if (font.differences || font.encoding) {
    return decodeWithEncoding(bytes, font.encoding, font.differences);
  }

  if (font.isIdentity) {
    return decodeIdentity(bytes);
  }

  let result = '';
  for (const b of bytes) {
    if (b >= 0x20) {
      result += String.fromCharCode(b);
    }
  }
  return result;
}

function decodeWithToUnicode(
  bytes: Uint8Array,
  toUnicode: ToUnicodeMap,
  isIdentity: boolean,
): string {
  let result = '';

  if (isIdentity && bytes.length % 2 === 0) {
    for (let i = 0; i < bytes.length; i += 2) {
      const code = (bytes[i] << 8) | bytes[i + 1];
      const mapped = toUnicode.get(code);
      if (mapped) {
        result += mapped;
      } else if (code >= 0x20) {
        result += String.fromCodePoint(code);
      }
    }
  } else {
    for (const b of bytes) {
      const mapped = toUnicode.get(b);
      if (mapped) {
        result += mapped;
      } else if (b >= 0x20) {
        result += String.fromCharCode(b);
      }
    }
  }

  return result;
}

function decodeWithEncoding(
  bytes: Uint8Array,
  encoding: readonly number[] | null,
  differences: Map<number, string> | null,
): string {
  let result = '';

  for (const b of bytes) {
    if (differences) {
      const glyphName = differences.get(b);
      if (glyphName) {
        const unicode = glyphNameToUnicode(glyphName);
        if (unicode) {
          result += unicode;
          continue;
        }
      }
    }

    if (encoding) {
      const cp = encoding[b];
      if (cp > 0) {
        result += String.fromCodePoint(cp);
        continue;
      }
    }

    if (b >= 0x20 && b <= 0x7e) {
      result += String.fromCharCode(b);
    }
  }

  return result;
}

function decodeIdentity(bytes: Uint8Array): string {
  let result = '';
  if (bytes.length % 2 === 0) {
    for (let i = 0; i < bytes.length; i += 2) {
      const code = (bytes[i] << 8) | bytes[i + 1];
      if (code >= 0x20) {
        result += String.fromCodePoint(code);
      }
    }
  } else {
    for (const b of bytes) {
      if (b >= 0x20) {
        result += String.fromCharCode(b);
      }
    }
  }
  return result;
}
