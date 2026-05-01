import { and, asc, eq, like } from 'drizzle-orm';
import { newId, schema } from '@pantrymind/db';
import type { Db } from '@pantrymind/db';
import type {
  BulkPantryUpdate,
  CreatePantryItem,
  PantryCategory,
  PantryItem,
  UpdatePantryItem,
} from '@pantrymind/schemas';
import { normalizeName } from '../util/normalize';
import { nowIso, systemClock, type Clock } from '../util/time';
import type { ProfileService } from './profile';

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
  list(options?: ListPantryOptions): Promise<PantryItem[]>;
  create(input: CreatePantryItem): Promise<PantryItem>;
  update(id: string, input: UpdatePantryItem): Promise<PantryItem>;
  delete(id: string): Promise<void>;
  bulkUpdate(input: BulkPantryUpdate): Promise<BulkPantryResult>;
}

export interface PantryServiceDeps {
  db: Db;
  profile: ProfileService;
  clock?: Clock;
}

export function createPantryService(deps: PantryServiceDeps | Db): PantryService {
  const concrete: PantryServiceDeps =
    'db' in deps && 'profile' in deps
      ? deps
      : ({ db: deps as Db, profile: undefined as unknown as ProfileService });
  const { db } = concrete;
  const clock = concrete.clock ?? systemClock;

  function requireProfile(): ProfileService {
    if (!concrete.profile) {
      throw new Error('PantryService was created without a ProfileService dependency');
    }
    return concrete.profile;
  }

  async function userId(): Promise<string> {
    return (await requireProfile().getCurrentProfile()).id;
  }

  function rowToItem(row: typeof schema.pantryItem.$inferSelect): PantryItem {
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

  async function findById(id: string, uid: string) {
    const rows = await db
      .select()
      .from(schema.pantryItem)
      .where(and(eq(schema.pantryItem.id, id), eq(schema.pantryItem.userId, uid)))
      .limit(1)
      .all();
    return rows[0];
  }

  return {
    async list(options = {}) {
      const uid = await userId();
      const conditions = [eq(schema.pantryItem.userId, uid)];
      if (options.category !== undefined) {
        conditions.push(eq(schema.pantryItem.category, options.category));
      }
      if (options.isAvailable !== undefined) {
        conditions.push(eq(schema.pantryItem.isAvailable, options.isAvailable));
      }
      if (options.search !== undefined && options.search.trim() !== '') {
        const needle = `%${normalizeName(options.search)}%`;
        conditions.push(like(schema.pantryItem.normalizedName, needle));
      }
      const rows = await db
        .select()
        .from(schema.pantryItem)
        .where(and(...conditions))
        .orderBy(asc(schema.pantryItem.normalizedName))
        .all();
      return rows.map(rowToItem);
    },

    async create(input) {
      const uid = await userId();
      const now = nowIso(clock);
      const id = newId('pantry');
      await db.insert(schema.pantryItem).values({
        id,
        userId: uid,
        name: input.name,
        normalizedName: normalizeName(input.name),
        category: input.category,
        quantity: input.quantity ?? null,
        unit: input.unit ?? null,
        expiryDate: input.expiryDate ?? null,
        source: input.source ?? 'manual',
        confidence: input.confidence ?? null,
        isAvailable: input.isAvailable ?? true,
        createdAt: now,
        updatedAt: now,
      });
      const row = await findById(id, uid);
      if (!row) throw new Error('pantry item disappeared after insert');
      return rowToItem(row);
    },

    async update(id, input) {
      const uid = await userId();
      const existing = await findById(id, uid);
      if (!existing) {
        throw new PantryItemNotFoundError(id);
      }
      const now = nowIso(clock);
      const patch: Partial<typeof schema.pantryItem.$inferInsert> = { updatedAt: now };
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
        .update(schema.pantryItem)
        .set(patch)
        .where(and(eq(schema.pantryItem.id, id), eq(schema.pantryItem.userId, uid)));

      const updated = await findById(id, uid);
      if (!updated) throw new Error('pantry item vanished after update');
      return rowToItem(updated);
    },

    async delete(id) {
      const uid = await userId();
      const existing = await findById(id, uid);
      if (!existing) {
        throw new PantryItemNotFoundError(id);
      }
      await db
        .delete(schema.pantryItem)
        .where(and(eq(schema.pantryItem.id, id), eq(schema.pantryItem.userId, uid)));
    },

    async bulkUpdate(input) {
      const uid = await userId();
      const now = nowIso(clock);
      const incoming = new Map<string, CreatePantryItem>();
      for (const item of input.items) {
        incoming.set(normalizeName(item.name), item);
      }

      const existingRows = await db
        .select()
        .from(schema.pantryItem)
        .where(eq(schema.pantryItem.userId, uid))
        .all();
      const existingByNorm = new Map(existingRows.map((r) => [r.normalizedName, r]));

      let created = 0;
      let updated = 0;
      let deleted = 0;

      for (const [norm, item] of incoming) {
        const existing = existingByNorm.get(norm);
        if (existing) {
          await db
            .update(schema.pantryItem)
            .set({
              name: item.name,
              normalizedName: norm,
              category: item.category,
              quantity: item.quantity ?? null,
              unit: item.unit ?? null,
              expiryDate: item.expiryDate ?? null,
              source: item.source ?? existing.source,
              confidence: item.confidence ?? existing.confidence,
              isAvailable: item.isAvailable ?? true,
              updatedAt: now,
            })
            .where(eq(schema.pantryItem.id, existing.id));
          updated++;
        } else {
          await db.insert(schema.pantryItem).values({
            id: newId('pantry'),
            userId: uid,
            name: item.name,
            normalizedName: norm,
            category: item.category,
            quantity: item.quantity ?? null,
            unit: item.unit ?? null,
            expiryDate: item.expiryDate ?? null,
            source: item.source ?? 'manual',
            confidence: item.confidence ?? null,
            isAvailable: item.isAvailable ?? true,
            createdAt: now,
            updatedAt: now,
          });
          created++;
        }
      }

      if (input.replace) {
        for (const [norm, row] of existingByNorm) {
          if (!incoming.has(norm)) {
            await db.delete(schema.pantryItem).where(eq(schema.pantryItem.id, row.id));
            deleted++;
          }
        }
      }

      const totalAfter = (
        await db
          .select()
          .from(schema.pantryItem)
          .where(eq(schema.pantryItem.userId, uid))
          .all()
      ).length;

      return { created, updated, deleted, totalAfter };
    },
  };
}

export class PantryItemNotFoundError extends Error {
  readonly code = 'pantry_item_not_found' as const;
  constructor(public readonly id: string) {
    super(`pantry item ${id} not found`);
  }
}
