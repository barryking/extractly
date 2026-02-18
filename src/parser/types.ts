/**
 * Internal PDF object model types.
 * These represent the primitive and compound types found in the PDF file format.
 */

/** Reference to an indirect object: "objNum gen R" */
export interface PdfRef {
  readonly kind: 'ref';
  readonly objNum: number;
  readonly gen: number;
}

/** A PDF name object, e.g. /Type */
export interface PdfName {
  readonly kind: 'name';
  readonly value: string;
}

/** A PDF string (literal or hex) */
export interface PdfString {
  readonly kind: 'string';
  readonly value: Uint8Array;
}

/** A PDF dictionary << /Key Value ... >> */
export interface PdfDict {
  readonly kind: 'dict';
  readonly entries: Map<string, PdfObject>;
}

/** A PDF array [ ... ] */
export interface PdfArray {
  readonly kind: 'array';
  readonly items: PdfObject[];
}

/** A PDF stream: dictionary + raw byte data */
export interface PdfStream {
  readonly kind: 'stream';
  readonly dict: PdfDict;
  readonly data: Uint8Array;
}

/** A PDF boolean */
export interface PdfBool {
  readonly kind: 'bool';
  readonly value: boolean;
}

/** A PDF number (integer or real) */
export interface PdfNumber {
  readonly kind: 'number';
  readonly value: number;
}

/** PDF null */
export interface PdfNull {
  readonly kind: 'null';
}

/** Union of all PDF object types */
export type PdfObject =
  | PdfRef
  | PdfName
  | PdfString
  | PdfDict
  | PdfArray
  | PdfStream
  | PdfBool
  | PdfNumber
  | PdfNull;

/** Cross-reference entry: byte offset for an in-use object */
export interface XRefEntry {
  readonly offset: number;
  readonly gen: number;
  readonly free: boolean;
  /** For compressed objects: the object number of the containing object stream */
  readonly streamObjNum?: number;
  /** For compressed objects: the index within the object stream */
  readonly streamIndex?: number;
}

/** The cross-reference table mapping object numbers to their locations */
export type XRefTable = Map<number, XRefEntry>;

/** PDF trailer dictionary fields we care about */
export interface TrailerInfo {
  readonly size: number;
  readonly root?: PdfRef;
  readonly info?: PdfRef;
  readonly prev?: number;
  readonly dict: PdfDict;
}

// ─── Helper constructors ───

export function pdfRef(objNum: number, gen: number): PdfRef {
  return { kind: 'ref', objNum, gen };
}

export function pdfName(value: string): PdfName {
  return { kind: 'name', value };
}

export function pdfString(value: Uint8Array): PdfString {
  return { kind: 'string', value };
}

export function pdfStringFromText(text: string): PdfString {
  return { kind: 'string', value: new TextEncoder().encode(text) };
}

export function pdfDict(entries?: Map<string, PdfObject>): PdfDict {
  return { kind: 'dict', entries: entries ?? new Map() };
}

export function pdfArray(items?: PdfObject[]): PdfArray {
  return { kind: 'array', items: items ?? [] };
}

export function pdfStream(dict: PdfDict, data: Uint8Array): PdfStream {
  return { kind: 'stream', dict, data };
}

export function pdfBool(value: boolean): PdfBool {
  return { kind: 'bool', value };
}

export function pdfNumber(value: number): PdfNumber {
  return { kind: 'number', value };
}

export const PDF_NULL: PdfNull = { kind: 'null' };

// ─── Type guards ───

export function isRef(obj: PdfObject): obj is PdfRef {
  return obj.kind === 'ref';
}

export function isName(obj: PdfObject): obj is PdfName {
  return obj.kind === 'name';
}

export function isString(obj: PdfObject): obj is PdfString {
  return obj.kind === 'string';
}

export function isDict(obj: PdfObject): obj is PdfDict {
  return obj.kind === 'dict';
}

export function isArray(obj: PdfObject): obj is PdfArray {
  return obj.kind === 'array';
}

export function isStream(obj: PdfObject): obj is PdfStream {
  return obj.kind === 'stream';
}

export function isBool(obj: PdfObject): obj is PdfBool {
  return obj.kind === 'bool';
}

export function isNumber(obj: PdfObject): obj is PdfNumber {
  return obj.kind === 'number';
}

export function isNull(obj: PdfObject): obj is PdfNull {
  return obj.kind === 'null';
}

// ─── Dictionary helpers ───

export function dictGet(dict: PdfDict, key: string): PdfObject | undefined {
  return dict.entries.get(key);
}

export function dictGetName(dict: PdfDict, key: string): string | undefined {
  const obj = dict.entries.get(key);
  return obj && isName(obj) ? obj.value : undefined;
}

export function dictGetNumber(dict: PdfDict, key: string): number | undefined {
  const obj = dict.entries.get(key);
  return obj && isNumber(obj) ? obj.value : undefined;
}

export function dictGetBool(dict: PdfDict, key: string): boolean | undefined {
  const obj = dict.entries.get(key);
  return obj && isBool(obj) ? obj.value : undefined;
}

export function dictGetString(dict: PdfDict, key: string): Uint8Array | undefined {
  const obj = dict.entries.get(key);
  return obj && isString(obj) ? obj.value : undefined;
}

export function dictGetArray(dict: PdfDict, key: string): PdfArray | undefined {
  const obj = dict.entries.get(key);
  return obj && isArray(obj) ? obj : undefined;
}

export function dictGetDict(dict: PdfDict, key: string): PdfDict | undefined {
  const obj = dict.entries.get(key);
  return obj && isDict(obj) ? obj : undefined;
}

export function dictGetRef(dict: PdfDict, key: string): PdfRef | undefined {
  const obj = dict.entries.get(key);
  return obj && isRef(obj) ? obj : undefined;
}
