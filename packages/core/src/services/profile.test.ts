import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestHarness, type TestHarness } from '../test-support/index';

describe('profileService', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await setupTestHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  it('auto-creates a profile on first read', async () => {
    const profile = await harness.services.profile.getCurrentProfile();
    expect(profile.id).toMatch(/^usr_/);
    expect(profile.displayName).toBe('PantryMind User');
    expect(profile.timezone).toBe('UTC');
    expect(profile.allergies).toEqual([]);
  });

  it('returns the same profile on subsequent reads', async () => {
    const a = await harness.services.profile.getCurrentProfile();
    const b = await harness.services.profile.getCurrentProfile();
    expect(b.id).toBe(a.id);
  });

  it('partial update merges only the provided fields', async () => {
    const before = await harness.services.profile.getCurrentProfile();
    const updated = await harness.services.profile.updateCurrentProfile({
      displayName: 'Dovik',
      allergies: ['shellfish'],
      goals: { protein_g_per_day: 150 },
    });
    expect(updated.id).toBe(before.id);
    expect(updated.displayName).toBe('Dovik');
    expect(updated.timezone).toBe('UTC'); // untouched
    expect(updated.allergies).toEqual(['shellfish']);
    expect(updated.goals).toEqual({ protein_g_per_day: 150 });
    expect(updated.updatedAt >= before.updatedAt).toBe(true);
  });

  it('clearing arrays via empty array is honored', async () => {
    await harness.services.profile.updateCurrentProfile({ allergies: ['shellfish'] });
    const cleared = await harness.services.profile.updateCurrentProfile({ allergies: [] });
    expect(cleared.allergies).toEqual([]);
  });
});
