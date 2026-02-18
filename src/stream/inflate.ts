/**
 * Injectable inflate implementation.
 * Configured at module load time by the entry point (Node uses node:zlib, browser uses fflate).
 */

type InflateFn = (data: Uint8Array) => Uint8Array;

let impl: InflateFn | null = null;

export function setInflate(fn: InflateFn): void {
  impl = fn;
}

export function inflate(data: Uint8Array): Uint8Array {
  if (!impl) throw new Error('No inflate implementation configured. Import from "extractly" or "extractly/browser".');
  return impl(data);
}
