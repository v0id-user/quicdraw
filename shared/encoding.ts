// Yjs updates are bytes and transport-io carries JSON.
export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export function fromBase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

export function leadingZeroBits(hash: Uint8Array): number {
  let bits = 0
  for (const byte of hash) {
    if (byte !== 0) return bits + Math.clz32(byte) - 24
    bits += 8
  }
  return bits
}
