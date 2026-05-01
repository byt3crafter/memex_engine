import { z } from 'zod';
import { confidenceSchema, idSchema, isoDateTimeSchema, jsonValueSchema } from '@memex/schemas';
import { createFoodEventItemSchema } from './food-event';

export const recommendationOptionSchema = z.object({
  title: z.string().min(1).max(200),
  reason: z.string().min(1),
  proteinSource: z.string().max(120).nullable().optional(),
  ingredientsUsed: z.array(z.string()).default([]),
  ingredientsMissing: z.array(z.string()).default([]),
  prepTimeMinutes: z.number().int().nonnegative().nullable().optional(),
  caloriesEstimated: z.number().nonnegative().nullable().optional(),
  proteinGEstimated: z.number().nonnegative().nullable().optional(),
  carbsGEstimated: z.number().nonnegative().nullable().optional(),
  fatGEstimated: z.number().nonnegative().nullable().optional(),
  confidence: confidenceSchema.optional(),
  recipeId: idSchema.nullable().optional(),
  items: z.array(createFoodEventItemSchema).default([]),
});
export type RecommendationOption = z.infer<typeof recommendationOptionSchema>;

export const recommendationSchema = z.object({
  id: idSchema,
  userId: idSchema,
  foodEventId: idSchema.nullable(),
  requestedAt: isoDateTimeSchema,
  cravingText: z.string().nullable(),
  goalContext: z.record(jsonValueSchema).nullable(),
  availableFoodSnapshot: z.array(jsonValueSchema),
  engineVersion: z.string().min(1),
  recommendedTitle: z.string().min(1).max(200),
  recommendationReason: z.string().min(1),
  options: z.array(recommendationOptionSchema).min(1).max(5),
  selectedOption: recommendationOptionSchema.nullable(),
  card: jsonValueSchema,
  createdAt: isoDateTimeSchema,
});
export type Recommendation = z.infer<typeof recommendationSchema>;

export const createRecommendationSchema = z.object({
  cravingText: z.string().optional(),
  goalContext: z.record(jsonValueSchema).optional(),
  constraints: z.record(jsonValueSchema).optional(),
  preferredProtein: z.string().optional(),
  maxOptions: z.number().int().min(1).max(5).default(3),
});
export type CreateRecommendation = z.infer<typeof createRecommendationSchema>;
export type CreateRecommendationInput = z.input<typeof createRecommendationSchema>;

export const selectRecommendationSchema = z.object({
  optionIndex: z.number().int().min(0),
});
export type SelectRecommendation = z.infer<typeof selectRecommendationSchema>;
