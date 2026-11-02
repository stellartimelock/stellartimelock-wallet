// Byte compare for a signed SEP-7 return.
//
// Hermes does not provide Node's `crypto.timingSafeEqual`. This walks
// every byte and folds the difference into one number, so a mismatch
// does not return on the first different byte.

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
