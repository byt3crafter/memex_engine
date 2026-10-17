import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString('base64url')}`;
}

/** Agent bearer token. Only its SHA-256 hash is stored. */
export function newToken(): string {
  return `nodd_${randomBytes(24).toString('base64url')}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// No 0/O/1/I/L so codes survive being read aloud or typed from a phone.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Human-friendly pairing code, e.g. `NODD-7K2QM-9XDHP`. ~50 bits; codes are also short-lived and single-use. */
export function newInviteCode(): string {
  const chunk = () =>
    Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  return `NODD-${chunk()}-${chunk()}`;
}

export function normalizeInviteCode(code: string): string {
  return code.trim().toUpperCase();
}

// ---- passwords (people) ----

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  const [scheme, n, salt, key] = (stored ?? '').split('$');
  if (scheme !== 'scrypt' || !n || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64url');
  const actual = scryptSync(password, Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(n),
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return timingSafeEqual(actual, expected);
}
