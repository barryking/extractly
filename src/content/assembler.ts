/**
 * Text Assembler
 *
 * Takes an array of positioned TextItems and reconstructs readable text.
 * Handles:
 * - Line break detection via Y-coordinate changes
 * - Space insertion via X-coordinate gaps
 * - Reading order (top-to-bottom, left-to-right)
 * - Paragraph detection via larger Y gaps
 */

import type { TextItem, TextSpan } from '../types.js';
import type { LinkAnnotation } from './links.js';
import { detectFontStyle } from './font-style.js';

type TextMode = 'clean' | 'layout';

interface SpacingContext {
  prev: TextItem;
  curr: TextItem;
  xGap: number;
  posGap: number;
  fontSize: number;
}

interface BoundaryInfo {
  prevBoundary: string;
  currBoundary: string;
  alnumBoundary: boolean;
}

/**
 * Detect whether a gap between two consecutive same-line items represents a
 * word boundary (space).
 *
 * When width data is available from font metrics, xGap (the gap between the
 * end of the previous run and the start of this one) is reliable. A gap larger
 * than ~15% of the font size indicates a word boundary.
 *
 * When width data is missing (lastWidth derived from the fallback estimate),
 * we use posGap (distance from previous start to current start) against an
 * average proportional-font character width to avoid spurious spaces.
 */
export function shouldInsertSpace(
  { prev, curr, xGap, posGap, fontSize }: SpacingContext,
  textMode: TextMode = 'clean',
): boolean {
  const prevText = prev.text;
  const currText = curr.text;

  if (/\s$/.test(prevText) || /^\s/.test(currText)) {
    return false;
  }

  const { alnumBoundary } = getBoundaryInfo(prevText, currText);

  const prevChars = Math.max(prevText.replace(/\s/g, '').length, 1);
  const currChars = Math.max(currText.replace(/\s/g, '').length, 1);
  const prevAvgCharWidth = prev.width > 0 ? prev.width / prevChars : 0;
  const currAvgCharWidth = curr.width > 0 ? curr.width / currChars : 0;
  const avgGlyph = prevAvgCharWidth > 0 && currAvgCharWidth > 0
    ? Math.min(prevAvgCharWidth, currAvgCharWidth)
    : 0;
  const hasMetricWidth = prev.width > 0 && curr.width > 0;

  if (hasMetricWidth) {
    if (textMode === 'clean' && alnumBoundary) {
      return xGap > Math.max(fontSize * 0.35, avgGlyph * 0.6);
    }
    return xGap > fontSize * 0.15;
  }

  const multiplier = textMode === 'clean' && alnumBoundary ? 0.7 : 0.5;
  const estimatedRunWidth = Math.max(prevChars, 1) * fontSize * multiplier;
  return posGap > estimatedRunWidth;
}

/**
 * Sort text items with text-object-aware grouping to prevent character-level
 * interleaving when multiple BT/ET text objects place characters at
 * overlapping X positions (common in DocuSign, Adobe forms, OCR PDFs).
 *
 * Within each Y line, items from the same text object are kept together
 * (sorted by stream order), and text object groups are ordered by their
 * leftmost X on that line. This prevents cross-object character interleaving
 * while preserving individual items for link/style detection.
 *
 * Multi-column regions (e.g. side-by-side signature blocks) are detected
 * and reordered to read column-first instead of row-first, so related
 * data stays together in the output stream.
 */
export function sortTextItems(items: TextItem[]): TextItem[] {
  if (items.length === 0) return [];

  type TaggedEntry = { item: TextItem; i: number };

  // Tag with original index to preserve stream order as a stable tiebreaker
  const tagged: TaggedEntry[] = items.map((item, i) => ({ item, i }));

  // Phase 1: rough Y-descending sort to enable line clustering
  tagged.sort((a, b) => (b.item.y || 0) - (a.item.y || 0));

  // Phase 2: cluster into lines by Y proximity
  const lines: TaggedEntry[][] = [];
  let currentLine: TaggedEntry[] = [tagged[0]];

  for (let i = 1; i < tagged.length; i++) {
    const prev = currentLine[currentLine.length - 1];
    const yDelta = Math.abs(tagged[i].item.y - prev.item.y);
    const threshold = (prev.item.fontSize > 0 ? prev.item.fontSize : 12) * 0.5;

    if (yDelta > threshold) {
      lines.push(currentLine);
      currentLine = [];
    }
    currentLine.push(tagged[i]);
  }
  if (currentLine.length > 0) lines.push(currentLine);

  // Phase 3: within each line, sort by text-object representative X,
  // then by stream order within each text object
  for (const line of lines) {
    const objMinX = new Map<number, number>();
    const objMaxX = new Map<number, number>();
    const objStartIndex = new Map<number, number>();
    for (const entry of line) {
      const objId = entry.item._textObjectId;
      if (objId === undefined) continue;
      const existing = objMinX.get(objId);
      if (existing === undefined || entry.item.x < existing) {
        objMinX.set(objId, entry.item.x);
      }
      const rightEdge = itemRightEdge(entry);
      const existingMax = objMaxX.get(objId);
      if (existingMax === undefined || rightEdge > existingMax) {
        objMaxX.set(objId, rightEdge);
      }
      const existingIndex = objStartIndex.get(objId);
      if (existingIndex === undefined || entry.i < existingIndex) {
        objStartIndex.set(objId, entry.i);
      }
    }

    line.sort((a, b) => {
      const objA = a.item._textObjectId;
      const objB = b.item._textObjectId;

      if (objA !== undefined && objB !== undefined && objA !== objB) {
        const minXA = objMinX.get(objA) ?? 0;
        const minXB = objMinX.get(objB) ?? 0;
        const maxXA = objMaxX.get(objA) ?? minXA;
        const maxXB = objMaxX.get(objB) ?? minXB;
        const overlap = Math.min(maxXA, maxXB) - Math.max(minXA, minXB);
        if (overlap > 1) {
          return (objStartIndex.get(objA) ?? a.i) - (objStartIndex.get(objB) ?? b.i);
        }
        if (Math.abs(minXA - minXB) > 0.1) return minXA - minXB;
      }

      if (objA !== undefined && objA === objB) {
        return a.i - b.i;
      }

      return (a.item.x || 0) - (b.item.x || 0);
    });
  }

  // Phase 4: detect multi-column regions and reorder for column-first reading
  const reordered = reorderColumnRegions(lines);

  return reordered.flat().map(e => e.item);
}

// ---------------------------------------------------------------------------
// Column-aware text flow
//
// Detects side-by-side column regions (e.g. signature blocks) by finding
// runs of consecutive Y-lines that share a large X-gap at a consistent
// position, then reorders items within those regions so the left column
// is emitted first (top-to-bottom), followed by the right column.
// This prevents interleaving of unrelated data from adjacent columns.
// ---------------------------------------------------------------------------

type TaggedEntry = { item: TextItem; i: number };

const MIN_COLUMN_RUN = 3;
const COLUMN_GAP_FACTOR = 3;
const MAX_GAPLESS_BRIDGE = 3;

interface GapInfo {
  /** X where the right column starts (first item after the dominant gap) */
  rightX: number;
  fontSize: number;
}

function itemRightEdge(entry: TaggedEntry): number {
  const it = entry.item;
  return it.x + (it.width || it.text.length * (it.fontSize || 12) * 0.6);
}

function lineIsOneSide(line: TaggedEntry[], boundary: number): boolean {
  return (
    line.every(e => itemRightEdge(e) < boundary) ||
    line.every(e => e.item.x >= boundary)
  );
}

function findDominantColumnGap(line: TaggedEntry[]): GapInfo | null {
  if (line.length < 2) return null;

  const fontSize = line[0].item.fontSize || 12;
  const minGap = fontSize * COLUMN_GAP_FACTOR;
  let maxGap = 0;
  let maxGapRightX = 0;

  for (let j = 1; j < line.length; j++) {
    const prev = line[j - 1].item;
    const curr = line[j].item;
    const prevEnd = prev.x + (prev.width || prev.text.length * (prev.fontSize || 12) * 0.6);
    const gap = curr.x - prevEnd;

    if (gap > minGap && gap > maxGap) {
      maxGap = gap;
      maxGapRightX = curr.x;
    }
  }

  return maxGap > 0 ? { rightX: maxGapRightX, fontSize } : null;
}

interface ColumnRegion {
  start: number;
  end: number;
  boundaryX: number;
}

function detectColumnRegions(lines: TaggedEntry[][]): ColumnRegion[] {
  const gaps = lines.map(findDominantColumnGap);
  const regions: ColumnRegion[] = [];
  let i = 0;

  while (i < gaps.length) {
    if (!gaps[i]) { i++; continue; }

    const anchor = gaps[i]!;
    const tolerance = anchor.fontSize * 3;
    let sumRX = anchor.rightX;
    let count = 1;
    let j = i + 1;

    let gaplessRun = 0;

    while (j < gaps.length) {
      const g = gaps[j];

      if (g) {
        if (Math.abs(g.rightX - sumRX / count) > tolerance) break;
        sumRX += g.rightX;
        count++;
        gaplessRun = 0;
      } else {
        if (gaplessRun >= MAX_GAPLESS_BRIDGE) break;
        const yGap = Math.abs(lines[j][0].item.y - lines[j - 1][0].item.y);
        const fs = lines[j - 1][0].item.fontSize || 12;
        if (yGap > fs * 2.5) break;
        if (!lineIsOneSide(lines[j], sumRX / count)) break;
        gaplessRun++;
      }

      j++;
    }

    if (count >= MIN_COLUMN_RUN) {
      const boundaryX = sumRX / count;
      const minStart = regions.length > 0 ? regions[regions.length - 1].end : 0;

      // Extend backward: absorb preceding lines with consistent gaps
      // or single-column lines (catches headers above a detected run)
      let start = i;
      let backGapless = 0;
      while (start > minStart) {
        const prev = gaps[start - 1];
        if (prev) {
          if (Math.abs(prev.rightX - boundaryX) > tolerance) break;
          backGapless = 0;
        } else {
          if (backGapless >= MAX_GAPLESS_BRIDGE) break;
          if (!lineIsOneSide(lines[start - 1], boundaryX)) break;
          backGapless++;
        }
        start--;
      }

      regions.push({ start, end: j, boundaryX });
    }

    i = count >= MIN_COLUMN_RUN ? j : i + 1;
  }

  return regions;
}

function reorderColumnRegions(lines: TaggedEntry[][]): TaggedEntry[][] {
  const regions = detectColumnRegions(lines);
  if (regions.length === 0) return lines;

  const result: TaggedEntry[][] = [];
  let lineIdx = 0;

  for (const region of regions) {
    while (lineIdx < region.start) {
      result.push(lines[lineIdx++]);
    }

    const left: TaggedEntry[][] = [];
    const right: TaggedEntry[][] = [];

    for (let j = region.start; j < region.end; j++) {
      const l: TaggedEntry[] = [];
      const r: TaggedEntry[] = [];

      // Use this line's own gap to split (more accurate than region boundary
      // when left-column content varies in width across rows)
      const lineGap = findDominantColumnGap(lines[j]);
      const splitX = lineGap ? lineGap.rightX : region.boundaryX;

      for (const entry of lines[j]) {
        if (entry.item.x < splitX) {
          l.push(entry);
        } else {
          r.push(entry);
        }
      }

      if (l.length > 0) left.push(l);
      if (r.length > 0) right.push(r);
    }

    result.push(...left, ...right);
    lineIdx = region.end;
  }

  while (lineIdx < lines.length) {
    result.push(lines[lineIdx++]);
  }

  return result;
}

/**
 * Matches form anchor tags (DocuSign, IIO, etc.) in three forms:
 *  1. Self-closing: \signature1\, \POhere1\, \IIO_Finance_Contact_Name_1\
 *  2. Open tags with digit (value follows): \namehere1, \IIO_Finance_Contact_Name_1
 *     Lookahead allows whitespace, backslash, letters, or end-of-string after
 *     the digit suffix. Letters indicate the start of real content (e.g. N/A).
 *     Digits are NOT allowed in the lookahead to prevent consuming content
 *     digits (e.g. \date14/1/2025 where "4" belongs to the date).
 *  3. Orphaned closing delimiter: lone \ preceded by space, before whitespace/end
 */
const FORM_PLACEHOLDER_RE = /\\[a-zA-Z_]+\d*\\|\\[a-zA-Z_]+\d+(?=[\s\\a-zA-Z]|$)| \\(?=[\s]|$)/g;

/**
 * Matches a lone trailing backslash (DocuSign field boundary marker).
 * These appear as `Rivera\` or `incident.io\` at end of words.
 */
const TRAILING_BACKSLASH_RE = /\\(?=\s|$)/g;

/**
 * Check if an entire text string is a form placeholder anchor.
 * Used for item-level filtering before assembly/table detection.
 */
export function isFormPlaceholderItem(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('\\')) return false;
  return /^\\[a-zA-Z_]+\d*\\?$/.test(trimmed);
}

/** Strip DocuSign-style form anchor tags and trailing backslash artifacts from a string */
export function stripFormPlaceholderText(text: string): string {
  return text
    .replace(FORM_PLACEHOLDER_RE, '')
    .replace(TRAILING_BACKSLASH_RE, '');
}

/**
 * Well-known Microsoft Symbol / Wingdings Private Use Area (PUA) codepoints
 * mapped to their standard Unicode equivalents.
 * These appear in PDFs using SymbolMT, Wingdings, ZapfDingbats, etc.
 */
const PUA_TO_UNICODE: Record<number, number> = {
  0xF020: 0x0020, // space
  0xF02D: 0x2212, // minus sign
  0xF06C: 0x2113, // script small l
  0xF06E: 0x25CF, // black circle (Wingdings bullet)
  0xF0A0: 0x20AC, // euro sign
  0xF0A7: 0x00A7, // section sign
  0xF0A8: 0x2190, // leftwards arrow
  0xF0A9: 0x2191, // upwards arrow
  0xF0AA: 0x2192, // rightwards arrow
  0xF0AB: 0x2193, // downwards arrow
  0xF0AC: 0x2194, // left right arrow
  0xF0B0: 0x00B0, // degree sign
  0xF0B1: 0x00B1, // plus-minus sign
  0xF0B2: 0x2033, // double prime
  0xF0B3: 0x2265, // greater-than or equal to
  0xF0B4: 0x00D7, // multiplication sign
  0xF0B5: 0x221D, // proportional to
  0xF0B7: 0x2022, // bullet
  0xF0B9: 0x2260, // not equal to
  0xF0BA: 0x2261, // identical to
  0xF0BB: 0x2248, // almost equal to
  0xF0D8: 0x00D8, // Latin capital letter O with stroke (empty set)
  0xF0E0: 0x21D0, // leftwards double arrow
  0xF0E1: 0x21D1, // upwards double arrow
  0xF0E2: 0x21D2, // rightwards double arrow (implies)
  0xF0E3: 0x21D3, // downwards double arrow
  0xF0E4: 0x21D4, // left right double arrow
};

/** PUA range: U+E000..U+F8FF */
const PUA_RE = /[\uE000-\uF8FF]/g;

/**
 * Normalize Private Use Area characters to standard Unicode equivalents.
 * Known Symbol/Wingdings PUA codepoints are mapped; unknown PUA chars are stripped.
 */
export function normalizePUA(text: string): string {
  if (!PUA_RE.test(text)) return text;
  PUA_RE.lastIndex = 0;
  return text.replace(PUA_RE, (ch) => {
    const mapped = PUA_TO_UNICODE[ch.charCodeAt(0)];
    return mapped !== undefined ? String.fromCodePoint(mapped) : '';
  });
}

export interface AssemblyOptions {
  stripFormPlaceholders?: boolean;
  textMode?: TextMode;
}

export interface StructuredLine {
  text: string;
  spans: TextSpan[];
  fontSize: number;
  y: number;
  isBlankAfter: boolean;
}

/**
 * Find the URI of a link annotation that overlaps a text item's position.
 */
function findLinkForItem(item: TextItem, links: LinkAnnotation[]): string | undefined {
  if (links.length === 0) return undefined;

  const itemCenterX = item.x + (item.width || 0) / 2;
  const itemY = item.y;

  for (const link of links) {
    if (
      itemCenterX >= link.x1 && itemCenterX <= link.x2 &&
      itemY >= link.y1 && itemY <= link.y2
    ) {
      return link.uri;
    }
  }
  return undefined;
}

interface ItemVisitor {
  onLineBreak(item: TextItem, isParagraphBreak: boolean): void;
  onSpace(): void;
  onItem(item: TextItem, link?: string): void;
  onEnd(): void;
}

function isLayoutArtifact(item: TextItem): boolean {
  return item.text.trim() === '' && item.width <= 1 && item.fontSize <= 1.5;
}

function getBoundaryInfo(prevText: string, currText: string): BoundaryInfo {
  const prevTrimmed = prevText.trimEnd();
  const currTrimmed = currText.trimStart();
  const prevBoundary = prevTrimmed[prevTrimmed.length - 1] ?? '';
  const currBoundary = currTrimmed[0] ?? '';
  return {
    prevBoundary,
    currBoundary,
    alnumBoundary: /[\p{L}\p{N}]/u.test(prevBoundary) && /[\p{L}\p{N}]/u.test(currBoundary),
  };
}

function shouldJoinBackwardOverlap(prev: TextItem, curr: TextItem, textMode: TextMode): boolean {
  if (textMode !== 'clean') return false;

  const { prevBoundary, currBoundary, alnumBoundary } = getBoundaryInfo(prev.text, curr.text);
  if (alnumBoundary) return true;

  const prevIsWord = /[\p{L}\p{N}]/u.test(prevBoundary);
  const currIsWord = /[\p{L}\p{N}]/u.test(currBoundary);
  if (prevIsWord && /[-–—]/.test(currBoundary)) return true;
  if (/[-–—'’]/.test(prevBoundary) && currIsWord) return true;

  return false;
}

/**
 * Core iteration over sorted text items. Detects line breaks, paragraph breaks,
 * and word spacing, delegating output to a visitor. Both assembleText and
 * assembleStructuredItems share this loop.
 */
function walkItems(
  items: TextItem[],
  links: LinkAnnotation[],
  visitor: ItemVisitor,
  options?: AssemblyOptions,
): void {
  const sorted = sortTextItems(items);
  const textMode = options?.textMode ?? 'clean';

  let lastX = 0;
  let lastY = 0;
  let lastFontSize = 12;
  let lastWidth = 0;
  let lastItem: TextItem | null = null;
  let hasContent = false;

  for (const item of sorted) {
    if (!item.text) continue;
    if (isLayoutArtifact(item)) continue;

    const itemLink = findLinkForItem(item, links);

    if (!hasContent) {
      visitor.onItem(item, itemLink);
      hasContent = true;
      lastX = item.x;
      lastY = item.y;
      lastFontSize = item.fontSize || lastFontSize;
      lastWidth = item.width || (item.text.length * lastFontSize * 0.6);
      lastItem = item;
      continue;
    }

    const yDelta = Math.abs(item.y - lastY);
    const lineThreshold = lastFontSize * 0.5;

    if (yDelta > lineThreshold) {
      visitor.onLineBreak(item, yDelta > lastFontSize * 1.8);
    } else if (lastItem) {
      const xGap = item.x - (lastX + lastWidth);
      const posGap = item.x - lastX;
      const backwardOverlap = xGap < -lastFontSize * 2;
      if (
        (backwardOverlap && !shouldJoinBackwardOverlap(lastItem, item, textMode)) ||
        (!backwardOverlap &&
        shouldInsertSpace({ prev: lastItem, curr: item, xGap, posGap, fontSize: lastFontSize }, textMode)
        )
      ) {
        visitor.onSpace();
      }
    }

    visitor.onItem(item, itemLink);

    lastX = item.x;
    lastY = item.y;
    lastFontSize = item.fontSize || lastFontSize;
    lastWidth = item.width || (item.text.length * lastFontSize * 0.6);
    lastItem = item;
  }

  visitor.onEnd();
}

/** Assemble text items into plain text for a single page */
export function assembleText(items: TextItem[], options?: AssemblyOptions): string {
  if (items.length === 0) return '';

  const lines: string[] = [];
  let currentLine = '';

  walkItems(items, [], {
    onLineBreak(_item, isParagraphBreak) {
      if (currentLine) lines.push(currentLine);
      if (isParagraphBreak) lines.push('');
      currentLine = '';
    },
    onSpace() {
      currentLine += ' ';
    },
    onItem(item) {
      currentLine += normalizePUA(item.text);
    },
    onEnd() {
      if (currentLine) lines.push(currentLine);
    },
  }, options);

  return cleanText(lines.join('\n'), options?.stripFormPlaceholders ?? true);
}

/** Assemble text items into structured data for markdown conversion */
export function assembleStructuredItems(items: TextItem[], links: LinkAnnotation[] = [], options?: AssemblyOptions): StructuredLine[] {
  if (items.length === 0) return [];

  const result: StructuredLine[] = [];
  let currentSpans: TextSpan[] = [];
  let currentText = '';
  let currentFontSize = 0;
  let currentY = 0;

  function pushLine(isBlankAfter: boolean) {
    if (currentText) {
      result.push({ text: currentText, spans: currentSpans, fontSize: currentFontSize, y: currentY, isBlankAfter });
    }
    currentSpans = [];
    currentText = '';
  }

  function appendToSpans(rawText: string, fontName: string, link?: string) {
    const text = normalizePUA(rawText);
    const style = detectFontStyle(fontName);
    const last = currentSpans[currentSpans.length - 1];

    if (last && last.bold === style.bold && last.italic === style.italic && last.link === link) {
      currentSpans[currentSpans.length - 1] = {
        text: last.text + text, bold: last.bold, italic: last.italic, link: last.link,
      };
    } else {
      currentSpans.push({ text, bold: style.bold, italic: style.italic, ...(link ? { link } : {}) });
    }
    currentText += text;
  }

  walkItems(items, links, {
    onLineBreak(_item, isParagraphBreak) {
      pushLine(isParagraphBreak);
    },
    onSpace() {
      const last = currentSpans[currentSpans.length - 1];
      if (last) {
        currentSpans[currentSpans.length - 1] = { ...last, text: last.text + ' ' };
        currentText += ' ';
      }
    },
    onItem(item, link) {
      if (!currentText) {
        currentFontSize = item.fontSize;
        currentY = item.y;
      }
      appendToSpans(item.text, item.fontName, link);
      currentFontSize = Math.max(currentFontSize, item.fontSize);
    },
    onEnd() {
      pushLine(false);
    },
  }, options);

  if (options?.stripFormPlaceholders ?? true) {
    return result.map(line => {
      const text = line.text
        .replace(FORM_PLACEHOLDER_RE, '')
        .replace(TRAILING_BACKSLASH_RE, '');
      const spans = line.spans.map(span => ({
        ...span,
        text: span.text
          .replace(FORM_PLACEHOLDER_RE, '')
          .replace(TRAILING_BACKSLASH_RE, ''),
      }));
      return { ...line, text, spans };
    });
  }

  return result;
}

/** Clean up assembled text */
function cleanText(text: string, stripFormPlaceholders: boolean): string {
  let result = text;

  if (stripFormPlaceholders) {
    result = result
      .replace(FORM_PLACEHOLDER_RE, '')
      .replace(TRAILING_BACKSLASH_RE, '');
  }

  return result
    // Normalize whitespace within lines
    .replace(/[^\S\n]+/g, ' ')
    // Remove trailing spaces on lines
    .replace(/ +\n/g, '\n')
    // Collapse more than 2 consecutive newlines
    .replace(/\n{3,}/g, '\n\n')
    // Trim
    .trim();
}
