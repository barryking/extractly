/**
 * Font Style Detection
 *
 * Parses PDF font names to detect bold and italic styles.
 * PDF fonts encode style in the BaseFont name (e.g. "Helvetica-BoldOblique",
 * "ABCDEF+Inter-SemiBold", "TimesNewRomanPS-ItalicMT").
 */

export interface FontStyle {
  bold: boolean;
  italic: boolean;
}

const BOLD_TOKENS = /[-,](bold|semibold|demibold|demi|black|heavy|extrabold|ultrabold)/i;
const ITALIC_TOKENS = /([-,]|bold|demi)(italic|oblique|slant|inclined|kursiv)/i;

/**
 * Detect bold/italic from a PDF font name.
 *
 * Handles common patterns:
 * - "Helvetica-Bold", "Helvetica-BoldOblique"
 * - "ABCDEF+Inter-SemiBold" (subset prefix)
 * - "TimesNewRomanPS-ItalicMT"
 * - "ArialMT,Bold", "Arial,BoldItalic"
 */
export function detectFontStyle(fontName: string): FontStyle {
  // Strip subset prefix (e.g. "ABCDEF+" or "GHIJKL+")
  const name = fontName.replace(/^[A-Z]{6}\+/, '');

  return {
    bold: BOLD_TOKENS.test(name),
    italic: ITALIC_TOKENS.test(name),
  };
}
