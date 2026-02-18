/**
 * Heuristic Table Detection
 *
 * Detects tables in PDF text by analyzing column alignment of text items.
 * Works for programmatic PDFs with clean text positioning.
 *
 * Algorithm:
 * 1. Group text items into rows by Y-coordinate
 * 2. For each row, identify column segments by X-position gaps
 * 3. Detect table regions: consecutive rows with the same number of columns
 *    and aligned X-positions
 * 4. Extract cell text into a 2D grid
 */

import type { TextItem } from '../types.js';
import { shouldInsertSpace, sortTextItems } from './assembler.js';

/** A detected table with rows and columns of text */
export interface TableBlock {
  /** 2D grid of cell text [row][col] */
  rows: string[][];
  /** Number of header rows (0 or 1) */
  headerRowCount: number;
  /** Y-coordinate of the first row (for ordering with other content) */
  yStart: number;
  /** Y-coordinate of the last row */
  yEnd: number;
}

interface RowSegment {
  x: number;
  width: number;
  text: string;
  fontSize: number;
  fontName: string;
}

interface Row {
  y: number;
  segments: RowSegment[];
}

const MIN_COLUMNS = 2;
const MIN_DATA_ROWS = 2;
const COLUMN_TOLERANCE_RATIO = 0.03; // 3% of page width

/**
 * Detect tables from positioned text items.
 * Returns table blocks and the Y-ranges they occupy so the markdown
 * renderer can skip those items in the normal line-by-line pass.
 */
export function detectTables(items: TextItem[], pageWidth = 612): TableBlock[] {
  if (items.length === 0) return [];

  const colTolerance = pageWidth * COLUMN_TOLERANCE_RATIO;

  // Step 1: Group items into rows by Y-coordinate
  const rows = groupIntoRows(items);
  if (rows.length < MIN_DATA_ROWS + 1) return [];

  // Step 2: For each row, split into column segments based on X-gaps
  const rowsWithSegments = rows.map(row => ({
    y: row.y,
    segments: splitIntoSegments(row.segments, row.segments[0]?.fontSize ?? 12),
  }));

  // Step 3: Find consecutive row runs with aligned columns
  const tables: TableBlock[] = [];
  let i = 0;

  while (i < rowsWithSegments.length) {
    const startRow = rowsWithSegments[i];
    const numCols = startRow.segments.length;

    if (numCols < MIN_COLUMNS) {
      i++;
      continue;
    }

    // Try to extend this into a table
    let endIdx = i + 1;
    while (endIdx < rowsWithSegments.length) {
      const candidate = rowsWithSegments[endIdx];
      if (candidate.segments.length !== numCols) break;
      if (!columnsAligned(startRow.segments, candidate.segments, colTolerance)) break;
      endIdx++;
    }

    const tableRowCount = endIdx - i;
    if (tableRowCount >= MIN_DATA_ROWS + 1) {
      // We have a table
      const tableRows = rowsWithSegments.slice(i, endIdx);
      const grid = tableRows.map(row =>
        row.segments.map(seg => seg.text.trim()),
      );

      // Header heuristic: first row is header if it uses bold font or different size
      const firstRow = tableRows[0];
      const secondRow = tableRows[1];
      const headerRowCount =
        firstRow.segments.some(s => /bold|semibold/i.test(s.fontName)) ||
        (secondRow && Math.abs(firstRow.segments[0].fontSize - secondRow.segments[0].fontSize) > 0.5)
          ? 1
          : 0;

      tables.push({
        rows: grid,
        headerRowCount,
        yStart: tableRows[0].y,
        yEnd: tableRows[tableRows.length - 1].y,
      });

      i = endIdx;
    } else {
      i++;
    }
  }

  return tables;
}

/**
 * Group text items into rows by Y-coordinate proximity.
 */
function groupIntoRows(items: TextItem[]): Row[] {
  // Sort with text-object-aware grouping to prevent character interleaving
  const sorted = sortTextItems(items);

  const rows: Row[] = [];
  let currentRow: RowSegment[] = [];
  let currentY = sorted[0]?.y ?? 0;
  const threshold = (sorted[0]?.fontSize ?? 12) * 0.5;

  for (const item of sorted) {
    if (!item.text) continue;

    if (Math.abs(item.y - currentY) > threshold && currentRow.length > 0) {
      rows.push({ y: currentY, segments: currentRow });
      currentRow = [];
      currentY = item.y;
    }

    currentRow.push({
      x: item.x,
      width: item.width,
      text: item.text,
      fontSize: item.fontSize,
      fontName: item.fontName,
    });
    currentY = item.y;
  }

  if (currentRow.length > 0) {
    rows.push({ y: currentY, segments: currentRow });
  }

  return rows;
}

/**
 * Split a row's segments into column groups based on X-position gaps.
 * Adjacent items with small gaps are merged into one segment.
 * Uses the same dual-threshold space detection as the main text assembler
 * to correctly handle per-character-positioned text.
 */
function splitIntoSegments(segments: RowSegment[], fontSize: number): RowSegment[] {
  if (segments.length === 0) return [];

  const spaceThreshold = fontSize * 1.5; // larger gap than word space = column boundary
  const result: RowSegment[] = [];
  let current = { ...segments[0] };
  let lastSegX = segments[0].x;
  let lastSegWidth = segments[0].width;
  let lastSegTextLen = segments[0].text.length;
  let lastHasMetricWidth = segments[0].width > 0;

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const xGap = seg.x - (lastSegX + lastSegWidth);
    const posGap = seg.x - lastSegX;

    if (xGap > spaceThreshold) {
      // Column boundary
      result.push(current);
      current = { ...seg };
    } else {
      // Same column -- use the assembler's dual-threshold space detection
      const needsSpace = shouldInsertSpace(
        xGap, posGap, lastSegTextLen, fontSize, lastHasMetricWidth,
      );
      const newWidth = (seg.x + seg.width) - current.x;
      current = {
        ...current,
        width: Math.max(current.width, newWidth),
        text: current.text + (needsSpace ? ' ' : '') + seg.text,
      };
    }

    lastSegX = seg.x;
    lastSegWidth = seg.width;
    lastSegTextLen = seg.text.length;
    lastHasMetricWidth = seg.width > 0;
  }

  result.push(current);
  return result;
}

/**
 * Check if two rows have aligned column X-positions.
 */
function columnsAligned(a: RowSegment[], b: RowSegment[], tolerance: number): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i].x - b[i].x) > tolerance) return false;
  }
  return true;
}

/**
 * Render a detected table as a markdown table string.
 */
export function renderTableAsMarkdown(table: TableBlock): string {
  if (table.rows.length === 0) return '';

  const numCols = table.rows[0].length;
  const lines: string[] = [];

  // Determine column widths for alignment
  const colWidths = new Array(numCols).fill(3);
  for (const row of table.rows) {
    for (let c = 0; c < numCols; c++) {
      const cell = row[c] ?? '';
      colWidths[c] = Math.max(colWidths[c], cell.length);
    }
  }

  function formatRow(cells: string[]): string {
    const padded = cells.map((cell, i) => (cell ?? '').padEnd(colWidths[i]));
    return `| ${padded.join(' | ')} |`;
  }

  // First row + separator (markdown requires a header separator row)
  lines.push(formatRow(table.rows[0]));
  lines.push(`| ${colWidths.map(w => '-'.repeat(w)).join(' | ')} |`);
  for (let r = 1; r < table.rows.length; r++) {
    lines.push(formatRow(table.rows[r]));
  }

  return lines.join('\n');
}
