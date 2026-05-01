import { and, desc, eq } from 'drizzle-orm';
import { newId, schema } from '@pantrymind/db';
import type { Db } from '@pantrymind/db';
import {
  CARD_SCHEMA_VERSION,
  type MenuCard,
  type MenuPlan,
  type MenuPlanItem,
  type SuggestMenuInput,
  type ShoppingGap,
} from '@pantrymind/schemas';
import { isoDateOnly, nowIso, systemClock, type Clock } from '../util/time';
import { normalizeName } from '../util/normalize';
import type { PantryService } from './pantry';
import type { ProfileService } from './profile';
import type { RecipeService } from './recipe';

export interface MenuService {
  suggest(input: SuggestMenuInput): Promise<MenuPlan>;
  list(): Promise<MenuPlan[]>;
  getById(id: string): Promise<MenuPlan>;
}

export interface MenuServiceDeps {
  db: Db;
  profile: ProfileService;
  pantry: PantryService;
  recipe: RecipeService;
  clock?: Clock;
}

export function createMenuService(deps: MenuServiceDeps | Db): MenuService {
  const concrete: MenuServiceDeps =
    'db' in deps && 'profile' in deps
      ? deps
      : ({
          db: deps as Db,
          profile: undefined as unknown as ProfileService,
          pantry: undefined as unknown as PantryService,
          recipe: undefined as unknown as RecipeService,
        });
  const { db } = concrete;
  const clock = concrete.clock ?? systemClock;

  function reqs() {
    if (!concrete.profile || !concrete.pantry || !concrete.recipe) {
      throw new Error('MenuService missing dependencies');
    }
    return {
      profile: concrete.profile,
      pantry: concrete.pantry,
      recipe: concrete.recipe,
    };
  }
  async function userId(): Promise<string> {
    return (await reqs().profile.getCurrentProfile()).id;
  }

  function rowToMenu(row: typeof schema.menuPlan.$inferSelect): MenuPlan {
    return {
      id: row.id,
      userId: row.userId,
      title: row.title,
      startDate: row.startDate,
      endDate: row.endDate,
      generatedFrom: row.generatedFrom as MenuPlan['generatedFrom'],
      items: (row.items ?? []) as MenuPlanItem[],
      shoppingGaps: (row.shoppingGaps ?? []) as ShoppingGap[],
      card: row.card,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  return {
    async suggest(input) {
      const uid = await userId();
      const pantry = (await reqs().pantry.list({ isAvailable: true })).filter((p) => p.isAvailable);
      const pantrySet = new Set(pantry.map((p) => p.normalizedName));
      const recipes = await reqs().recipe.list();

      const days = input.days;
      const startDate = isoDateOnly(clock());
      const endDateD = new Date(startDate + 'T00:00:00.000Z');
      endDateD.setUTCDate(endDateD.getUTCDate() + days - 1);
      const endDate = isoDateOnly(endDateD);

      type Scored = { recipe: (typeof recipes)[number]; score: number };
      const scored: Scored[] = recipes.map((r) => {
        const required = r.ingredients.filter((i) => !i.optional);
        const matched = required.filter((i) => pantrySet.has(normalizeName(i.name))).length;
        const overlap = required.length === 0 ? 0.5 : matched / required.length;
        return { recipe: r, score: overlap };
      });
      scored.sort((a, b) => b.score - a.score);

      const slots: ('lunch' | 'dinner')[] = ['lunch', 'dinner'];
      const items: MenuPlanItem[] = [];
      const usedRecipeIds = new Set<string>();
      const cursorDate = new Date(startDate + 'T00:00:00.000Z');
      for (let day = 0; day < days; day++) {
        const dateIso = isoDateOnly(cursorDate);
        for (const slot of slots) {
          const pick = scored.find((s) => !usedRecipeIds.has(s.recipe.id))?.recipe;
          if (!pick) continue;
          if (input.useAvailableFood && scored.length > slots.length) {
            usedRecipeIds.add(pick.id);
          }
          items.push({
            date: dateIso,
            slot,
            title: pick.title,
            recipeId: pick.id,
            ingredients: pick.ingredients.map((i) => i.name),
          });
        }
        cursorDate.setUTCDate(cursorDate.getUTCDate() + 1);
      }

      const demanded = new Map<string, ShoppingGap>();
      for (const it of items) {
        for (const ingName of it.ingredients) {
          const norm = normalizeName(ingName);
          if (pantrySet.has(norm)) continue;
          if (!demanded.has(norm)) {
            demanded.set(norm, { name: ingName, reason: `needed for ${it.title}` });
          }
        }
      }
      const shoppingGaps = Array.from(demanded.values());

      const id = newId('menu');
      const title = `Menu for ${days} day(s) starting ${startDate}`;
      const card: MenuCard = {
        cardSchemaVersion: CARD_SCHEMA_VERSION,
        type: 'menu',
        title,
        startDate,
        endDate,
        meals: items.map((i) => ({
          ...(i.date !== undefined ? { date: i.date } : {}),
          ...(i.slot !== undefined ? { slot: i.slot } : {}),
          title: i.title,
          recipeId: i.recipeId ?? null,
        })),
        shoppingGaps: shoppingGaps.map((g) => g.name),
        prepNotes: items.length === 0 ? 'No saved recipes yet — promote some meals first.' : null,
        actions: [
          { id: 'add_to_shopping_list', label: 'Add gaps to shopping list', kind: 'add_to_shopping_list', payload: { items: shoppingGaps.map((g) => g.name) } },
        ],
      };

      const now = nowIso(clock);
      await db.insert(schema.menuPlan).values({
        id,
        userId: uid,
        title,
        startDate,
        endDate,
        generatedFrom: input.useAvailableFood ? 'pantry' : 'recipes',
        items,
        shoppingGaps,
        card,
        createdAt: now,
        updatedAt: now,
      });

      const rows = await db
        .select()
        .from(schema.menuPlan)
        .where(and(eq(schema.menuPlan.id, id), eq(schema.menuPlan.userId, uid)))
        .limit(1)
        .all();
      const row = rows[0];
      if (!row) throw new Error('menu_plan disappeared after insert');
      return rowToMenu(row);
    },

    async list() {
      const uid = await userId();
      const rows = await db
        .select()
        .from(schema.menuPlan)
        .where(eq(schema.menuPlan.userId, uid))
        .orderBy(desc(schema.menuPlan.createdAt))
        .all();
      return rows.map(rowToMenu);
    },

    async getById(id) {
      const uid = await userId();
      const rows = await db
        .select()
        .from(schema.menuPlan)
        .where(and(eq(schema.menuPlan.id, id), eq(schema.menuPlan.userId, uid)))
        .limit(1)
        .all();
      const row = rows[0];
      if (!row) throw new MenuPlanNotFoundError(id);
      return rowToMenu(row);
    },
  };
}

export class MenuPlanNotFoundError extends Error {
  readonly code = 'menu_plan_not_found' as const;
  constructor(public readonly id: string) {
    super(`menu plan ${id} not found`);
  }
}
