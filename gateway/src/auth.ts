import { createHash, randomBytes, randomInt } from 'node:crypto';

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString('base64url')}`;
}

/** Agent bearer token. Only its SHA-256 hash is stored. */
export function newToken(): string {
  return `agw_${randomBytes(24).toString('base64url')}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// No 0/O/1/I/L so codes survive being read aloud or typed from a phone.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Human-friendly pairing code, e.g. `AGW-7K2QM-9XDHP`. ~50 bits; codes are also short-lived and single-use. */
export function newInviteCode(): string {
  const chunk = () =>
    Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  return `AGW-${chunk()}-${chunk()}`;
}

export function normalizeInviteCode(code: string): string {
  return code.trim().toUpperCase();
}
