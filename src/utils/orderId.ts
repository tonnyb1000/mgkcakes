import { getKampalaToday } from './dateKampala';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Generates a collision-safe, human-readable stable order ID: ORD-YYYYMMDD-XXXXXX.
 * Uses crypto.getRandomValues when available.
 */
export function generateOrderId(dateStr: string = getKampalaToday()): string {
  const compactDate = dateStr.replace(/-/g, '').slice(0, 8) || '00000000';
  const length = 6;
  let suffix = '';

  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    const bytes = new Uint8Array(length);
    globalThis.crypto.getRandomValues(bytes);
    for (let i = 0; i < length; i += 1) {
      suffix += ALPHABET[bytes[i] % ALPHABET.length];
    }
  } else {
    for (let i = 0; i < length; i += 1) {
      suffix += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
  }

  return `ORD-${compactDate}-${suffix}`;
}
