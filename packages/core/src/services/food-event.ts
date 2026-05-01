import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { newId, schema } from '@pantrymind/db';
import type { Db } from '@pantrymind/db';
import type {
  CreateFoodEvent,
  CreateFoodEventItem,
  CreateMealOutcome,
  EstimateSource,
  FoodEvent,
  FoodEventItem,
  FoodEventItemRole,
  FoodEventSource,
  FoodEventType,
  MealOutcome,
  UpdateFoodEvent,
} from '@pantrymind/schemas';
import { normalizeName } from '../util/normalize';
import { nowIso, systemClock, type Clock } from '../util/time';
import type { ProfileService } from './profile';

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
  create(input: CreateFoodEvent): Promise<FoodEventWithDetails>;
  list(options?: ListFoodEventsOptions): Promise<FoodEventWithDetails[]>;
  getById(id: string): Promise<FoodEventWithDetails>;
  update(id: string, patch: UpdateFoodEvent): Promise<FoodEventWithDetails>;
  addItems(id: string, items: CreateFoodEventItem[]): Promise<FoodEventWithDetails>;
  logOutcome(id: string, outcome: CreateMealOutcome): Promise<MealOutcome>;
}

export interface FoodEventServiceDeps {
  db: Db;
  profile: ProfileService;
  clock?: Clock;
}

export function createFoodEventService(
  deps: FoodEventServiceDeps | Db,
): FoodEventService {
  const concrete: FoodEventServiceDeps =
    'db' in deps && 'profile' in deps
      ? deps
      : ({ db: deps as Db, profile: undefined as unknown as ProfileService });
  const { db } = concrete;
  const clock = concrete.clock ?? systemClock;

  function requireProfile(): ProfileService {
    if (!concrete.profile) {
      throw new Error('FoodEventService missing ProfileService dependency');
    }
    return concrete.profile;
  }

  async function userId(): Promise<string> {
    return (await requireProfile().getCurrentProfile()).id;
  }

  function rowToEvent(row: typeof schema.foodEvent.$inferSelect): FoodEvent {
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

  function rowToItem(row: typeof schema.foodEventItem.$inferSelect): FoodEventItem {
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

  function rowToOutcome(row: typeof schema.mealOutcome.$inferSelect): MealOutcome {
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

  async function loadDetails(eventId: string, uid: string): Promise<FoodEventWithDetails> {
    const eventRows = await db
      .select()
      .from(schema.foodEvent)
      .where(and(eq(schema.foodEvent.id, eventId), eq(schema.foodEvent.userId, uid)))
      .limit(1)
      .all();
    const eventRow = eventRows[0];
    if (!eventRow) throw new FoodEventNotFoundError(eventId);

    const items = await db
      .select()
      .from(schema.foodEventItem)
      .where(eq(schema.foodEventItem.foodEventId, eventId))
      .orderBy(asc(schema.foodEventItem.createdAt))
      .all();

    const outcomeRows = await db
      .select()
      .from(schema.mealOutcome)
      .where(eq(schema.mealOutcome.foodEventId, eventId))
      .limit(1)
      .all();
    const outcomeRow = outcomeRows[0];

    return {
      ...rowToEvent(eventRow),
      items: items.map(rowToItem),
      outcome: outcomeRow ? rowToOutcome(outcomeRow) : null,
    };
  }

  async function insertItems(eventId: string, items: CreateFoodEventItem[], now: string) {
    for (const item of items) {
      await db.insert(schema.foodEventItem).values({
        id: newId('foodEventItem'),
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
    async create(input) {
      const uid = await userId();
      const now = nowIso(clock);
      const id = newId('foodEvent');
      await db.insert(schema.foodEvent).values({
        id,
        userId: uid,
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
      return loadDetails(id, uid);
    },

    async list(options = {}) {
      const uid = await userId();
      const conditions = [eq(schema.foodEvent.userId, uid)];
      if (options.from !== undefined) {
        conditions.push(gte(schema.foodEvent.occurredAt, options.from));
      }
      if (options.to !== undefined) {
        conditions.push(lte(schema.foodEvent.occurredAt, options.to));
      }
      if (options.eventType !== undefined) {
        conditions.push(eq(schema.foodEvent.eventType, options.eventType));
      }
      const limit = options.limit ?? 100;
      const eventRows = await db
        .select()
        .from(schema.foodEvent)
        .where(and(...conditions))
        .orderBy(desc(schema.foodEvent.occurredAt))
        .limit(limit)
        .all();

      const results: FoodEventWithDetails[] = [];
      for (const row of eventRows) {
        results.push(await loadDetails(row.id, uid));
      }
      return results;
    },

    async getById(id) {
      const uid = await userId();
      return loadDetails(id, uid);
    },

    async update(id, patch) {
      const uid = await userId();
      const existing = await loadDetails(id, uid);
      const now = nowIso(clock);
      const updateValues: Partial<typeof schema.foodEvent.$inferInsert> = { updatedAt: now };
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
        .update(schema.foodEvent)
        .set(updateValues)
        .where(and(eq(schema.foodEvent.id, id), eq(schema.foodEvent.userId, uid)));

      if (patch.items && patch.items.length > 0) {
        await insertItems(existing.id, patch.items, now);
      }
      return loadDetails(id, uid);
    },

    async addItems(id, items) {
      const uid = await userId();
      const existing = await loadDetails(id, uid);
      const now = nowIso(clock);
      await insertItems(existing.id, items, now);
      await db
        .update(schema.foodEvent)
        .set({ updatedAt: now })
        .where(eq(schema.foodEvent.id, id));
      return loadDetails(id, uid);
    },

    async logOutcome(id, outcome) {
      const uid = await userId();
      await loadDetails(id, uid); // existence check
      const existingOutcome = await db
        .select()
        .from(schema.mealOutcome)
        .where(eq(schema.mealOutcome.foodEventId, id))
        .limit(1)
        .all();
      const now = nowIso(clock);
      if (existingOutcome[0]) {
        await db
          .update(schema.mealOutcome)
          .set({
            satisfactionScore: outcome.satisfactionScore ?? null,
            hungerAfter: outcome.hungerAfter ?? null,
            energyAfter: outcome.energyAfter ?? null,
            cravingsAfter: outcome.cravingsAfter ?? null,
            moodAfter: outcome.moodAfter ?? null,
            notes: outcome.notes ?? null,
            recipeCandidate: outcome.recipeCandidate ?? false,
          })
          .where(eq(schema.mealOutcome.id, existingOutcome[0].id));
      } else {
        await db.insert(schema.mealOutcome).values({
          id: newId('outcome'),
          userId: uid,
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
      const fresh = await loadDetails(id, uid);
      if (!fresh.outcome) throw new Error('outcome vanished after upsert');
      return fresh.outcome;
    },
  };
}

export class FoodEventNotFoundError extends Error {
  readonly code = 'food_event_not_found' as const;
  constructor(public readonly id: string) {
    super(`food event ${id} not found`);
  }
}
