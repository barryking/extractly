/**
 * Injectable crypto primitives for the security handler.
 * Node entry registers implementations from node:crypto.
 * Browser entry leaves them unset (encrypted PDFs unsupported in browser).
 */

type Md5Fn = (data: Uint8Array) => Uint8Array;
type AesCbcDecryptFn = (key: Uint8Array, iv: Uint8Array, data: Uint8Array) => Uint8Array;

let _md5: Md5Fn | null = null;
let _aesCbcDecrypt: AesCbcDecryptFn | null = null;

export function setCryptoImpl(md5: Md5Fn, aesCbcDecrypt: AesCbcDecryptFn): void {
  _md5 = md5;
  _aesCbcDecrypt = aesCbcDecrypt;
}

export function hasCryptoImpl(): boolean {
  return _md5 !== null && _aesCbcDecrypt !== null;
}

export function md5(data: Uint8Array): Uint8Array {
  if (!_md5) throw new Error('No crypto implementation configured');
  return _md5(data);
}

export function aesCbcDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  if (!_aesCbcDecrypt) throw new Error('No crypto implementation configured');
  return _aesCbcDecrypt(key, iv, data);
}
