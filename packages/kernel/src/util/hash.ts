/**
 * Cryptographic helpers for the auth path. Tokens are never stored in
 * cleartext — we keep a sha-256 hash and a short prefix (for display).
 */
import { createHash, randomBytes } from 'node:crypto';

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function newToken(prefixHint = 'mx'): { token: string; prefix: string } {
  const raw = randomBytes(32).toString('base64url');
  const token = `${prefixHint}_${raw}`;
  const prefix = token.slice(0, 8);
  return { token, prefix };
}

export function tokenPrefix(token: string): string {
  return token.slice(0, 8);
}
