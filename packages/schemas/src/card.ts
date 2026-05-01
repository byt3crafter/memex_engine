/**
 * Renderable card payloads. Every domain action returns one. Schema is
 * versioned via `cardSchemaVersion` — never break renderers silently.
 * Bump the version when adding a card type or changing an existing field.
 */
import { z } from 'zod';
import { confidenceSchema, idSchema, isoDateTimeSchema } from './common.js';

export const CARD_SCHEMA_VERSION = 1 as const;

const baseCardSchema = z.object({
  cardSchemaVersion: z.literal(CARD_SCHEMA_VERSION),
  id: idSchema.optional(),
  createdAt: isoDateTimeSchema.optional(),
});

export const cardActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(60),
  kind: z.enum([
    'log_eaten',
    'save_recipe',
    'suggest_alternative',
    'add_to_shopping_list',
    'log_outcome',
    'open',
    'custom',
  ]),
  payload: z.record(z.unknown()).optional(),
});
export type CardAction = z.infer<typeof cardActionSchema>;

export const mealRecommendationCardSchema = baseCardSchema.extend({
  type: z.literal('meal_recommendation'),
  title: z.string().min(1).max(200),
  whyThisMeal: z.string().min(1),
  ingredientsUsed: z.array(z.string()).default([]),
  ingredientsMissing: z.array(z.string()).default([]),
  proteinSource: z.string().max(120).nullable().optional(),
  prepTimeMinutes: z.number().int().nonnegative().nullable().optional(),
  caloriesEstimated: z.number().nonnegative().nullable().optional(),
  proteinGEstimated: z.number().nonnegative().nullable().optional(),
  carbsGEstimated: z.number().nonnegative().nullable().optional(),
  fatGEstimated: z.number().nonnegative().nullable().optional(),
  confidence: confidenceSchema.optional(),
  alternatives: z.array(z.string()).default([]),
  recommendationId: idSchema.optional(),
  optionIndex: z.number().int().nonnegative().optional(),
  actions: z.array(cardActionSchema).default([]),
});
export type MealRecommendationCard = z.infer<typeof mealRecommendationCardSchema>;

export const foodEventCardSchema = baseCardSchema.extend({
  type: z.literal('food_event'),
  title: z.string().min(1).max(200),
  occurredAt: isoDateTimeSchema,
  ingredients: z.array(z.string()).default([]),
  proteinSource: z.string().max(120).nullable().optional(),
  portion: z.string().max(120).nullable().optional(),
  caloriesEstimated: z.number().nonnegative().nullable().optional(),
  proteinGEstimated: z.number().nonnegative().nullable().optional(),
  outcomePending: z.boolean().default(true),
  recipeCandidate: z.boolean().default(false),
  notes: z.string().nullable().optional(),
  actions: z.array(cardActionSchema).default([]),
});
export type FoodEventCard = z.infer<typeof foodEventCardSchema>;

export const recipeCardSchema = baseCardSchema.extend({
  type: z.literal('recipe'),
  title: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  ingredients: z.array(z.string()).default([]),
  steps: z.array(z.string()).default([]),
  proteinSource: z.string().max(120).nullable().optional(),
  tags: z.array(z.string()).default([]),
  estimatedCalories: z.number().nonnegative().nullable().optional(),
  personalRating: z.number().int().min(1).max(5).nullable().optional(),
  sourceFoodEventId: idSchema.nullable().optional(),
  actions: z.array(cardActionSchema).default([]),
});
export type RecipeCard = z.infer<typeof recipeCardSchema>;

export const menuCardSchema = baseCardSchema.extend({
  type: z.literal('menu'),
  title: z.string().min(1).max(200),
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
        title: z.string().min(1).max(200),
        recipeId: idSchema.nullable().optional(),
      }),
    )
    .default([]),
  shoppingGaps: z.array(z.string()).default([]),
  prepNotes: z.string().nullable().optional(),
  actions: z.array(cardActionSchema).default([]),
});
export type MenuCard = z.infer<typeof menuCardSchema>;

export const insightCardSchema = baseCardSchema.extend({
  type: z.literal('insight'),
  headline: z.string().min(1).max(200),
  detail: z.string().min(1),
  evidenceCount: z.number().int().nonnegative().default(0),
  confidence: confidenceSchema.optional(),
  tags: z.array(z.string()).default([]),
  actions: z.array(cardActionSchema).default([]),
});
export type InsightCard = z.infer<typeof insightCardSchema>;

export const weeklyReviewCardSchema = baseCardSchema.extend({
  type: z.literal('weekly_review'),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weekEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  summary: z.string().min(1),
  highlights: z.array(z.string()).default([]),
  insights: z.array(insightCardSchema).default([]),
  recipeCandidates: z.array(z.string()).default([]),
  actions: z.array(cardActionSchema).default([]),
});
export type WeeklyReviewCard = z.infer<typeof weeklyReviewCardSchema>;

export const cardSchema = z.discriminatedUnion('type', [
  mealRecommendationCardSchema,
  foodEventCardSchema,
  recipeCardSchema,
  menuCardSchema,
  insightCardSchema,
  weeklyReviewCardSchema,
]);
export type Card = z.infer<typeof cardSchema>;
