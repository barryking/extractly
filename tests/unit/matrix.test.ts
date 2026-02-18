import { describe, it, expect } from 'vitest';
import {
  multiplyMatrix,
  advancePosition,
  computeItemWidth,
} from '../../src/content/matrix.js';

describe('multiplyMatrix', () => {
  it('with identity [1,0,0,1,0,0] returns same matrix', () => {
    const identity = [1, 0, 0, 1, 0, 0];
    const m = [2, 0, 0, 3, 10, 20];
    const result = multiplyMatrix(m, identity);
    expect(result).toEqual(m);
    const result2 = multiplyMatrix(identity, m);
    expect(result2).toEqual(m);
  });

  it('combines translation matrices (translate(10,20) * translate(30,40) = translate(40,60))', () => {
    const t1 = [1, 0, 0, 1, 10, 20];
    const t2 = [1, 0, 0, 1, 30, 40];
    const result = multiplyMatrix(t1, t2);
    expect(result).toEqual([1, 0, 0, 1, 40, 60]);
  });

  it('combines rotation + scale', () => {
    // 90° rotation: [0,1,-1,0,0,0]
    // Scale 2x: [2,0,0,2,0,0]
    const rot90 = [0, 1, -1, 0, 0, 0];
    const scale2 = [2, 0, 0, 2, 0, 0];
    const result = multiplyMatrix(scale2, rot90);
    // Combined: scale then rotate
    // [2,0,0,2] * [0,1,-1,0] = [0,2,-2,0]
    expect(result[0]).toBeCloseTo(0);
    expect(result[1]).toBeCloseTo(2);
    expect(result[2]).toBeCloseTo(-2);
    expect(result[3]).toBeCloseTo(0);
    expect(result[4]).toBe(0);
    expect(result[5]).toBe(0);
  });
});

describe('advancePosition', () => {
  it('advances tm[4] by correct amount with charSpacing', () => {
    const tm = [1, 0, 0, 1, 0, 0];
    advancePosition(tm, 0.5, 3, 0, 12, 1, 0, 100);
    // advance = 0.5*12 + 3*1 + 0 = 6 + 3 = 9; * 1 = 9
    expect(tm[4]).toBe(9);
  });

  it('accounts for wordSpacing on spaces', () => {
    const tm = [1, 0, 0, 1, 0, 0];
    advancePosition(tm, 0.25, 1, 2, 10, 0, 0.1, 100);
    // advance = 0.25*10 + 1*0 + 2*0.1 = 2.5 + 0.2 = 2.7; * 1 = 2.7
    expect(tm[4]).toBeCloseTo(2.7);
  });

  it('applies horizontalScaling', () => {
    const tm = [1, 0, 0, 1, 0, 0];
    advancePosition(tm, 0.5, 0, 0, 10, 0, 0, 50);
    // advance = 0.5*10 = 5; * 0.5 = 2.5
    expect(tm[4]).toBe(2.5);
  });
});

describe('computeItemWidth', () => {
  it('multiplies glyphWidth * fontSize * abs(tm[0])', () => {
    const tm = [1, 0, 0, 1, 0, 0];
    expect(computeItemWidth(0.5, 12, tm)).toBe(6);

    const tmNeg = [-2, 0, 0, 1, 0, 0];
    expect(computeItemWidth(0.5, 12, tmNeg)).toBe(12);
  });
});
