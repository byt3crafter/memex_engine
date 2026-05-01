import { and, desc, eq } from 'drizzle-orm';
import { newId, type Db } from '@memex/db';
import { CARD_SCHEMA_VERSION } from '@memex/schemas';
import { type Clock, isoDateOnly, normalizeName, nowIso, systemClock } from '@memex/kernel';
import {
  type MenuPlan,
  type MenuPlanItem,
  type ShoppingGap,
  type SuggestMenuInput,
} from '../schemas/index';
import * as foodSchema from '../db/schema/index';
import { MenuPlanNotFoundError } from './errors';
import type { PantryService } from './pantry';
import type { RecipeService } from './recipe';

export interface MenuService {
  suggest(userId: string, input: SuggestMenuInput): Promise<MenuPlan>;
  list(userId: string): Promise<MenuPlan[]>;
  getById(userId: string, id: string): Promise<MenuPlan>;
}

export interface MenuServiceDeps {
  db: Db;
  pantry: PantryService;
  recipes: RecipeService;
  clock?: Clock;
}

export function createMenuService(deps: MenuServiceDeps): MenuService {
  const { db, pantry, recipes } = deps;
  const clock = deps.clock ?? systemClock;

  function rowToMenu(row: typeof foodSchema.menuPlan.$inferSelect): MenuPlan {
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
    async suggest(userId, input) {
      const days = input.days;
      const pantryList = (await pantry.list(userId, { isAvailable: true })).filter(
        (p) => p.isAvailable,
      );
      const pantrySet = new Set(pantryList.map((p) => p.normalizedName));
      const recipesList = await recipes.list(userId);

      const startDate = isoDateOnly(clock());
      const endDateD = new Date(`${startDate}T00:00:00.000Z`);
      endDateD.setUTCDate(endDateD.getUTCDate() + days - 1);
      const endDate = isoDateOnly(endDateD);

      const scored = recipesList.map((r) => {
        const required = r.ingredients.filter((i) => !i.optional);
        const matched = required.filter((i) => pantrySet.has(normalizeName(i.name))).length;
        const overlap = required.length === 0 ? 0.5 : matched / required.length;
        return { recipe: r, score: overlap };
      });
      scored.sort((a, b) => b.score - a.score);

      const slots: ('lunch' | 'dinner')[] = ['lunch', 'dinner'];
      const items: MenuPlanItem[] = [];
      const usedRecipeIds = new Set<string>();
      const cursor = new Date(`${startDate}T00:00:00.000Z`);
      for (let day = 0; day < days; day++) {
        const dateIso = isoDateOnly(cursor);
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
        cursor.setUTCDate(cursor.getUTCDate() + 1);
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

      const id = newId('mnu');
      const title = `Menu for ${days} day(s) starting ${startDate}`;
      const card = {
        cardSchemaVersion: CARD_SCHEMA_VERSION,
        type: 'food.menu',
        module: 'food',
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
          {
            id: 'add_to_shopping_list',
            label: 'Add gaps to shopping list',
            kind: 'add_to_shopping_list',
            payload: { items: shoppingGaps.map((g) => g.name) },
          },
        ],
      };

      const now = nowIso(clock);
      await db.insert(foodSchema.menuPlan).values({
        id,
        userId,
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
        .from(foodSchema.menuPlan)
        .where(and(eq(foodSchema.menuPlan.id, id), eq(foodSchema.menuPlan.userId, userId)))
        .limit(1)
        .all();
      const row = rows[0];
      if (!row) throw new Error('menu_plan disappeared after insert');
      return rowToMenu(row);
    },

    async list(userId) {
      const rows = await db
        .select()
        .from(foodSchema.menuPlan)
        .where(eq(foodSchema.menuPlan.userId, userId))
        .orderBy(desc(foodSchema.menuPlan.createdAt))
        .all();
      return rows.map(rowToMenu);
    },

    async getById(userId, id) {
      const rows = await db
        .select()
        .from(foodSchema.menuPlan)
        .where(and(eq(foodSchema.menuPlan.id, id), eq(foodSchema.menuPlan.userId, userId)))
        .limit(1)
        .all();
      const row = rows[0];
      if (!row) throw new MenuPlanNotFoundError(id);
      return rowToMenu(row);
    },
  };
}
