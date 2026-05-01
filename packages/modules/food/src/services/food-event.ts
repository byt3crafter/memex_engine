import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { newId, type Db } from '@memex/db';
import { type Clock, normalizeName, nowIso, systemClock } from '@memex/kernel';
import {
  createFoodEventSchema,
  type CreateFoodEventInput,
  type CreateFoodEventItem,
  type CreateMealOutcome,
  type EstimateSource,
  type FoodEvent,
  type FoodEventItem,
  type FoodEventItemRole,
  type FoodEventSource,
  type FoodEventType,
  type MealOutcome,
  type UpdateFoodEvent,
} from '../schemas/index';
import * as foodSchema from '../db/schema/index';
import { FoodEventNotFoundError } from './errors';

export interface FoodEventWithDetails extends FoodEvent {
  items: FoodEventItem[];
  outcome: MealOutcome | null;
}

export interface ListFoodEventsOptions {
  from?: string;
  to?: string;
  eventType?: FoodEventType;
  limit?: number;
}

export interface FoodEventService {
  create(userId: string, input: CreateFoodEventInput): Promise<FoodEventWithDetails>;
  list(userId: string, options?: ListFoodEventsOptions): Promise<FoodEventWithDetails[]>;
  getById(userId: string, id: string): Promise<FoodEventWithDetails>;
  update(userId: string, id: string, patch: UpdateFoodEvent): Promise<FoodEventWithDetails>;
  addItems(userId: string, id: string, items: CreateFoodEventItem[]): Promise<FoodEventWithDetails>;
  logOutcome(userId: string, id: string, outcome: CreateMealOutcome): Promise<MealOutcome>;
}

export interface FoodEventServiceDeps {
  db: Db;
  clock?: Clock;
}

export function createFoodEventService(deps: FoodEventServiceDeps): FoodEventService {
  const { db } = deps;
  const clock = deps.clock ?? systemClock;

  function rowToEvent(row: typeof foodSchema.foodEvent.$inferSelect): FoodEvent {
    return {
      id: row.id,
      userId: row.userId,
      eventType: row.eventType as FoodEventType,
      occurredAt: row.occurredAt,
      source: row.source as FoodEventSource,
      rawText: row.rawText,
      imageRefs: (row.imageRefs ?? null) as FoodEvent['imageRefs'],
      cravingText: row.cravingText,
      availableFoodContext: (row.availableFoodContext ?? null) as FoodEvent['availableFoodContext'],
      mealName: row.mealName,
      actualEaten: row.actualEaten,
      eatenByUser: row.eatenByUser,
      forPerson: row.forPerson,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  function rowToItem(row: typeof foodSchema.foodEventItem.$inferSelect): FoodEventItem {
    return {
      id: row.id,
      foodEventId: row.foodEventId,
      name: row.name,
      normalizedName: row.normalizedName,
      role: row.role as FoodEventItemRole,
      quantity: row.quantity,
      unit: row.unit,
      caloriesEstimated: row.caloriesEstimated,
      proteinGEstimated: row.proteinGEstimated,
      carbsGEstimated: row.carbsGEstimated,
      fatGEstimated: row.fatGEstimated,
      estimateConfidence: row.estimateConfidence,
      estimateSource: (row.estimateSource ?? null) as EstimateSource | null,
      createdAt: row.createdAt,
    };
  }

  function rowToOutcome(row: typeof foodSchema.mealOutcome.$inferSelect): MealOutcome {
    return {
      id: row.id,
      userId: row.userId,
      foodEventId: row.foodEventId,
      satisfactionScore: row.satisfactionScore,
      hungerAfter: row.hungerAfter,
      energyAfter: row.energyAfter,
      cravingsAfter: row.cravingsAfter,
      moodAfter: row.moodAfter,
      notes: row.notes,
      recipeCandidate: row.recipeCandidate,
      createdAt: row.createdAt,
    };
  }

  async function loadDetails(userId: string, eventId: string): Promise<FoodEventWithDetails> {
    const eventRows = await db
      .select()
      .from(foodSchema.foodEvent)
      .where(and(eq(foodSchema.foodEvent.id, eventId), eq(foodSchema.foodEvent.userId, userId)))
      .limit(1)
      .all();
    const eventRow = eventRows[0];
    if (!eventRow) throw new FoodEventNotFoundError(eventId);
    const items = await db
      .select()
      .from(foodSchema.foodEventItem)
      .where(eq(foodSchema.foodEventItem.foodEventId, eventId))
      .orderBy(asc(foodSchema.foodEventItem.createdAt))
      .all();
    const outcomeRows = await db
      .select()
      .from(foodSchema.mealOutcome)
      .where(eq(foodSchema.mealOutcome.foodEventId, eventId))
      .limit(1)
      .all();
    return {
      ...rowToEvent(eventRow),
      items: items.map(rowToItem),
      outcome: outcomeRows[0] ? rowToOutcome(outcomeRows[0]) : null,
    };
  }

  async function insertItems(eventId: string, items: CreateFoodEventItem[], now: string) {
    for (const item of items) {
      await db.insert(foodSchema.foodEventItem).values({
        id: newId('fei'),
        foodEventId: eventId,
        name: item.name,
        normalizedName: normalizeName(item.name),
        role: item.role,
        quantity: item.quantity ?? null,
        unit: item.unit ?? null,
        caloriesEstimated: item.caloriesEstimated ?? null,
        proteinGEstimated: item.proteinGEstimated ?? null,
        carbsGEstimated: item.carbsGEstimated ?? null,
        fatGEstimated: item.fatGEstimated ?? null,
        estimateConfidence: item.estimateConfidence ?? null,
        estimateSource: item.estimateSource ?? null,
        createdAt: now,
      });
    }
  }

  return {
    async create(userId, rawInput) {
      const input = createFoodEventSchema.parse(rawInput);
      const id = newId('fev');
      const now = nowIso(clock);
      await db.insert(foodSchema.foodEvent).values({
        id,
        userId,
        eventType: input.eventType,
        occurredAt: input.occurredAt ?? now,
        source: input.source,
        rawText: input.rawText ?? null,
        imageRefs: input.imageRefs ?? null,
        cravingText: input.cravingText ?? null,
        availableFoodContext: input.availableFoodContext ?? null,
        mealName: input.mealName ?? null,
        actualEaten: input.actualEaten ?? null,
        eatenByUser: input.eatenByUser ?? null,
        forPerson: input.forPerson ?? null,
        notes: input.notes ?? null,
        createdAt: now,
        updatedAt: now,
      });
      if (input.items.length > 0) {
        await insertItems(id, input.items, now);
      }
      return loadDetails(userId, id);
    },

    async list(userId, options = {}) {
      const conditions = [eq(foodSchema.foodEvent.userId, userId)];
      if (options.from !== undefined)
        conditions.push(gte(foodSchema.foodEvent.occurredAt, options.from));
      if (options.to !== undefined)
        conditions.push(lte(foodSchema.foodEvent.occurredAt, options.to));
      if (options.eventType !== undefined)
        conditions.push(eq(foodSchema.foodEvent.eventType, options.eventType));
      const limit = options.limit ?? 100;
      const eventRows = await db
        .select()
        .from(foodSchema.foodEvent)
        .where(and(...conditions))
        .orderBy(desc(foodSchema.foodEvent.occurredAt))
        .limit(limit)
        .all();
      const results: FoodEventWithDetails[] = [];
      for (const row of eventRows) {
        results.push(await loadDetails(userId, row.id));
      }
      return results;
    },

    async getById(userId, id) {
      return loadDetails(userId, id);
    },

    async update(userId, id, patch) {
      const existing = await loadDetails(userId, id);
      const now = nowIso(clock);
      const updateValues: Partial<typeof foodSchema.foodEvent.$inferInsert> = { updatedAt: now };
      if (patch.eventType !== undefined) updateValues.eventType = patch.eventType;
      if (patch.occurredAt !== undefined) updateValues.occurredAt = patch.occurredAt;
      if (patch.source !== undefined) updateValues.source = patch.source;
      if (patch.rawText !== undefined) updateValues.rawText = patch.rawText;
      if (patch.imageRefs !== undefined) updateValues.imageRefs = patch.imageRefs;
      if (patch.cravingText !== undefined) updateValues.cravingText = patch.cravingText;
      if (patch.availableFoodContext !== undefined)
        updateValues.availableFoodContext = patch.availableFoodContext;
      if (patch.mealName !== undefined) updateValues.mealName = patch.mealName;
      if (patch.actualEaten !== undefined) updateValues.actualEaten = patch.actualEaten;
      if (patch.eatenByUser !== undefined) updateValues.eatenByUser = patch.eatenByUser;
      if (patch.forPerson !== undefined) updateValues.forPerson = patch.forPerson;
      if (patch.notes !== undefined) updateValues.notes = patch.notes;
      await db
        .update(foodSchema.foodEvent)
        .set(updateValues)
        .where(and(eq(foodSchema.foodEvent.id, id), eq(foodSchema.foodEvent.userId, userId)));
      if (patch.items && patch.items.length > 0) {
        await insertItems(existing.id, patch.items, now);
      }
      return loadDetails(userId, id);
    },

    async addItems(userId, id, items) {
      const existing = await loadDetails(userId, id);
      const now = nowIso(clock);
      await insertItems(existing.id, items, now);
      await db
        .update(foodSchema.foodEvent)
        .set({ updatedAt: now })
        .where(eq(foodSchema.foodEvent.id, id));
      return loadDetails(userId, id);
    },

    async logOutcome(userId, id, outcome) {
      await loadDetails(userId, id); // existence check
      const existing = await db
        .select()
        .from(foodSchema.mealOutcome)
        .where(eq(foodSchema.mealOutcome.foodEventId, id))
        .limit(1)
        .all();
      const now = nowIso(clock);
      if (existing[0]) {
        await db
          .update(foodSchema.mealOutcome)
          .set({
            satisfactionScore: outcome.satisfactionScore ?? null,
            hungerAfter: outcome.hungerAfter ?? null,
            energyAfter: outcome.energyAfter ?? null,
            cravingsAfter: outcome.cravingsAfter ?? null,
            moodAfter: outcome.moodAfter ?? null,
            notes: outcome.notes ?? null,
            recipeCandidate: outcome.recipeCandidate ?? false,
          })
          .where(eq(foodSchema.mealOutcome.id, existing[0].id));
      } else {
        await db.insert(foodSchema.mealOutcome).values({
          id: newId('out'),
          userId,
          foodEventId: id,
          satisfactionScore: outcome.satisfactionScore ?? null,
          hungerAfter: outcome.hungerAfter ?? null,
          energyAfter: outcome.energyAfter ?? null,
          cravingsAfter: outcome.cravingsAfter ?? null,
          moodAfter: outcome.moodAfter ?? null,
          notes: outcome.notes ?? null,
          recipeCandidate: outcome.recipeCandidate ?? false,
          createdAt: now,
        });
      }
      const fresh = await loadDetails(userId, id);
      if (!fresh.outcome) throw new Error('outcome vanished after upsert');
      return fresh.outcome;
    },
  };
}
