import { describe, it, expect } from 'vitest';
import { parseToUnicodeCMap } from '../../src/encoding/cmap.js';

const encode = (s: string) => new TextEncoder().encode(s);

describe('ToUnicode CMap Parser', () => {
  it('parses beginbfchar mappings', () => {
    const cmap = encode(`
/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Test) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Test-UCS def
/CMapType 2 def
1 begincodespacerange
<00> <FF>
endcodespacerange
2 beginbfchar
<01> <0048>
<02> <0065>
endbfchar
endcmap
CMapName currentdict /CMap defineresource pop
end
end
    `);

    const map = parseToUnicodeCMap(cmap);
    expect(map.get(0x01)).toBe('H');
    expect(map.get(0x02)).toBe('e');
  });

  it('parses beginbfrange mappings', () => {
    const cmap = encode(`
1 begincodespacerange
<00> <FF>
endcodespacerange
1 beginbfrange
<41> <5A> <0041>
endbfrange
    `);

    const map = parseToUnicodeCMap(cmap);
    expect(map.get(0x41)).toBe('A');
    expect(map.get(0x42)).toBe('B');
    expect(map.get(0x5A)).toBe('Z');
  });

  it('parses bfrange with array of destinations', () => {
    const cmap = encode(`
1 begincodespacerange
<00> <FF>
endcodespacerange
1 beginbfrange
<01> <03> [<0041> <0042> <0043>]
endbfrange
    `);

    const map = parseToUnicodeCMap(cmap);
    expect(map.get(0x01)).toBe('A');
    expect(map.get(0x02)).toBe('B');
    expect(map.get(0x03)).toBe('C');
  });

  it('handles empty cmap', () => {
    const cmap = encode('');
    const map = parseToUnicodeCMap(cmap);
    expect(map.size).toBe(0);
  });

  it('handles multi-byte unicode values', () => {
    const cmap = encode(`
1 beginbfchar
<01> <00480065006C006C006F>
endbfchar
    `);

    const map = parseToUnicodeCMap(cmap);
    expect(map.get(0x01)).toBe('Hello');
  });
});
