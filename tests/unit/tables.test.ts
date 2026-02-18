import { describe, it, expect } from 'vitest';
import { detectTables, renderTableAsMarkdown } from '../../src/content/tables.js';
import type { TextItem } from '../../src/types.js';

function item(text: string, x: number, y: number, fontSize = 12, fontName = 'Helvetica'): TextItem {
  return { text, x, y, fontSize, fontName, width: text.length * fontSize * 0.6 };
}

describe('detectTables', () => {
  it('detects a simple 3-column table', () => {
    const items: TextItem[] = [
      // Header row
      item('Name', 72, 720, 12, 'Helvetica-Bold'),
      item('Price', 250, 720, 12, 'Helvetica-Bold'),
      item('Qty', 400, 720, 12, 'Helvetica-Bold'),
      // Row 1
      item('Widget', 72, 705),
      item('$10', 250, 705),
      item('5', 400, 705),
      // Row 2
      item('Gadget', 72, 690),
      item('$25', 250, 690),
      item('12', 400, 690),
    ];

    const tables = detectTables(items);
    expect(tables).toHaveLength(1);
    expect(tables[0].rows).toHaveLength(3);
    expect(tables[0].rows[0]).toEqual(['Name', 'Price', 'Qty']);
    expect(tables[0].rows[1]).toEqual(['Widget', '$10', '5']);
  });

  it('returns empty for non-tabular content', () => {
    const items: TextItem[] = [
      item('Hello world', 72, 700),
      item('Another line', 72, 680),
      item('Yet another', 72, 660),
    ];

    const tables = detectTables(items);
    expect(tables).toHaveLength(0);
  });

  it('does not detect a table with only 2 rows', () => {
    const items: TextItem[] = [
      item('A', 72, 720), item('B', 250, 720),
      item('1', 72, 705), item('2', 250, 705),
    ];

    const tables = detectTables(items);
    expect(tables).toHaveLength(0);
  });
});

describe('renderTableAsMarkdown', () => {
  it('renders a table with header', () => {
    const md = renderTableAsMarkdown({
      rows: [['Name', 'Price'], ['Widget', '$10'], ['Gadget', '$25']],
      headerRowCount: 1,
      yStart: 720,
      yEnd: 690,
    });

    expect(md).toContain('| Name');
    expect(md).toContain('| ---');
    expect(md).toContain('| Widget');
    const lines = md.split('\n');
    expect(lines).toHaveLength(4); // header + separator + 2 data rows
  });

  it('renders a table without explicit header', () => {
    const md = renderTableAsMarkdown({
      rows: [['A', 'B'], ['1', '2'], ['3', '4']],
      headerRowCount: 0,
      yStart: 720,
      yEnd: 690,
    });

    // Markdown always needs a separator after first row
    expect(md).toContain('| -');
    const lines = md.split('\n');
    expect(lines).toHaveLength(4);
  });
});
