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
  xGap: number,
  posGap: number,
  textLen: number,
  fontSize: number,
  hasMetricWidth: boolean,
): boolean {
  if (hasMetricWidth) {
    return xGap > fontSize * 0.15;
  }

  // No reliable width data -- use position-based estimate with average
  // proportional character width (~0.5em).
  const estimatedRunWidth = Math.max(textLen, 1) * fontSize * 0.5;
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
 */
export function sortTextItems(items: TextItem[]): TextItem[] {
  if (items.length === 0) return [];

  // Tag with original index to preserve stream order as a stable tiebreaker
  const tagged = items.map((item, i) => ({ item, i }));

  // Phase 1: rough Y-descending sort to enable line clustering
  tagged.sort((a, b) => (b.item.y || 0) - (a.item.y || 0));

  // Phase 2: cluster into lines by Y proximity
  const lines: (typeof tagged)[] = [];
  let currentLine = [tagged[0]];

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
    // Compute the leftmost X for each text object on this line
    const objMinX = new Map<number, number>();
    for (const entry of line) {
      const objId = entry.item._textObjectId;
      if (objId === undefined) continue;
      const existing = objMinX.get(objId);
      if (existing === undefined || entry.item.x < existing) {
        objMinX.set(objId, entry.item.x);
      }
    }

    line.sort((a, b) => {
      const objA = a.item._textObjectId;
      const objB = b.item._textObjectId;

      // Different text objects: order by the object's leftmost X on this line
      if (objA !== undefined && objB !== undefined && objA !== objB) {
        const minXA = objMinX.get(objA) ?? 0;
        const minXB = objMinX.get(objB) ?? 0;
        if (Math.abs(minXA - minXB) > 0.1) return minXA - minXB;
      }

      // Same text object: preserve content stream order
      if (objA !== undefined && objA === objB) {
        return a.i - b.i;
      }

      // Fallback (no text object ID): sort by X
      return (a.item.x || 0) - (b.item.x || 0);
    });
  }

  return lines.flat().map(e => e.item);
}

/**
 * Matches form anchor tags (DocuSign, IIO, etc.) in three forms:
 *  1. Self-closing: \signature1\, \POhere1\, \IIO_Finance_Contact_Name_1\
 *  2. Open tags with digit (value follows): \namehere1, \IIO_Finance_Contact_Name_1
 *  3. Orphaned closing delimiter: lone \ preceded by space, before whitespace/end
 */
const FORM_PLACEHOLDER_RE = /\\[a-zA-Z_]+\d*\\|\\[a-zA-Z_]+\d+| \\(?=[\s]|$)/g;

/** Strip DocuSign-style form anchor tags from a string */
export function stripFormPlaceholderText(text: string): string {
  return text.replace(FORM_PLACEHOLDER_RE, '');
}

export interface AssemblyOptions {
  stripFormPlaceholders?: boolean;
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

/**
 * Core iteration over sorted text items. Detects line breaks, paragraph breaks,
 * and word spacing, delegating output to a visitor. Both assembleText and
 * assembleStructuredItems share this loop.
 */
function walkItems(items: TextItem[], links: LinkAnnotation[], visitor: ItemVisitor): void {
  const sorted = sortTextItems(items);

  let lastX = 0;
  let lastY = sorted[0].y;
  let lastFontSize = sorted[0].fontSize || 12;
  let lastWidth = 0;
  let lastHasMetricWidth = false;
  let lastTextLen = 0;
  let hasContent = false;

  for (const item of sorted) {
    if (!item.text) continue;

    const yDelta = Math.abs(item.y - lastY);
    const lineThreshold = lastFontSize * 0.5;
    const itemLink = findLinkForItem(item, links);

    if (yDelta > lineThreshold && hasContent) {
      visitor.onLineBreak(item, yDelta > lastFontSize * 1.8);
    } else if (hasContent) {
      const xGap = item.x - (lastX + lastWidth);
      const posGap = item.x - lastX;
      if (xGap < -lastFontSize * 2 || shouldInsertSpace(xGap, posGap, lastTextLen, lastFontSize, lastHasMetricWidth)) {
        visitor.onSpace();
      }
    }

    visitor.onItem(item, itemLink);

    hasContent = true;
    lastX = item.x;
    lastY = item.y;
    lastFontSize = item.fontSize || lastFontSize;
    lastHasMetricWidth = (item.width ?? 0) > 0;
    lastWidth = item.width || (item.text.length * lastFontSize * 0.6);
    lastTextLen = item.text.length;
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
      currentLine += item.text;
    },
    onEnd() {
      if (currentLine) lines.push(currentLine);
    },
  });

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

  function appendToSpans(text: string, fontName: string, link?: string) {
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
  });

  if (options?.stripFormPlaceholders ?? true) {
    return result.map(line => {
      const text = line.text.replace(FORM_PLACEHOLDER_RE, '');
      const spans = line.spans.map(span => ({ ...span, text: span.text.replace(FORM_PLACEHOLDER_RE, '') }));
      return { ...line, text, spans };
    });
  }

  return result;
}

/** Clean up assembled text */
function cleanText(text: string, stripFormPlaceholders: boolean): string {
  let result = text;

  if (stripFormPlaceholders) {
    result = result.replace(FORM_PLACEHOLDER_RE, '');
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
