import { inflateSync } from 'node:zlib';
import { createHash, createDecipheriv } from 'node:crypto';
import { setInflate } from '../src/stream/inflate.js';
import { setCryptoImpl } from '../src/crypto/crypto-impl.js';

function nodeInflate(data: Uint8Array): Uint8Array {
  try {
    return new Uint8Array(inflateSync(data));
  } catch {
    return new Uint8Array(inflateSync(data, { finishFlush: 0 }));
  }
}

setInflate(nodeInflate);

setCryptoImpl(
  (data) => new Uint8Array(createHash('md5').update(data).digest()),
  (key, iv, data) => {
    const decipher = createDecipheriv('aes-128-cbc', key, iv);
    decipher.setAutoPadding(true);
    const a = decipher.update(data);
    const b = decipher.final();
    const result = new Uint8Array(a.length + b.length);
    result.set(new Uint8Array(a.buffer, a.byteOffset, a.length));
    result.set(new Uint8Array(b.buffer, b.byteOffset, b.length), a.length);
    return result;
  },
);
