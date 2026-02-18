import { describe, it, expect } from 'vitest';
import {
  shouldInsertSpace,
  assembleText,
  assembleStructuredItems,
} from '../../src/content/assembler.js';
import type { TextItem } from '../../src/types.js';

function makeItem(
  overrides: Partial<TextItem> & { text: string; x: number; y: number }
): TextItem {
  return {
    text: overrides.text,
    x: overrides.x,
    y: overrides.y,
    fontSize: overrides.fontSize ?? 12,
    fontName: overrides.fontName ?? 'Helvetica',
    width: overrides.width ?? 0,
    ...overrides,
  };
}

describe('assembler', () => {
  describe('assembleText', () => {
    it('sorts items by Y descending, X ascending (items at y=100 come before y=50; two items on same line by x order)', () => {
      const items: TextItem[] = [
        makeItem({ text: 'B', x: 20, y: 93, width: 8 }),
        makeItem({ text: 'A', x: 0, y: 100, width: 8 }),
        makeItem({ text: 'C', x: 9, y: 100, width: 8 }),
      ];
      const result = assembleText(items);
      // y=100 items first (A, C in x order; xGap 1 < 1.8 so no space), then y=93 (B, gap 7 triggers newline but not paragraph)
      expect(result).toBe('AC\nB');
    });

    it('inserts spaces for X-gaps > 15% of fontSize (items on same y, second item has gap > fontSize*0.15 with metric width)', () => {
      const items: TextItem[] = [
        makeItem({ text: 'Hello', x: 0, y: 100, fontSize: 12, width: 30 }),
        makeItem({ text: 'World', x: 40, y: 100, fontSize: 12, width: 25 }),
      ];
      // xGap = 40 - (0 + 30) = 10. 10 > 12*0.15 = 1.8 → insert space
      const result = assembleText(items);
      expect(result).toBe('Hello World');
    });

    it('inserts newlines for Y-gaps > 50% of fontSize', () => {
      const items: TextItem[] = [
        makeItem({ text: 'Line1', x: 0, y: 100, fontSize: 12 }),
        makeItem({ text: 'Line2', x: 0, y: 93, fontSize: 12 }),
      ];
      // yDelta = 7 > 12*0.5 = 6 → new line; 7 < 12*1.8 = 21.6 → no paragraph break
      const result = assembleText(items);
      expect(result).toBe('Line1\nLine2');
    });

    it('inserts blank lines for paragraph breaks (Y-gap > 1.8x fontSize)', () => {
      const items: TextItem[] = [
        makeItem({ text: 'Para1', x: 0, y: 100, fontSize: 12 }),
        makeItem({ text: 'Para2', x: 0, y: 76, fontSize: 12 }),
      ];
      // yDelta = 24 > 12*1.8 = 21.6 → paragraph break (blank line)
      const result = assembleText(items);
      expect(result).toBe('Para1\n\nPara2');
    });
  });

  describe('shouldInsertSpace', () => {
    it('returns true for large xGap with metric width (xGap=5, fontSize=12, hasMetricWidth=true)', () => {
      // 5 > 12*0.15 = 1.8 → true
      expect(shouldInsertSpace(5, 0, 1, 12, true)).toBe(true);
    });

    it('uses position-based fallback without metric width (xGap=0, posGap=20, textLen=1, fontSize=12)', () => {
      // posGap 20 > estimatedRunWidth = 1*12*0.5 = 6 → true
      expect(shouldInsertSpace(0, 20, 1, 12, false)).toBe(true);
    });
  });

  describe('assembleStructuredItems', () => {
    it('produces spans with bold/italic from font name (Helvetica-Bold for bold, Helvetica-Oblique for italic)', () => {
      const items: TextItem[] = [
        makeItem({ text: 'bold', x: 0, y: 100, fontName: 'Helvetica-Bold' }),
        makeItem({ text: 'italic', x: 50, y: 100, fontName: 'Helvetica-Oblique' }),
      ];
      const result = assembleStructuredItems(items);
      expect(result).toHaveLength(1);
      expect(result[0].spans).toHaveLength(2);
      expect(result[0].spans[0]).toMatchObject({ text: 'bold ', bold: true, italic: false });
      expect(result[0].spans[1]).toMatchObject({ text: 'italic', bold: false, italic: true });
    });

    it('merges adjacent spans with same style', () => {
      const items: TextItem[] = [
        makeItem({ text: 'Hello', x: 0, y: 100, fontName: 'Helvetica', width: 30 }),
        makeItem({ text: 'World', x: 40, y: 100, fontName: 'Helvetica', width: 25 }),
      ];
      const result = assembleStructuredItems(items);
      expect(result).toHaveLength(1);
      expect(result[0].spans).toHaveLength(1);
      expect(result[0].spans[0].text).toBe('Hello World');
      expect(result[0].spans[0]).toMatchObject({ bold: false, italic: false });
    });
  });
});
