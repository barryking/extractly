import { describe, it, expect } from 'vitest';
import { PdfLexer, TokenType } from '../../src/parser/lexer.js';

const encode = (s: string) => new TextEncoder().encode(s);

describe('PdfLexer', () => {
  it('tokenizes a number', () => {
    const lexer = new PdfLexer(encode('42'));
    const token = lexer.nextToken();
    expect(token.type).toBe(TokenType.Number);
    expect(token.value).toBe(42);
  });

  it('tokenizes a real number', () => {
    const lexer = new PdfLexer(encode('3.14'));
    const token = lexer.nextToken();
    expect(token.type).toBe(TokenType.Number);
    expect(token.value).toBeCloseTo(3.14);
  });

  it('tokenizes a negative number', () => {
    const lexer = new PdfLexer(encode('-7'));
    const token = lexer.nextToken();
    expect(token.type).toBe(TokenType.Number);
    expect(token.value).toBe(-7);
  });

  it('tokenizes a name', () => {
    const lexer = new PdfLexer(encode('/Type'));
    const token = lexer.nextToken();
    expect(token.type).toBe(TokenType.Name);
    expect(token.value).toBe('Type');
  });

  it('tokenizes a name with hex escape', () => {
    const lexer = new PdfLexer(encode('/A#42'));
    const token = lexer.nextToken();
    expect(token.type).toBe(TokenType.Name);
    expect(token.value).toBe('AB');
  });

  it('tokenizes a literal string', () => {
    const lexer = new PdfLexer(encode('(Hello World)'));
    const token = lexer.nextToken();
    expect(token.type).toBe(TokenType.String);
    expect(new TextDecoder().decode(token.value as Uint8Array)).toBe('Hello World');
  });

  it('handles nested parentheses in strings', () => {
    const lexer = new PdfLexer(encode('(Hello (World))'));
    const token = lexer.nextToken();
    expect(token.type).toBe(TokenType.String);
    expect(new TextDecoder().decode(token.value as Uint8Array)).toBe('Hello (World)');
  });

  it('handles escape sequences in strings', () => {
    const lexer = new PdfLexer(encode('(line1\\nline2)'));
    const token = lexer.nextToken();
    expect(token.type).toBe(TokenType.String);
    const bytes = token.value as Uint8Array;
    expect(bytes).toContain(0x0a); // \n
  });

  it('handles octal escapes in strings', () => {
    const lexer = new PdfLexer(encode('(\\110\\145\\154\\154\\157)'));
    const token = lexer.nextToken();
    expect(token.type).toBe(TokenType.String);
    expect(new TextDecoder().decode(token.value as Uint8Array)).toBe('Hello');
  });

  it('tokenizes a hex string', () => {
    const lexer = new PdfLexer(encode('<48656C6C6F>'));
    const token = lexer.nextToken();
    expect(token.type).toBe(TokenType.HexString);
    expect(new TextDecoder().decode(token.value as Uint8Array)).toBe('Hello');
  });

  it('handles odd-length hex strings', () => {
    const lexer = new PdfLexer(encode('<ABC>'));
    const token = lexer.nextToken();
    expect(token.type).toBe(TokenType.HexString);
    const bytes = token.value as Uint8Array;
    expect(bytes[0]).toBe(0xab);
    expect(bytes[1]).toBe(0xc0); // padded with 0
  });

  it('tokenizes boolean true', () => {
    const lexer = new PdfLexer(encode('true'));
    const token = lexer.nextToken();
    expect(token.type).toBe(TokenType.Bool);
    expect(token.value).toBe(true);
  });

  it('tokenizes boolean false', () => {
    const lexer = new PdfLexer(encode('false'));
    const token = lexer.nextToken();
    expect(token.type).toBe(TokenType.Bool);
    expect(token.value).toBe(false);
  });

  it('tokenizes null', () => {
    const lexer = new PdfLexer(encode('null'));
    const token = lexer.nextToken();
    expect(token.type).toBe(TokenType.Null);
    expect(token.value).toBeNull();
  });

  it('tokenizes keywords', () => {
    const lexer = new PdfLexer(encode('obj'));
    const token = lexer.nextToken();
    expect(token.type).toBe(TokenType.Keyword);
    expect(token.value).toBe('obj');
  });

  it('tokenizes dictionary delimiters', () => {
    const lexer = new PdfLexer(encode('<< >>'));
    expect(lexer.nextToken().type).toBe(TokenType.DictStart);
    expect(lexer.nextToken().type).toBe(TokenType.DictEnd);
  });

  it('tokenizes array delimiters', () => {
    const lexer = new PdfLexer(encode('[ ]'));
    expect(lexer.nextToken().type).toBe(TokenType.ArrayStart);
    expect(lexer.nextToken().type).toBe(TokenType.ArrayEnd);
  });

  it('skips comments', () => {
    const lexer = new PdfLexer(encode('% this is a comment\n42'));
    const token = lexer.nextToken();
    expect(token.type).toBe(TokenType.Number);
    expect(token.value).toBe(42);
  });

  it('skips whitespace', () => {
    const lexer = new PdfLexer(encode('  \t\n  42'));
    const token = lexer.nextToken();
    expect(token.type).toBe(TokenType.Number);
    expect(token.value).toBe(42);
  });

  it('tokenizes a sequence of tokens', () => {
    const lexer = new PdfLexer(encode('/Type /Catalog /Pages 2 0 R'));
    expect(lexer.nextToken().value).toBe('Type');
    expect(lexer.nextToken().value).toBe('Catalog');
    expect(lexer.nextToken().value).toBe('Pages');
    expect(lexer.nextToken().value).toBe(2);
    expect(lexer.nextToken().value).toBe(0);
    expect(lexer.nextToken().value).toBe('R');
  });

  it('returns EOF at end of data', () => {
    const lexer = new PdfLexer(encode(''));
    expect(lexer.nextToken().type).toBe(TokenType.EOF);
  });

  it('finds a byte sequence searching backward', () => {
    const lexer = new PdfLexer(encode('hello world startxref\n123'));
    const pos = lexer.findLast(encode('startxref'));
    expect(pos).toBe(12);
  });

  it('finds a byte sequence searching forward', () => {
    const lexer = new PdfLexer(encode('hello world endstream'));
    const pos = lexer.findNext(encode('endstream'));
    expect(pos).toBe(12);
  });
});
