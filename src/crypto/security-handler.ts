/**
 * PDF Standard Security Handler (V1–V4)
 *
 * Implements the password-based encryption algorithms from the PDF 1.7 spec
 * (ISO 32000-1, sections 7.6.3 and 7.6.4). Supports empty-password PDFs
 * that use RC4 or AES-128-CBC encryption.
 */

import type { PdfDict } from '../parser/types.js';
import {
  dictGet, dictGetNumber, dictGetName, dictGetString,
  isDict, isBool,
} from '../parser/types.js';
import { md5, aesCbcDecrypt, hasCryptoImpl } from './crypto-impl.js';

export interface EncryptionInfo {
  readonly key: Uint8Array;
  readonly keyLength: number;
  readonly v: number;
  readonly r: number;
  readonly useAes: boolean;
  readonly encryptMetadata: boolean;
}

const PASSWORD_PADDING = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41,
  0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80,
  0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const AES_SALT = new Uint8Array([0x73, 0x41, 0x6c, 0x54]); // "sAlT"

function padPassword(password: Uint8Array | string): Uint8Array {
  const input = typeof password === 'string'
    ? new TextEncoder().encode(password)
    : password;
  const padded = new Uint8Array(32);
  const len = Math.min(input.length, 32);
  padded.set(input.subarray(0, len));
  if (len < 32) padded.set(PASSWORD_PADDING.subarray(0, 32 - len), len);
  return padded;
}

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = new Uint8Array(data.length);
  let x = 0, y = 0;
  for (let k = 0; k < data.length; k++) {
    x = (x + 1) & 0xff;
    y = (y + s[x]) & 0xff;
    [s[x], s[y]] = [s[y], s[x]];
    out[k] = data[k] ^ s[(s[x] + s[y]) & 0xff];
  }
  return out;
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  let totalLen = 0;
  for (const a of arrays) totalLen += a.length;
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

function int32LE(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  b[2] = (n >>> 16) & 0xff;
  b[3] = (n >>> 24) & 0xff;
  return b;
}

/**
 * PDF spec Algorithm 2: compute the encryption key from a password.
 */
function computeEncryptionKey(
  password: Uint8Array,
  o: Uint8Array,
  p: number,
  fileId: Uint8Array,
  keyLengthBytes: number,
  r: number,
  encryptMetadata: boolean,
): Uint8Array {
  const padded = padPassword(password);
  let input = concat(padded, o, int32LE(p), fileId);
  if (r >= 4 && !encryptMetadata) {
    input = concat(input, new Uint8Array([0xff, 0xff, 0xff, 0xff]));
  }
  let hash = md5(input);
  if (r >= 3) {
    for (let i = 0; i < 50; i++) {
      hash = md5(hash.subarray(0, keyLengthBytes));
    }
  }
  return hash.subarray(0, keyLengthBytes);
}

/**
 * PDF spec Algorithm 4: verify user password for R=2.
 */
function verifyUserPasswordR2(key: Uint8Array, u: Uint8Array): boolean {
  const encrypted = rc4(key, PASSWORD_PADDING);
  return u.length >= 32 && arraysEqual(encrypted, u.subarray(0, 32));
}

/**
 * PDF spec Algorithm 5: verify user password for R >= 3.
 */
function verifyUserPasswordR3(
  key: Uint8Array,
  u: Uint8Array,
  fileId: Uint8Array,
): boolean {
  const hash = md5(concat(PASSWORD_PADDING, fileId));
  let result = rc4(key, hash);
  for (let i = 1; i <= 19; i++) {
    const derivedKey = new Uint8Array(key.length);
    for (let j = 0; j < key.length; j++) derivedKey[j] = key[j] ^ i;
    result = rc4(derivedKey, result);
  }
  return u.length >= 16 && arraysEqual(result.subarray(0, 16), u.subarray(0, 16));
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Try to open an encrypted PDF with the empty user password.
 * Returns EncryptionInfo if successful, null if the password doesn't work.
 * Returns null if no crypto implementation is available (browser mode).
 */
export function tryEmptyPassword(
  encryptDict: PdfDict,
  fileId: Uint8Array,
): EncryptionInfo | null {
  if (!hasCryptoImpl()) return null;

  const v = dictGetNumber(encryptDict, 'V') ?? 0;
  const r = dictGetNumber(encryptDict, 'R') ?? 0;
  const filter = dictGetName(encryptDict, 'Filter');
  const keyLengthBits = dictGetNumber(encryptDict, 'Length') ?? 40;
  const p = dictGetNumber(encryptDict, 'P') ?? 0;
  const o = dictGetString(encryptDict, 'O');
  const u = dictGetString(encryptDict, 'U');

  if (filter !== 'Standard') return null;
  if (v >= 5) return null;
  if (!o || !u) return null;

  const encryptMetadataObj = dictGet(encryptDict, 'EncryptMetadata');
  const encryptMetadata = !(encryptMetadataObj && isBool(encryptMetadataObj) && encryptMetadataObj.value === false);

  let useAes = false;
  if (v === 4) {
    const stmF = dictGetName(encryptDict, 'StmF') ?? 'Identity';
    if (stmF !== 'Identity') {
      const cf = dictGet(encryptDict, 'CF');
      if (cf && isDict(cf)) {
        const filterDict = dictGet(cf, stmF);
        if (filterDict && isDict(filterDict)) {
          const cfm = dictGetName(filterDict, 'CFM');
          useAes = cfm === 'AESV2';
        }
      }
    }
  }

  const keyLengthBytes = keyLengthBits / 8;
  const emptyPassword = new Uint8Array(0);
  const key = computeEncryptionKey(emptyPassword, o, p, fileId, keyLengthBytes, r, encryptMetadata);

  const verified = r === 2
    ? verifyUserPasswordR2(key, u)
    : verifyUserPasswordR3(key, u, fileId);

  if (!verified) return null;

  return { key, keyLength: keyLengthBytes, v, r, useAes, encryptMetadata };
}

/**
 * PDF spec Algorithm 1: derive a per-object encryption key.
 */
export function objectKey(
  encKey: Uint8Array,
  objNum: number,
  gen: number,
  useAes: boolean,
): Uint8Array {
  const objBytes = new Uint8Array(3);
  objBytes[0] = objNum & 0xff;
  objBytes[1] = (objNum >> 8) & 0xff;
  objBytes[2] = (objNum >> 16) & 0xff;
  const genBytes = new Uint8Array(2);
  genBytes[0] = gen & 0xff;
  genBytes[1] = (gen >> 8) & 0xff;

  const input = useAes
    ? concat(encKey, objBytes, genBytes, AES_SALT)
    : concat(encKey, objBytes, genBytes);

  const hash = md5(input);
  const keyLen = Math.min(encKey.length + 5, 16);
  return hash.subarray(0, keyLen);
}

/**
 * Decrypt stream data using the per-object key.
 */
export function decryptData(
  encInfo: EncryptionInfo,
  data: Uint8Array,
  objNum: number,
  gen: number,
): Uint8Array {
  if (data.length === 0) return data;
  const key = objectKey(encInfo.key, objNum, gen, encInfo.useAes);
  if (encInfo.useAes) {
    if (data.length < 16) return data;
    const iv = data.subarray(0, 16);
    const ciphertext = data.subarray(16);
    if (ciphertext.length === 0) return new Uint8Array(0);
    try {
      return aesCbcDecrypt(key, iv, ciphertext);
    } catch {
      return data;
    }
  }
  return rc4(key, data);
}
