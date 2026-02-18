/**
 * Markdown Output Generator
 *
 * Converts structured text items into markdown format by:
 * - Inferring heading levels from font size relative to the page's body text
 * - Detecting bold/italic from font style spans
 * - Detecting paragraphs from vertical spacing
 * - Detecting URLs and wrapping them as markdown links
 * - Preserving line breaks appropriately
 */

import type { StructuredLine } from './assembler.js';
import type { TextItem, TextSpan } from '../types.js';
import { detectTables, renderTableAsMarkdown, type TableBlock } from './tables.js';

/**
 * Convert structured lines to markdown, with optional table detection.
 */
export function toMarkdown(lines: StructuredLine[], textItems?: TextItem[]): string {
  if (lines.length === 0) return '';

  // Detect tables from raw text items if available
  const tables = textItems ? detectTables(textItems) : [];
  const tableYRanges = tables.map(t => ({ yStart: t.yStart, yEnd: t.yEnd, table: t }));

  const bodyFontSize = detectBodyFontSize(lines);
  const result: string[] = [];

  // Track which tables have been rendered (by index)
  const renderedTables = new Set<number>();

  for (const line of lines) {
    const trimmed = line.text.trim();
    if (!trimmed) continue;

    // Check if this line falls within a table region
    const tableIdx = tableYRanges.findIndex(
      tr => line.y <= tr.yStart + 1 && line.y >= tr.yEnd - 1,
    );

    if (tableIdx >= 0 && !renderedTables.has(tableIdx)) {
      // Render the table and mark it as done
      renderedTables.add(tableIdx);
      if (result.length > 0 && result[result.length - 1] !== '') {
        result.push('');
      }
      result.push(renderTableAsMarkdown(tableYRanges[tableIdx].table));
      result.push('');
      continue;
    } else if (tableIdx >= 0) {
      // Already rendered this table -- skip remaining lines in its region
      continue;
    }

    const headingLevel = inferHeadingLevel(line.fontSize, bodyFontSize);

    if (headingLevel > 0 && headingLevel <= 6 && isLikelyHeading(trimmed)) {
      if (result.length > 0 && result[result.length - 1] !== '') {
        result.push('');
      }
      result.push(`${'#'.repeat(headingLevel)} ${trimmed}`);
      result.push('');
    } else if (isLikelyListItem(trimmed)) {
      result.push(formatListItem(renderSpans(line.spans)));
      if (line.isBlankAfter) result.push('');
    } else {
      result.push(renderSpans(line.spans));
      if (line.isBlankAfter) result.push('');
    }
  }

  return cleanMarkdown(result.join('\n'));
}

/**
 * Render text spans with inline markdown formatting (bold, italic, links).
 */
function renderSpans(spans: TextSpan[]): string {
  if (!spans || spans.length === 0) return '';

  // Check if ALL spans have the same style (avoid wrapping entire line)
  const allBold = spans.every(s => s.bold);
  const allItalic = spans.every(s => s.italic);
  const hasAnyFormatting = spans.some(s => s.bold || s.italic || s.link);

  if (!hasAnyFormatting) {
    // No formatting -- apply URL detection on plain text
    return autoLinkUrls(spans.map(s => s.text).join('').trim());
  }

  let out = '';
  for (const span of spans) {
    let text = span.text;
    if (!text) continue;

    // Wrap links
    if (span.link) {
      const linkText = text.trim();
      if (linkText) {
        text = `[${linkText}](${span.link})`;
        // Add surrounding whitespace back
        if (span.text.startsWith(' ')) text = ' ' + text;
        if (span.text.endsWith(' ')) text = text + ' ';
      }
    }

    // Apply bold/italic only if not uniform across all spans
    if (span.bold && !allBold) {
      text = wrapInline(text, '**');
    }
    if (span.italic && !allItalic) {
      text = wrapInline(text, '*');
    }
  
    out += text;
  }

  const trimmed = out.trim();

  // If the entire line is bold or italic (uniform), wrap the whole thing
  if (allBold && allItalic) return `***${trimmed}***`;
  if (allBold) return `**${trimmed}**`;
  if (allItalic) return `*${trimmed}*`;

  // Apply URL auto-detection on sections without explicit links
  if (!spans.some(s => s.link)) {
    return autoLinkUrls(trimmed);
  }

  return trimmed;
}

/**
 * Wrap inline text with a marker (** or *), preserving leading/trailing spaces.
 */
function wrapInline(text: string, marker: string): string {
  const leading = text.match(/^(\s*)/)?.[1] ?? '';
  const trailing = text.match(/(\s*)$/)?.[1] ?? '';
  const inner = text.trim();
  if (!inner) return text;
  return `${leading}${marker}${inner}${marker}${trailing}`;
}

/**
 * Auto-detect URLs in plain text and wrap them as markdown links.
 */
function autoLinkUrls(text: string): string {
  return text.replace(
    /https?:\/\/[^\s),\]]+/g,
    (url) => `[${url}](${url})`,
  );
}

/**
 * Detect the most common (body) font size from a set of lines.
 */
function detectBodyFontSize(lines: StructuredLine[]): number {
  const sizeCounts = new Map<number, number>();

  for (const line of lines) {
    const trimmed = line.text.trim();
    if (!trimmed) continue;

    const rounded = Math.round(line.fontSize * 2) / 2;
    const textLen = trimmed.length;
    sizeCounts.set(rounded, (sizeCounts.get(rounded) ?? 0) + textLen);
  }

  let maxCount = 0;
  let bodySize = 12;
  for (const [size, count] of sizeCounts) {
    if (count > maxCount) {
      maxCount = count;
      bodySize = size;
    }
  }

  return bodySize;
}

/**
 * Infer heading level based on font size ratio to body text.
 */
function inferHeadingLevel(fontSize: number, bodyFontSize: number): number {
  if (bodyFontSize <= 0) return 0;

  const ratio = fontSize / bodyFontSize;

  if (ratio >= 2.0) return 1;
  if (ratio >= 1.6) return 2;
  if (ratio >= 1.3) return 3;
  if (ratio >= 1.15) return 4;

  return 0;
}

/**
 * Heuristic: a line is likely a heading if it's short and doesn't end with
 * sentence-ending punctuation.
 */
function isLikelyHeading(text: string): boolean {
  if (text.length > 200) return false;
  if (text.endsWith(',') || text.endsWith(';')) return false;
  return true;
}

/**
 * Detect list items (bullet points, numbered lists).
 */
function isLikelyListItem(text: string): boolean {
  return /^[\u2022\u2023\u25E6\u2043\u2219•\-\*]\s/.test(text) ||
         /^\d{1,3}[.)]\s/.test(text) ||
         /^[a-z][.)]\s/i.test(text);
}

/**
 * Format a detected list item with markdown bullet syntax.
 */
function formatListItem(text: string): string {
  if (/^[\-\*]\s/.test(text)) return text;

  if (/^[\u2022\u2023\u25E6\u2043\u2219•]\s/.test(text)) {
    return `- ${text.substring(2)}`;
  }

  if (/^\d{1,3}\.\s/.test(text)) return text;

  const numberedMatch = text.match(/^(\d{1,3})\)\s(.*)/);
  if (numberedMatch) {
    return `${numberedMatch[1]}. ${numberedMatch[2]}`;
  }

  return text;
}

function cleanMarkdown(text: string): string {
  return text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ +\n/g, '\n')
    .trim();
}
