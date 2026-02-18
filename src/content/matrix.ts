/**
 * Matrix and position utilities for PDF text extraction.
 * Handles 2D affine transformation matrices in the standard PDF format [a, b, c, d, tx, ty].
 */

/** Multiply two 2D affine matrices: result = a * b */
export function multiplyMatrix(a: number[], b: number[]): number[] {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

/**
 * Advance the text matrix position using actual glyph widths.
 * Per PDF spec: tx = (w0 * Tfs + Tc + Tw_if_space) * Th for each character.
 */
export function advancePosition(
  tm: number[],
  glyphWidth: number,
  charCount: number,
  spaceCount: number,
  fontSize: number,
  charSpacing: number,
  wordSpacing: number,
  horizontalScaling: number,
): void {
  const advance = glyphWidth * fontSize
    + charCount * charSpacing
    + spaceCount * wordSpacing;
  tm[4] += advance * (horizontalScaling / 100);
}

/** Compute the rendered width of a text run using actual glyph widths. */
export function computeItemWidth(glyphWidth: number, fontSize: number, tm: number[]): number {
  return glyphWidth * fontSize * Math.abs(tm[0]);
}
