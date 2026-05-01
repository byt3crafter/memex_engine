import { describe, expect, it } from 'vitest';
import { normalizeName } from './normalize';

describe('normalizeName', () => {
  it('lowercases and trims', () => {
    expect(normalizeName('  Chicken Breast  ')).toBe('chicken breast');
  });

  it('collapses internal whitespace', () => {
    expect(normalizeName('chicken    breast')).toBe('chicken breast');
  });

  it('strips punctuation', () => {
    expect(normalizeName('Chicken, Breast.')).toBe('chicken breast');
  });

  it('strips diacritics', () => {
    expect(normalizeName('Crème brûlée')).toBe('creme brulee');
  });

  it('returns empty for whitespace-only input', () => {
    expect(normalizeName('   ')).toBe('');
  });
});
