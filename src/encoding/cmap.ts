/**
 * ToUnicode CMap Parser
 *
 * Parses the ToUnicode CMap embedded in PDF fonts to map character codes
 * to Unicode code points. Handles:
 * - beginbfchar / endbfchar sections (single character mappings)
 * - beginbfrange / endbfrange sections (range mappings)
 */

/** A parsed ToUnicode mapping: character code -> Unicode string */
export type ToUnicodeMap = Map<number, string>;

/**
 * Parse a ToUnicode CMap from its decoded stream bytes.
 */
export function parseToUnicodeCMap(data: Uint8Array): ToUnicodeMap {
  const map: ToUnicodeMap = new Map();
  const text = bytesToString(data);

  parseBfChar(text, map);
  parseBfRange(text, map);

  return map;
}

function bytesToString(data: Uint8Array): string {
  let result = '';
  for (let i = 0; i < data.length; i++) {
    result += String.fromCharCode(data[i]);
  }
  return result;
}

/**
 * Parse beginbfchar / endbfchar sections.
 * Format: <srcCode> <dstString>
 */
function parseBfChar(text: string, map: ToUnicodeMap): void {
  const sectionPattern = /beginbfchar\s*([\s\S]*?)endbfchar/g;
  const sections = text.matchAll(sectionPattern);

  for (const section of sections) {
    const content = section[1];
    const linePattern = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    const lines = content.matchAll(linePattern);

    for (const line of lines) {
      const srcCode = parseInt(line[1], 16);
      const dstStr = hexToUnicodeString(line[2]);
      map.set(srcCode, dstStr);
    }
  }
}

/**
 * Parse beginbfrange / endbfrange sections.
 * Format: <srcCodeLo> <srcCodeHi> <dstStringLo>
 *     OR: <srcCodeLo> <srcCodeHi> [ <dstString1> <dstString2> ... ]
 */
function parseBfRange(text: string, map: ToUnicodeMap): void {
  const sectionPattern = /beginbfrange\s*([\s\S]*?)endbfrange/g;
  const sections = text.matchAll(sectionPattern);

  for (const section of sections) {
    const content = section[1];
    parseRangeContent(content, map);
  }
}

function parseRangeContent(content: string, map: ToUnicodeMap): void {
  let pos = 0;

  while (pos < content.length) {
    while (pos < content.length && /\s/.test(content[pos])) pos++;
    if (pos >= content.length) break;

    const lo = readHexToken(content, pos);
    if (!lo) break;
    pos = lo.end;

    while (pos < content.length && /\s/.test(content[pos])) pos++;

    const hi = readHexToken(content, pos);
    if (!hi) break;
    pos = hi.end;

    while (pos < content.length && /\s/.test(content[pos])) pos++;
    if (pos >= content.length) break;

    if (content[pos] === '[') {
      pos++;
      const loVal = parseInt(lo.hex, 16);
      const hiVal = parseInt(hi.hex, 16);

      for (let code = loVal; code <= hiVal; code++) {
        while (pos < content.length && /\s/.test(content[pos])) pos++;
        if (pos >= content.length || content[pos] === ']') break;

        const dst = readHexToken(content, pos);
        if (!dst) break;
        pos = dst.end;
        map.set(code, hexToUnicodeString(dst.hex));
      }

      while (pos < content.length && content[pos] !== ']') pos++;
      if (pos < content.length) pos++;
    } else {
      const dst = readHexToken(content, pos);
      if (!dst) break;
      pos = dst.end;

      const loVal = parseInt(lo.hex, 16);
      const hiVal = parseInt(hi.hex, 16);
      let dstVal = parseInt(dst.hex, 16);

      for (let code = loVal; code <= hiVal; code++) {
        if (dstVal >= 0 && dstVal <= 0x10FFFF) {
          map.set(code, String.fromCodePoint(dstVal));
        }
        dstVal++;
      }
    }
  }
}

function readHexToken(text: string, pos: number): { hex: string; end: number } | null {
  if (pos >= text.length || text[pos] !== '<') return null;
  pos++;
  let hex = '';
  while (pos < text.length && text[pos] !== '>') {
    if (/[0-9A-Fa-f]/.test(text[pos])) {
      hex += text[pos];
    }
    pos++;
  }
  if (pos < text.length) pos++;
  return { hex, end: pos };
}

/** Convert a hex string to a Unicode string (groups of 4 hex digits = one code point) */
function hexToUnicodeString(hex: string): string {
  let result = '';
  if (hex.length % 4 !== 0) {
    hex = hex.padStart(Math.ceil(hex.length / 4) * 4, '0');
  }
  for (let i = 0; i < hex.length; i += 4) {
    const cp = parseInt(hex.substring(i, i + 4), 16);
    if (!isNaN(cp)) {
      result += String.fromCodePoint(cp);
    }
  }
  return result;
}
