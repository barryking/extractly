/**
 * Content Stream Interpreter for Text Extraction
 *
 * Parses PDF page content streams and extracts positioned text items.
 * Handles the text state machine (font, position, matrix) and converts
 * glyph codes to Unicode strings via font encoding resolution.
 */

import { PdfLexer, TokenType } from '../parser/lexer.js';
import type { PdfParser } from '../parser/parser.js';
import type { PdfDict } from '../parser/types.js';
import {
  isStream, isNumber, isArray, isDict, isName,
  dictGet, dictGetName, dictGetNumber, dictGetArray,
} from '../parser/types.js';
import type { TextItem } from '../types.js';
import {
  type FontInfo,
  resolveResources,
  resolveFonts,
  buildFontInfo,
  decodeTextString,
  computeTextMetrics,
} from './font-resolver.js';
import { multiplyMatrix, advancePosition, computeItemWidth } from './matrix.js';

/** Pre-computed byte marker for inline image end detection */
const EI_MARKER = new Uint8Array([0x45, 0x49]); // 'EI'

/** Typed operand from content stream parsing */
type Operand =
  | { type: 'number'; value: number }
  | { type: 'string'; value: Uint8Array }
  | { type: 'name'; value: string }
  | { type: 'array'; value: Operand[] }
  | { type: 'other'; value: unknown };

export interface ExtractOptions {
  includeInvisibleText?: boolean;
}

/**
 * Extract text items from a page's content stream(s).
 */
export function extractTextItems(
  pageDict: PdfDict,
  parser: PdfParser,
  options?: ExtractOptions,
): TextItem[] {
  const items: TextItem[] = [];

  const resources = resolveResources(pageDict, parser);
  const fonts = resolveFonts(resources, parser);
  const contentStreams = getContentStreams(pageDict, parser);

  const includeInvisible = options?.includeInvisibleText ?? false;
  for (const streamData of contentStreams) {
    interpretContentStream(streamData, fonts, items, parser, resources, 0, undefined, includeInvisible);
  }

  return items;
}

function getContentStreams(pageDict: PdfDict, parser: PdfParser): Uint8Array[] {
  const contentsObj = dictGet(pageDict, 'Contents');
  if (!contentsObj) return [];

  const resolved = parser.resolve(contentsObj);

  if (isStream(resolved)) {
    return [parser.decodeStreamData(resolved)];
  }

  if (isArray(resolved)) {
    const streams: Uint8Array[] = [];
    for (const item of resolved.items) {
      const streamObj = parser.resolve(item);
      if (isStream(streamObj)) {
        streams.push(parser.decodeStreamData(streamObj));
      }
    }
    return streams;
  }

  return [];
}

function interpretContentStream(
  data: Uint8Array,
  fonts: Map<string, FontInfo>,
  items: TextItem[],
  parser: PdfParser,
  resources?: PdfDict | null,
  depth: number = 0,
  initialCtm?: number[],
  includeInvisibleText: boolean = false,
): void {
  if (depth > 10) return;

  const lexer = new PdfLexer(data);

  let textObjectId = 0;

  // Text state
  let currentFont: FontInfo | null = null;
  let fontSize = 0;
  let fontName = '';
  let charSpacing = 0;
  let wordSpacing = 0;
  let horizontalScaling = 100;
  let textLeading = 0;
  let textRise = 0;
  let textRenderMode = 0;

  let tm = [1, 0, 0, 1, 0, 0];
  let tlm = [1, 0, 0, 1, 0, 0];
  let ctm = initialCtm ? [...initialCtm] : [1, 0, 0, 1, 0, 0];

  function deviceCoords(): { x: number; y: number } {
    return {
      x: tm[4] * ctm[0] + tm[5] * ctm[2] + ctm[4],
      y: tm[4] * ctm[1] + tm[5] * ctm[3] + ctm[5],
    };
  }

  function emitTextRun(bytes: Uint8Array, font: FontInfo): void {
    if (textRenderMode === 3 && !includeInvisibleText) return;
    const text = decodeTextString(bytes, font);
    if (!text) return;
    const metrics = computeTextMetrics(bytes, font);
    const effectiveSize = fontSize * Math.abs(tm[3] || tm[0]);
    const pos = deviceCoords();
    items.push({
      text,
      x: pos.x,
      y: pos.y,
      fontSize: effectiveSize,
      fontName: font.baseFont,
      width: computeItemWidth(metrics.totalWidth, fontSize, tm),
      _textObjectId: textObjectId,
    });
    advancePosition(tm, metrics.totalWidth, metrics.charCount, metrics.spaceCount, fontSize, charSpacing, wordSpacing, horizontalScaling);
  }

  const stateStack: Array<{
    tm: number[]; tlm: number[];
    ctm: number[];
    font: FontInfo | null; fontSize: number; fontName: string;
    charSpacing: number; wordSpacing: number;
    horizontalScaling: number; textLeading: number; textRise: number;
    textRenderMode: number;
  }> = [];

  const operands: Operand[] = [];

  while (!lexer.atEnd) {
    const token = lexer.nextToken();

    if (token.type === TokenType.EOF) break;

    if (token.type === TokenType.Number) {
      operands.push({ type: 'number', value: token.value as number });
      continue;
    }
    if (token.type === TokenType.String || token.type === TokenType.HexString) {
      operands.push({ type: 'string', value: token.value as Uint8Array });
      continue;
    }
    if (token.type === TokenType.Name) {
      operands.push({ type: 'name', value: token.value as string });
      continue;
    }
    if (token.type === TokenType.ArrayStart) {
      operands.push({ type: 'array', value: collectArray(lexer) });
      continue;
    }
    if (token.type === TokenType.DictStart) {
      skipDict(lexer);
      operands.length = 0;
      continue;
    }
    if (token.type === TokenType.Bool || token.type === TokenType.Null) {
      operands.push({ type: 'other', value: token.value });
      continue;
    }

    if (token.type === TokenType.Keyword) {
      const op = token.value as string;

      switch (op) {
        case 'BT':
          textObjectId++;
          tm = [1, 0, 0, 1, 0, 0];
          tlm = [1, 0, 0, 1, 0, 0];
          break;

        case 'ET':
          break;

        case 'Tf': {
          const size = getNum(operands, operands.length - 1);
          const name = getName(operands, operands.length - 2);
          if (name !== null) {
            currentFont = fonts.get(name) ?? null;
            fontName = name;
          }
          if (size !== null) fontSize = size;
          break;
        }

        case 'Tc':
          charSpacing = getNum(operands, 0) ?? 0;
          break;

        case 'Tw':
          wordSpacing = getNum(operands, 0) ?? 0;
          break;

        case 'Tz':
          horizontalScaling = getNum(operands, 0) ?? 100;
          break;

        case 'TL':
          textLeading = getNum(operands, 0) ?? 0;
          break;

        case 'Ts':
          textRise = getNum(operands, 0) ?? 0;
          break;

        case 'Td': {
          const tx = getNum(operands, 0) ?? 0;
          const ty = getNum(operands, 1) ?? 0;
          tlm = multiplyMatrix([1, 0, 0, 1, tx, ty], tlm);
          tm = [...tlm];
          break;
        }

        case 'TD': {
          const tx = getNum(operands, 0) ?? 0;
          const ty = getNum(operands, 1) ?? 0;
          textLeading = -ty;
          tlm = multiplyMatrix([1, 0, 0, 1, tx, ty], tlm);
          tm = [...tlm];
          break;
        }

        case 'Tm': {
          const a = getNum(operands, 0) ?? 1;
          const b = getNum(operands, 1) ?? 0;
          const c = getNum(operands, 2) ?? 0;
          const d = getNum(operands, 3) ?? 1;
          const e = getNum(operands, 4) ?? 0;
          const f = getNum(operands, 5) ?? 0;
          tm = [a, b, c, d, e, f];
          tlm = [...tm];
          break;
        }

        case 'T*':
          tlm = multiplyMatrix([1, 0, 0, 1, 0, -textLeading], tlm);
          tm = [...tlm];
          break;

        case 'Tj': {
          const str = getStr(operands, 0);
          if (str && currentFont) {
            emitTextRun(str, currentFont);
          }
          break;
        }

        case 'TJ': {
          const arr = getArr(operands, 0);
          if (arr && currentFont) {
            for (const element of arr) {
              if (element.type === 'string') {
                emitTextRun(element.value, currentFont);
              } else if (element.type === 'number') {
                const displacement = element.value / 1000 * fontSize;
                tm[4] -= displacement * (horizontalScaling / 100);
              }
            }
          }
          break;
        }

        case '\'': {
          tlm = multiplyMatrix([1, 0, 0, 1, 0, -textLeading], tlm);
          tm = [...tlm];
          const str = getStr(operands, 0);
          if (str && currentFont) {
            emitTextRun(str, currentFont);
          }
          break;
        }

        case '"': {
          wordSpacing = getNum(operands, 0) ?? wordSpacing;
          charSpacing = getNum(operands, 1) ?? charSpacing;
          tlm = multiplyMatrix([1, 0, 0, 1, 0, -textLeading], tlm);
          tm = [...tlm];
          const str = getStr(operands, 2);
          if (str && currentFont) {
            emitTextRun(str, currentFont);
          }
          break;
        }

        case 'Tr':
          textRenderMode = getNum(operands, 0) ?? 0;
          break;

        case 'q':
          stateStack.push({
            tm: [...tm], tlm: [...tlm], ctm: [...ctm],
            font: currentFont, fontSize, fontName,
            charSpacing, wordSpacing, horizontalScaling, textLeading, textRise,
            textRenderMode,
          });
          break;

        case 'Q':
          if (stateStack.length > 0) {
            const state = stateStack.pop()!;
            tm = state.tm;
            tlm = state.tlm;
            ctm = state.ctm;
            currentFont = state.font;
            fontSize = state.fontSize;
            fontName = state.fontName;
            charSpacing = state.charSpacing;
            wordSpacing = state.wordSpacing;
            horizontalScaling = state.horizontalScaling;
            textLeading = state.textLeading;
            textRise = state.textRise;
            textRenderMode = state.textRenderMode;
          }
          break;

        case 'cm': {
          const a = getNum(operands, 0) ?? 1;
          const b = getNum(operands, 1) ?? 0;
          const c = getNum(operands, 2) ?? 0;
          const d = getNum(operands, 3) ?? 1;
          const e = getNum(operands, 4) ?? 0;
          const f = getNum(operands, 5) ?? 0;
          ctm = multiplyMatrix([a, b, c, d, e, f], ctm);
          break;
        }

        case 'Do': {
          const xobjName = getName(operands, 0);
          if (xobjName && resources) {
            handleFormXObject(xobjName, resources, fonts, items, parser, ctm, depth, includeInvisibleText);
          }
          break;
        }

        case 'BI':
          skipInlineImage(lexer);
          break;

        case 'gs': {
          const gsName = getName(operands, 0);
          if (gsName && resources) {
            applyExtGState(gsName, resources, parser, fonts, (f, s, n) => {
              currentFont = f;
              fontSize = s;
              fontName = n;
            });
          }
          break;
        }
      }

      operands.length = 0;
    }
  }
}

// ─── Form XObject ───

function handleFormXObject(
  name: string,
  resources: PdfDict,
  parentFonts: Map<string, FontInfo>,
  items: TextItem[],
  parser: PdfParser,
  ctm: number[],
  depth: number,
  includeInvisibleText: boolean = false,
): void {
  const xobjectDict = dictGet(resources, 'XObject');
  if (!xobjectDict) return;
  const resolvedXobjects = parser.resolveDict(xobjectDict);
  if (!resolvedXobjects) return;

  const xobjRef = dictGet(resolvedXobjects, name);
  if (!xobjRef) return;

  const xobj = parser.resolve(xobjRef);
  if (!isStream(xobj)) return;

  const subtype = dictGetName(xobj.dict, 'Subtype');
  if (subtype !== 'Form') return;

  const streamData = parser.decodeStreamData(xobj);
  const formResources = resolveFormResources(xobj.dict, resources, parser);
  const formFonts = resolveFormFonts(formResources, parentFonts, parser);

  const matrixArr = dictGetArray(xobj.dict, 'Matrix');
  let formMatrix = [1, 0, 0, 1, 0, 0];
  if (matrixArr && matrixArr.items.length >= 6) {
    formMatrix = matrixArr.items.map((item, i) => {
      const resolved = parser.resolve(item);
      return isNumber(resolved) ? resolved.value : (i === 0 || i === 3 ? 1 : 0);
    });
  }

  const combinedCtm = multiplyMatrix(formMatrix, ctm);
  interpretContentStream(streamData, formFonts, items, parser, formResources, depth + 1, combinedCtm, includeInvisibleText);
}

function resolveFormResources(
  formDict: PdfDict,
  parentResources: PdfDict,
  parser: PdfParser,
): PdfDict {
  const formRes = dictGet(formDict, 'Resources');
  if (formRes) {
    const resolved = parser.resolveDict(formRes);
    if (resolved) return resolved;
  }
  return parentResources;
}

function resolveFormFonts(
  formResources: PdfDict,
  parentFonts: Map<string, FontInfo>,
  parser: PdfParser,
): Map<string, FontInfo> {
  const fonts = new Map(parentFonts);

  const fontDict = dictGet(formResources, 'Font');
  if (!fontDict) return fonts;

  const resolvedFontDict = parser.resolveDict(fontDict);
  if (!resolvedFontDict) return fonts;

  for (const [name, fontRef] of resolvedFontDict.entries) {
    const fontObj = parser.resolveDict(fontRef);
    if (!fontObj) continue;
    fonts.set(name, buildFontInfo(fontObj, parser));
  }

  return fonts;
}

function applyExtGState(
  name: string,
  resources: PdfDict,
  parser: PdfParser,
  fonts: Map<string, FontInfo>,
  setFont: (font: FontInfo, size: number, name: string) => void,
): void {
  const extGStateDict = dictGet(resources, 'ExtGState');
  if (!extGStateDict) return;
  const resolved = parser.resolveDict(extGStateDict);
  if (!resolved) return;

  const gsRef = dictGet(resolved, name);
  if (!gsRef) return;
  const gs = parser.resolveDict(gsRef);
  if (!gs) return;

  // /Font entry: [fontRef size]
  const fontArr = dictGetArray(gs, 'Font');
  if (fontArr && fontArr.items.length >= 2) {
    const fontObj = parser.resolveDict(fontArr.items[0]);
    const sizeObj = parser.resolve(fontArr.items[1]);
    if (fontObj && isNumber(sizeObj)) {
      const fontInfo = buildFontInfo(fontObj, parser);
      const fontNameVal = dictGetName(fontObj, 'BaseFont') ?? name;
      fonts.set(name, fontInfo);
      setFont(fontInfo, sizeObj.value, name);
    }
  }
}

// ─── Helpers ───

function getNum(operands: Operand[], idx: number): number | null {
  if (idx < 0 || idx >= operands.length) return null;
  const op = operands[idx];
  return op.type === 'number' ? op.value : null;
}

function getName(operands: Operand[], idx: number): string | null {
  if (idx < 0 || idx >= operands.length) return null;
  const op = operands[idx];
  return op.type === 'name' ? op.value : null;
}

function getStr(operands: Operand[], idx: number): Uint8Array | null {
  if (idx < 0 || idx >= operands.length) return null;
  const op = operands[idx];
  return op.type === 'string' ? op.value : null;
}

function getArr(operands: Operand[], idx: number): Operand[] | null {
  if (idx < 0 || idx >= operands.length) return null;
  const op = operands[idx];
  return op.type === 'array' ? op.value : null;
}

function collectArray(lexer: PdfLexer): Operand[] {
  const items: Operand[] = [];

  while (!lexer.atEnd) {
    const token = lexer.nextToken();
    if (token.type === TokenType.ArrayEnd || token.type === TokenType.EOF) break;

    if (token.type === TokenType.Number) {
      items.push({ type: 'number', value: token.value as number });
    } else if (token.type === TokenType.String || token.type === TokenType.HexString) {
      items.push({ type: 'string', value: token.value as Uint8Array });
    } else if (token.type === TokenType.Name) {
      items.push({ type: 'name', value: token.value as string });
    } else if (token.type === TokenType.ArrayStart) {
      items.push({ type: 'array', value: collectArray(lexer) });
    }
  }

  return items;
}

function skipDict(lexer: PdfLexer): void {
  let depth = 1;
  while (!lexer.atEnd && depth > 0) {
    const token = lexer.nextToken();
    if (token.type === TokenType.DictStart) depth++;
    if (token.type === TokenType.DictEnd) depth--;
    if (token.type === TokenType.EOF) break;
  }
}

function skipInlineImage(lexer: PdfLexer): void {
  while (!lexer.atEnd) {
    const pos = lexer.findNext(EI_MARKER, lexer.position);
    if (pos === -1) break;

    const before = pos > 0 ? lexer.slice(pos - 1, pos)[0] : 0x20;
    const after = pos + 2 < lexer.length ? lexer.slice(pos + 2, pos + 3)[0] : 0x20;

    const isWsBefore = before === 0x20 || before === 0x0a || before === 0x0d || before === 0x09;
    const isWsAfter = after === 0x20 || after === 0x0a || after === 0x0d || after === 0x09 || (pos + 2 >= lexer.length);

    if (isWsBefore && isWsAfter) {
      lexer.position = pos + 2;
      return;
    }

    lexer.position = pos + 1;
  }
}
