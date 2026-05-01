import { createId } from '@paralleldrive/cuid2';

/**
 * Prefixed cuid2 id generator. Modules register their own prefixes
 * (e.g., 'pty' for pantry items, 'fev' for food events) and call newId
 * directly. Keeping prefixes self-describing makes ids debug-friendly
 * in logs and SQL inspectors.
 */
export function newId(prefix: string): string {
  if (!/^[a-z][a-z0-9]{1,9}$/.test(prefix)) {
    throw new Error(`invalid id prefix: ${prefix}`);
  }
  return `${prefix}_${createId()}`;
}

export const KernelIdPrefix = {
  user: 'usr',
  connection: 'con',
  pairingCode: 'pcd',
} as const;

const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // omit similar-looking 0/O/I/L/1

/**
 * Short, human-friendly pairing code: 8 uppercase chars in two groups
 * of four (e.g., "ABCD-1234"). Crypto-random.
 */
export function newPairingCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const idx = bytes[i]! % PAIRING_ALPHABET.length;
    out += PAIRING_ALPHABET[idx];
    if (i === 3) out += '-';
  }
  return out;
}
