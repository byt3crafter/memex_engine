/**
 * Card payload schemas Demeter contributes to the kernel's
 * CardSchemaRegistry. The kernel builds a runtime view of all card
 * types across modules; renderers (web components, MCP) consult the
 * registry to validate and pick the right element.
 */
import { baseCardSchema, CARD_SCHEMA_VERSION } from '@memex/schemas';
import type { CardSchemaContribution } from '@memex/kernel';
import { z } from 'zod';

const mealRecommendationCardSchema = baseCardSchema.extend({
  cardSchemaVersion: z.literal(CARD_SCHEMA_VERSION),
  type: z.literal('food.meal_recommendation'),
  module: z.literal('food'),
  title: z.string().min(1),
  whyThisMeal: z.string().min(1),
  ingredientsUsed: z.array(z.string()).default([]),
  ingredientsMissing: z.array(z.string()).default([]),
  proteinSource: z.string().nullable().optional(),
  prepTimeMinutes: z.number().int().nonnegative().nullable().optional(),
  caloriesEstimated: z.number().nonnegative().nullable().optional(),
  proteinGEstimated: z.number().nonnegative().nullable().optional(),
  carbsGEstimated: z.number().nonnegative().nullable().optional(),
  fatGEstimated: z.number().nonnegative().nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  alternatives: z.array(z.string()).default([]),
  recommendationId: z.string().min(1).optional(),
  optionIndex: z.number().int().nonnegative().optional(),
});

const menuCardSchema = baseCardSchema.extend({
  cardSchemaVersion: z.literal(CARD_SCHEMA_VERSION),
  type: z.literal('food.menu'),
  module: z.literal('food'),
  title: z.string().min(1),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  meals: z
    .array(
      z.object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        slot: z.string().optional(),
        title: z.string().min(1),
        recipeId: z.string().nullable().optional(),
      }),
    )
    .default([]),
  shoppingGaps: z.array(z.string()).default([]),
  prepNotes: z.string().nullable().optional(),
});

export const foodCardContributions: CardSchemaContribution[] = [
  { type: 'food.meal_recommendation', module: 'food', schema: mealRecommendationCardSchema },
  { type: 'food.menu', module: 'food', schema: menuCardSchema },
];
