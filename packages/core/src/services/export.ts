import { eq } from 'drizzle-orm';
import { schema } from '@pantrymind/db';
import type { Db } from '@pantrymind/db';
import type {
  ExerciseEvent,
  FoodEvent,
  FoodEventItem,
  MealOutcome,
  Measurement,
  MenuPlan,
  PantryItem,
  Recipe,
  Recommendation,
  UserProfile,
} from '@pantrymind/schemas';
import { nowIso, systemClock, type Clock } from '../util/time';
import type { FoodEventService } from './food-event';
import type { MenuService } from './menu';
import type { PantryService } from './pantry';
import type { ProfileService } from './profile';
import type { RecipeService } from './recipe';

export interface ExportBundleFoodEvent {
  event: FoodEvent;
  items: FoodEventItem[];
  outcome: MealOutcome | null;
}

export interface ExportBundle {
  exportedAt: string;
  schemaVersion: 1;
  profile: UserProfile;
  pantry: PantryItem[];
  foodEvents: ExportBundleFoodEvent[];
  recipes: Recipe[];
  recommendations: Recommendation[];
  menus: MenuPlan[];
  measurements: Measurement[];
  exerciseEvents: ExerciseEvent[];
}

export interface ExportService {
  exportAll(): Promise<ExportBundle>;
}

export interface ExportServiceDeps {
  db: Db;
  profile: ProfileService;
  pantry: PantryService;
  foodEvent: FoodEventService;
  recipe: RecipeService;
  menu: MenuService;
  clock?: Clock;
}

export function createExportService(deps: ExportServiceDeps): ExportService {
  const { db } = deps;
  const clock = deps.clock ?? systemClock;

  return {
    async exportAll() {
      const profile = await deps.profile.getCurrentProfile();
      const pantry = await deps.pantry.list();
      const foodEvents = (await deps.foodEvent.list({ limit: 10_000 })).map((fe) => ({
        event: {
          id: fe.id,
          userId: fe.userId,
          eventType: fe.eventType,
          occurredAt: fe.occurredAt,
          source: fe.source,
          rawText: fe.rawText,
          imageRefs: fe.imageRefs,
          cravingText: fe.cravingText,
          availableFoodContext: fe.availableFoodContext,
          mealName: fe.mealName,
          actualEaten: fe.actualEaten,
          eatenByUser: fe.eatenByUser,
          forPerson: fe.forPerson,
          notes: fe.notes,
          createdAt: fe.createdAt,
          updatedAt: fe.updatedAt,
        } satisfies FoodEvent,
        items: fe.items,
        outcome: fe.outcome,
      }));
      const recipes = await deps.recipe.list({ includeInactive: true });
      const recRows = await db
        .select()
        .from(schema.recommendation)
        .where(eq(schema.recommendation.userId, profile.id))
        .all();
      const recommendations: Recommendation[] = recRows.map((row) => ({
        id: row.id,
        userId: row.userId,
        foodEventId: row.foodEventId,
        requestedAt: row.requestedAt,
        cravingText: row.cravingText,
        goalContext: (row.goalContext ?? null) as Recommendation['goalContext'],
        availableFoodSnapshot: (row.availableFoodSnapshot ??
          []) as Recommendation['availableFoodSnapshot'],
        engineVersion: row.engineVersion,
        recommendedTitle: row.recommendedTitle,
        recommendationReason: row.recommendationReason,
        options: (row.options ?? []) as Recommendation['options'],
        selectedOption: (row.selectedOption ?? null) as Recommendation['selectedOption'],
        card: row.card,
        createdAt: row.createdAt,
      }));
      const menus = await deps.menu.list();

      const measurementRows = await db
        .select()
        .from(schema.measurement)
        .where(eq(schema.measurement.userId, profile.id))
        .all();
      const measurements: Measurement[] = measurementRows.map((m) => ({
        id: m.id,
        userId: m.userId,
        type: m.type as Measurement['type'],
        value: m.value,
        unit: m.unit,
        measuredAt: m.measuredAt,
        notes: m.notes,
        createdAt: m.createdAt,
      }));

      const exerciseRows = await db
        .select()
        .from(schema.exerciseEvent)
        .where(eq(schema.exerciseEvent.userId, profile.id))
        .all();
      const exerciseEvents: ExerciseEvent[] = exerciseRows.map((e) => ({
        id: e.id,
        userId: e.userId,
        occurredAt: e.occurredAt,
        type: e.type as ExerciseEvent['type'],
        title: e.title,
        durationMinutes: e.durationMinutes,
        details: (e.details ?? {}) as Record<string, unknown>,
        difficulty: e.difficulty,
        painFlag: e.painFlag,
        notes: e.notes,
        createdAt: e.createdAt,
      }));

      return {
        exportedAt: nowIso(clock),
        schemaVersion: 1 as const,
        profile,
        pantry,
        foodEvents,
        recipes,
        recommendations,
        menus,
        measurements,
        exerciseEvents,
      };
    },
  };
}
