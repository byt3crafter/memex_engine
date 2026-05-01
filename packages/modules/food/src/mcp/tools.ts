/**
 * Demeter's MCP tool contributions. The kernel's MCP server iterates
 * kernel.modules.list() and registers these alongside other modules'
 * tools.
 *
 * Every handler runs in a McpHandlerContext that already carries the
 * resolved userId — kernel auth happens at the server boundary, so
 * tools never receive a bearer token directly.
 */
import type { McpToolContribution } from '@memex/kernel';
import { z } from 'zod';
import {
  bulkPantryUpdateSchema,
  createFoodEventSchema,
  createMealOutcomeSchema,
  createPantryItemSchema,
  createRecipeSchema,
  createRecommendationSchema,
  pantryCategorySchema,
  suggestMenuSchema,
} from '../schemas/index';
import type { FoodServices } from '../services/index';

const json = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] });

const updatePantryInputSchema = z.object({
  items: z.array(createPantryItemSchema).min(1).max(500),
  replace: z.boolean().default(false),
});

const listAvailableFoodInputSchema = z.object({
  category: pantryCategorySchema.optional(),
  search: z.string().min(1).optional(),
});

const recommendMealInputSchema = createRecommendationSchema;

const logFoodEventInputSchema = createFoodEventSchema;

const logActualMealInputSchema = createFoodEventSchema.omit({ eventType: true }).extend({
  recommendationId: z.string().optional(),
});

const logMealOutcomeInputSchema = createMealOutcomeSchema;

/**
 * save_recipe — flat object schema (no z.union) so the MCP SDK gets a
 * clean shape for the tool listing. Two modes:
 *   - { fromFoodEventId, ...overrides } promotes a logged meal
 *   - { title, ingredients, ... } creates a fresh recipe
 */
const saveRecipeInputSchema = z.object({
  fromFoodEventId: z.string().optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  ingredients: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        quantity: z.number().nonnegative().optional(),
        unit: z.string().max(40).optional(),
        optional: z.boolean().default(false),
      }),
    )
    .optional(),
  steps: z
    .array(
      z.object({
        order: z.number().int().nonnegative(),
        text: z.string().min(1),
      }),
    )
    .optional(),
  tags: z.array(z.string()).optional(),
  proteinSource: z.string().optional(),
  estimatedCalories: z.number().nonnegative().optional(),
  estimatedProteinG: z.number().nonnegative().optional(),
  personalRating: z.number().int().min(1).max(5).optional(),
});

const listRecipesInputSchema = z.object({
  includeInactive: z.boolean().default(false),
  tag: z.string().min(1).optional(),
  ingredient: z.string().min(1).optional(),
});

const suggestMenuInputSchema = suggestMenuSchema;

export function buildFoodMcpTools(services: FoodServices): McpToolContribution[] {
  return [
    {
      name: 'update_pantry',
      description:
        "Replace or merge the user's available pantry. Use replace:true after a fridge/photo scan; replace:false (default) to add or update items.",
      inputSchema: updatePantryInputSchema,
      handler: async (raw, ctx) => {
        const input = updatePantryInputSchema.parse(raw);
        const result = await services.pantry.bulkUpdate(ctx.userId, {
          items: input.items,
          replace: input.replace,
        });
        return json({
          result,
          summary: `${result.created} added, ${result.updated} updated, ${result.deleted} removed (now ${result.totalAfter} items)`,
        });
      },
    },
    {
      name: 'list_available_food',
      description:
        "List the user's currently-available pantry items. Optional category filter (protein/carb/vegetable/...) and search term.",
      inputSchema: listAvailableFoodInputSchema,
      handler: async (raw, ctx) => {
        const input = listAvailableFoodInputSchema.parse(raw);
        const items = await services.pantry.list(ctx.userId, {
          isAvailable: true,
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.search !== undefined ? { search: input.search } : {}),
        });
        const grouped: Record<
          string,
          { name: string; quantity: number | null; unit: string | null }[]
        > = {};
        for (const item of items) {
          (grouped[item.category] ??= []).push({
            name: item.name,
            quantity: item.quantity,
            unit: item.unit,
          });
        }
        return json({ count: items.length, byCategory: grouped, items });
      },
    },
    {
      name: 'recommend_meal',
      description:
        "Recommend 1–3 meals based on the user's available pantry, recent meals, and outcome history. Returns a meal_recommendation card. Pure deterministic engine v1 — no LLM. Honors cravingText and preferredProtein.",
      inputSchema: recommendMealInputSchema,
      handler: async (raw, ctx) => {
        const input = recommendMealInputSchema.parse(raw);
        const reco = await services.recommendations.recommendMeal(ctx.userId, input);
        return json({ recommendation: reco, card: reco.card });
      },
    },
    {
      name: 'log_food_event',
      description:
        'Append a food event to the log. Use this for cravings, snacks, drinks, recipe candidates, or notes. For an actual meal use log_actual_meal.',
      inputSchema: logFoodEventInputSchema,
      handler: async (raw, ctx) => {
        const input = logFoodEventInputSchema.parse(raw);
        const ev = await services.foodEvents.create(ctx.userId, input);
        return json({ event: ev });
      },
    },
    {
      name: 'log_actual_meal',
      description:
        'Log what the user actually ate. Items array describes ingredients with roles (protein/carb/vegetable/...). Optionally references a recommendationId so the engine can correlate suggestions with eaten meals.',
      inputSchema: logActualMealInputSchema,
      handler: async (raw, ctx) => {
        const input = logActualMealInputSchema.parse(raw);
        const ev = await services.foodEvents.create(ctx.userId, {
          ...input,
          eventType: 'actual_meal',
          ...(input.recommendationId
            ? { notes: `${input.notes ?? ''}\n{"recipeId":"${input.recommendationId}"}` }
            : {}),
        });
        return json({
          event: ev,
          hint: 'Now ask the user for an outcome (satisfaction, energy, hunger after) and call log_meal_outcome.',
        });
      },
    },
    {
      name: 'log_meal_outcome',
      description:
        'Record how the user felt after a meal. Drives the outcome→pattern loop. satisfactionScore/hungerAfter/energyAfter on a 1–5 scale.',
      inputSchema: logMealOutcomeInputSchema,
      handler: async (raw, ctx) => {
        const input = logMealOutcomeInputSchema.parse(raw);
        const outcome = await services.foodEvents.logOutcome(ctx.userId, input.foodEventId, input);
        return json({
          outcome,
          recipeCandidate: outcome.recipeCandidate,
          hint: outcome.recipeCandidate
            ? 'This meal worked well. Ask the user if they want to save_recipe.'
            : null,
        });
      },
    },
    {
      name: 'save_recipe',
      description:
        'Save a meal as a reusable recipe. Either pass fromFoodEventId to promote a logged meal (best path), or a full recipe object for a fresh entry. Recipes power future menu suggestions and recommendation boosts.',
      inputSchema: saveRecipeInputSchema,
      handler: async (raw, ctx) => {
        const input = saveRecipeInputSchema.parse(raw);
        if (input.fromFoodEventId !== undefined) {
          const overrides: {
            title?: string;
            description?: string;
            tags?: string[];
            proteinSource?: string;
          } = {};
          if (input.title !== undefined) overrides.title = input.title;
          if (input.description !== undefined) overrides.description = input.description;
          if (input.tags !== undefined) overrides.tags = input.tags;
          if (input.proteinSource !== undefined) overrides.proteinSource = input.proteinSource;
          const recipe = await services.recipes.promoteFromFoodEvent(
            ctx.userId,
            input.fromFoodEventId,
            overrides,
          );
          return json({ recipe, promotedFrom: input.fromFoodEventId });
        }
        if (input.title === undefined) {
          throw new Error(
            'save_recipe requires either fromFoodEventId or title for a fresh recipe',
          );
        }
        const recipeInput: Parameters<typeof services.recipes.create>[1] = { title: input.title };
        if (input.description !== undefined) recipeInput.description = input.description;
        if (input.ingredients !== undefined) recipeInput.ingredients = input.ingredients;
        if (input.steps !== undefined) recipeInput.steps = input.steps;
        if (input.tags !== undefined) recipeInput.tags = input.tags;
        if (input.proteinSource !== undefined) recipeInput.proteinSource = input.proteinSource;
        if (input.estimatedCalories !== undefined)
          recipeInput.estimatedCalories = input.estimatedCalories;
        if (input.estimatedProteinG !== undefined)
          recipeInput.estimatedProteinG = input.estimatedProteinG;
        if (input.personalRating !== undefined) recipeInput.personalRating = input.personalRating;
        const recipe = await services.recipes.create(ctx.userId, recipeInput);
        return json({ recipe });
      },
    },
    {
      name: 'list_recipes',
      description:
        "List the user's saved recipes. Filter by tag or ingredient. By default excludes soft-deleted recipes; pass includeInactive:true for full history.",
      inputSchema: listRecipesInputSchema,
      handler: async (raw, ctx) => {
        const input = listRecipesInputSchema.parse(raw);
        const recipes = await services.recipes.list(ctx.userId, {
          includeInactive: input.includeInactive,
          ...(input.tag !== undefined ? { tag: input.tag } : {}),
          ...(input.ingredient !== undefined ? { ingredient: input.ingredient } : {}),
        });
        return json({ count: recipes.length, recipes });
      },
    },
    {
      name: 'suggest_menu',
      description:
        'Generate an N-day menu (default 3, max 14) ranked by pantry-overlap. Returns a menu card with shopping gaps the user is missing.',
      inputSchema: suggestMenuInputSchema,
      handler: async (raw, ctx) => {
        const input = suggestMenuInputSchema.parse(raw);
        const menu = await services.menus.suggest(ctx.userId, input);
        return json({ menu, card: menu.card });
      },
    },
    {
      name: 'get_recent_patterns',
      description:
        "Surface outcome-derived insights from the user's recent meals: protein↔energy correlation, unpromoted recipe candidates, variety drop, top satisfying meals, craving outcomes, activity drop-off. Each insight has evidenceCount + confidence + actionable detail.",
      inputSchema: z.object({ days: z.number().int().min(1).max(90).default(30) }),
      handler: async (raw, ctx) => {
        const input = z.object({ days: z.number().int().min(1).max(90).default(30) }).parse(raw);
        const insights = await services.patterns.recentInsights(ctx.userId, input.days);
        return json({ days: input.days, insightCount: insights.length, insights });
      },
    },
    {
      name: 'get_weekly_review',
      description:
        "One-week reflection: meals logged, outcome insights surfaced, recipe candidates not yet saved. Ideal for a Sunday-night check-in or to seed the next week's planning.",
      inputSchema: z.object({}),
      handler: async (_raw, ctx) => {
        const review = await services.patterns.weeklyReview(ctx.userId);
        return json({ review });
      },
    },
  ];
}
