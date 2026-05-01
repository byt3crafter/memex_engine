import { describe, expect, it } from 'vitest';
import { hashToken, newToken, tokenPrefix } from './hash';
import { normalizeName } from './normalize';
import { isoDateOnly, nowIso, plusSeconds } from './time';

describe('kernel util', () => {
  it('normalizeName collapses whitespace, punctuation, diacritics', () => {
    expect(normalizeName('  Chicken Breast  ')).toBe('chicken breast');
    expect(normalizeName('Crème brûlée')).toBe('creme brulee');
    expect(normalizeName('chicken,   breast.')).toBe('chicken breast');
  });

  it('nowIso uses an injectable clock', () => {
    const fixed = new Date('2026-05-01T12:00:00.000Z');
    const out = nowIso(() => fixed);
    expect(out).toBe('2026-05-01T12:00:00.000Z');
  });

  it('isoDateOnly slices to YYYY-MM-DD', () => {
    expect(isoDateOnly('2026-05-01T12:00:00.000Z')).toBe('2026-05-01');
  });

  it('plusSeconds advances the clock', () => {
    const fixed = new Date('2026-05-01T12:00:00.000Z');
    expect(plusSeconds(60, () => new Date(fixed))).toBe('2026-05-01T12:01:00.000Z');
  });

  it('newToken returns a usable token + prefix', () => {
    const { token, prefix } = newToken('mx');
    expect(token).toMatch(/^mx_/);
    expect(prefix).toHaveLength(8);
    expect(token.startsWith(prefix)).toBe(true);
  });

  it('hashToken is deterministic and 64 hex chars', () => {
    const a = hashToken('the-quick-brown-fox');
    const b = hashToken('the-quick-brown-fox');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('tokenPrefix returns the first 8 chars', () => {
    expect(tokenPrefix('mx_abcdefghijkl')).toBe('mx_abcde');
  });
});
