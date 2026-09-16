export function leadingZeroBits(hash: Uint8Array): number {
  let bits = 0
  for (const byte of hash) {
    if (byte !== 0) return bits + Math.clz32(byte) - 24
    bits += 8
  }
  return bits
}
