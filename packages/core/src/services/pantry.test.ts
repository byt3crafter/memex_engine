import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestHarness, type TestHarness } from '../test-support/index';
import { PantryItemNotFoundError } from './pantry';

describe('pantryService', () => {
  let h: TestHarness;

  beforeEach(async () => {
    h = await setupTestHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('create stamps normalized name and defaults', async () => {
    const item = await h.services.pantry.create({
      name: '  Chicken Breast ',
      category: 'protein',
    });
    expect(item.id).toMatch(/^pty_/);
    expect(item.normalizedName).toBe('chicken breast');
    expect(item.isAvailable).toBe(true);
    expect(item.source).toBe('manual');
  });

  it('list filters by category and search', async () => {
    await h.services.pantry.create({ name: 'Chicken', category: 'protein' });
    await h.services.pantry.create({ name: 'Eggs', category: 'protein' });
    await h.services.pantry.create({ name: 'Rice', category: 'carb' });

    const proteins = await h.services.pantry.list({ category: 'protein' });
    expect(proteins).toHaveLength(2);

    const search = await h.services.pantry.list({ search: 'chick' });
    expect(search).toHaveLength(1);
    expect(search[0]!.name).toBe('Chicken');
  });

  it('update merges only provided fields', async () => {
    const item = await h.services.pantry.create({ name: 'Eggs', category: 'protein' });
    const updated = await h.services.pantry.update(item.id, {
      quantity: 6,
      unit: 'pcs',
      isAvailable: false,
    });
    expect(updated.name).toBe('Eggs');
    expect(updated.quantity).toBe(6);
    expect(updated.unit).toBe('pcs');
    expect(updated.isAvailable).toBe(false);
  });

  it('update throws PantryItemNotFoundError for unknown id', async () => {
    await expect(h.services.pantry.update('pty_missing', { quantity: 1 })).rejects.toBeInstanceOf(
      PantryItemNotFoundError,
    );
  });

  it('delete removes the row', async () => {
    const item = await h.services.pantry.create({ name: 'Eggs', category: 'protein' });
    await h.services.pantry.delete(item.id);
    const all = await h.services.pantry.list();
    expect(all).toHaveLength(0);
  });

  it('bulkUpdate merges by normalized name (no replace)', async () => {
    await h.services.pantry.create({ name: 'Eggs', category: 'protein', quantity: 6, unit: 'pcs' });
    const result = await h.services.pantry.bulkUpdate({
      items: [
        { name: 'eggs', category: 'protein', quantity: 12, unit: 'pcs' },
        { name: 'Rice', category: 'carb' },
      ],
      replace: false,
    });
    expect(result.created).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.deleted).toBe(0);
    expect(result.totalAfter).toBe(2);

    const eggs = (await h.services.pantry.list({ search: 'eggs' }))[0]!;
    expect(eggs.quantity).toBe(12);
  });

  it('bulkUpdate replace deletes items not in the new set', async () => {
    await h.services.pantry.create({ name: 'Eggs', category: 'protein' });
    await h.services.pantry.create({ name: 'Rice', category: 'carb' });
    const result = await h.services.pantry.bulkUpdate({
      items: [{ name: 'Tuna', category: 'protein' }],
      replace: true,
    });
    expect(result.created).toBe(1);
    expect(result.deleted).toBe(2);
    expect(result.totalAfter).toBe(1);
  });
});
