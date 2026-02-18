import { describe, it, expect } from 'vitest';
import { detectFontStyle } from '../../src/content/font-style.js';

describe('detectFontStyle', () => {
  it('detects regular fonts as not bold/italic', () => {
    expect(detectFontStyle('Helvetica')).toEqual({ bold: false, italic: false });
    expect(detectFontStyle('ArialMT')).toEqual({ bold: false, italic: false });
    expect(detectFontStyle('TimesNewRomanPSMT')).toEqual({ bold: false, italic: false });
  });

  it('detects bold from font name', () => {
    expect(detectFontStyle('Helvetica-Bold')).toEqual({ bold: true, italic: false });
    expect(detectFontStyle('Arial,Bold')).toEqual({ bold: true, italic: false });
    expect(detectFontStyle('TimesNewRomanPS-BoldMT')).toEqual({ bold: true, italic: false });
  });

  it('detects italic/oblique from font name', () => {
    expect(detectFontStyle('Helvetica-Oblique')).toEqual({ bold: false, italic: true });
    expect(detectFontStyle('TimesNewRomanPS-ItalicMT')).toEqual({ bold: false, italic: true });
  });

  it('detects bold-italic combined', () => {
    expect(detectFontStyle('Helvetica-BoldOblique')).toEqual({ bold: true, italic: true });
    expect(detectFontStyle('TimesNewRomanPS-BoldItalicMT')).toEqual({ bold: true, italic: true });
    expect(detectFontStyle('Arial,BoldItalic')).toEqual({ bold: true, italic: true });
  });

  it('handles subset-prefixed fonts', () => {
    expect(detectFontStyle('ABCDEF+Inter-SemiBold')).toEqual({ bold: true, italic: false });
    expect(detectFontStyle('GHIJKL+Inter-SemiBoldItalic')).toEqual({ bold: true, italic: true });
  });

  it('detects semibold and heavy variants', () => {
    expect(detectFontStyle('Inter-SemiBold')).toEqual({ bold: true, italic: false });
    expect(detectFontStyle('Roboto-Black')).toEqual({ bold: true, italic: false });
    expect(detectFontStyle('Montserrat-ExtraBold')).toEqual({ bold: true, italic: false });
    expect(detectFontStyle('OpenSans-Heavy')).toEqual({ bold: true, italic: false });
  });
});
