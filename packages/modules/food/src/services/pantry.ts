import { and, asc, eq, like } from 'drizzle-orm';
import { newId, type Db } from '@memex/db';
import { type Clock, normalizeName, nowIso, systemClock } from '@memex/kernel';
import {
  createPantryItemSchema,
  type CreatePantryItemInput,
  type PantryCategory,
  type PantryItem,
  type UpdatePantryItem,
} from '../schemas/index';
import * as foodSchema from '../db/schema/index';
import { PantryItemNotFoundError } from './errors';

export interface ListPantryOptions {
  category?: PantryCategory;
  isAvailable?: boolean;
  search?: string;
}

export interface BulkPantryResult {
  created: number;
  updated: number;
  deleted: number;
  totalAfter: number;
}

export interface PantryService {
  list(userId: string, options?: ListPantryOptions): Promise<PantryItem[]>;
  create(userId: string, input: CreatePantryItemInput): Promise<PantryItem>;
  update(userId: string, id: string, input: UpdatePantryItem): Promise<PantryItem>;
  delete(userId: string, id: string): Promise<void>;
  bulkUpdate(
    userId: string,
    input: { items: CreatePantryItemInput[]; replace?: boolean },
  ): Promise<BulkPantryResult>;
}

export interface PantryServiceDeps {
  db: Db;
  clock?: Clock;
}

export function createPantryService(deps: PantryServiceDeps): PantryService {
  const { db } = deps;
  const clock = deps.clock ?? systemClock;

  function rowToItem(row: typeof foodSchema.pantryItem.$inferSelect): PantryItem {
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      normalizedName: row.normalizedName,
      category: row.category as PantryCategory,
      quantity: row.quantity,
      unit: row.unit,
      expiryDate: row.expiryDate,
      source: row.source as PantryItem['source'],
      confidence: row.confidence,
      isAvailable: row.isAvailable,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async function findById(userId: string, id: string) {
    const rows = await db
      .select()
      .from(foodSchema.pantryItem)
      .where(and(eq(foodSchema.pantryItem.id, id), eq(foodSchema.pantryItem.userId, userId)))
      .limit(1)
      .all();
    return rows[0];
  }

  return {
    async list(userId, options = {}) {
      const conditions = [eq(foodSchema.pantryItem.userId, userId)];
      if (options.category !== undefined) {
        conditions.push(eq(foodSchema.pantryItem.category, options.category));
      }
      if (options.isAvailable !== undefined) {
        conditions.push(eq(foodSchema.pantryItem.isAvailable, options.isAvailable));
      }
      if (options.search !== undefined && options.search.trim() !== '') {
        conditions.push(
          like(foodSchema.pantryItem.normalizedName, `%${normalizeName(options.search)}%`),
        );
      }
      const rows = await db
        .select()
        .from(foodSchema.pantryItem)
        .where(and(...conditions))
        .orderBy(asc(foodSchema.pantryItem.normalizedName))
        .all();
      return rows.map(rowToItem);
    },

    async create(userId, rawInput) {
      const input = createPantryItemSchema.parse(rawInput);
      const id = newId('pty');
      const now = nowIso(clock);
      await db.insert(foodSchema.pantryItem).values({
        id,
        userId,
        name: input.name,
        normalizedName: normalizeName(input.name),
        category: input.category,
        quantity: input.quantity ?? null,
        unit: input.unit ?? null,
        expiryDate: input.expiryDate ?? null,
        source: input.source,
        confidence: input.confidence ?? null,
        isAvailable: input.isAvailable,
        createdAt: now,
        updatedAt: now,
      });
      const row = await findById(userId, id);
      if (!row) throw new Error('pantry_item disappeared after insert');
      return rowToItem(row);
    },

    async update(userId, id, input) {
      const existing = await findById(userId, id);
      if (!existing) throw new PantryItemNotFoundError(id);
      const now = nowIso(clock);
      const patch: Partial<typeof foodSchema.pantryItem.$inferInsert> = { updatedAt: now };
      if (input.name !== undefined) {
        patch.name = input.name;
        patch.normalizedName = normalizeName(input.name);
      }
      if (input.category !== undefined) patch.category = input.category;
      if (input.quantity !== undefined) patch.quantity = input.quantity;
      if (input.unit !== undefined) patch.unit = input.unit;
      if (input.expiryDate !== undefined) patch.expiryDate = input.expiryDate;
      if (input.source !== undefined) patch.source = input.source;
      if (input.confidence !== undefined) patch.confidence = input.confidence;
      if (input.isAvailable !== undefined) patch.isAvailable = input.isAvailable;
      await db
        .update(foodSchema.pantryItem)
        .set(patch)
        .where(and(eq(foodSchema.pantryItem.id, id), eq(foodSchema.pantryItem.userId, userId)));
      const updated = await findById(userId, id);
      if (!updated) throw new Error('pantry_item vanished after update');
      return rowToItem(updated);
    },

    async delete(userId, id) {
      const existing = await findById(userId, id);
      if (!existing) throw new PantryItemNotFoundError(id);
      await db
        .delete(foodSchema.pantryItem)
        .where(and(eq(foodSchema.pantryItem.id, id), eq(foodSchema.pantryItem.userId, userId)));
    },

    async bulkUpdate(userId, input) {
      const replace = input.replace ?? false;
      const now = nowIso(clock);
      const incoming = new Map<string, CreatePantryItemInput>();
      for (const item of input.items) {
        incoming.set(normalizeName(item.name), item);
      }
      const existingRows = await db
        .select()
        .from(foodSchema.pantryItem)
        .where(eq(foodSchema.pantryItem.userId, userId))
        .all();
      const existingByNorm = new Map(existingRows.map((r) => [r.normalizedName, r]));

      let created = 0;
      let updated = 0;
      let deleted = 0;

      for (const [norm, raw] of incoming) {
        const item = createPantryItemSchema.parse(raw);
        const existing = existingByNorm.get(norm);
        if (existing) {
          await db
            .update(foodSchema.pantryItem)
            .set({
              name: item.name,
              normalizedName: norm,
              category: item.category,
              quantity: item.quantity ?? null,
              unit: item.unit ?? null,
              expiryDate: item.expiryDate ?? null,
              source: item.source,
              confidence: item.confidence ?? existing.confidence,
              isAvailable: item.isAvailable,
              updatedAt: now,
            })
            .where(eq(foodSchema.pantryItem.id, existing.id));
          updated++;
        } else {
          await db.insert(foodSchema.pantryItem).values({
            id: newId('pty'),
            userId,
            name: item.name,
            normalizedName: norm,
            category: item.category,
            quantity: item.quantity ?? null,
            unit: item.unit ?? null,
            expiryDate: item.expiryDate ?? null,
            source: item.source,
            confidence: item.confidence ?? null,
            isAvailable: item.isAvailable,
            createdAt: now,
            updatedAt: now,
          });
          created++;
        }
      }

      if (replace) {
        for (const [norm, row] of existingByNorm) {
          if (!incoming.has(norm)) {
            await db.delete(foodSchema.pantryItem).where(eq(foodSchema.pantryItem.id, row.id));
            deleted++;
          }
        }
      }

      const totalAfter = (
        await db
          .select()
          .from(foodSchema.pantryItem)
          .where(eq(foodSchema.pantryItem.userId, userId))
          .all()
      ).length;
      return { created, updated, deleted, totalAfter };
    },
  };
}
