import { z } from 'zod';
import {
  confidenceSchema,
  idSchema,
  isoDateTimeSchema,
  jsonValueSchema,
  timestampsSchema,
} from '@memex/schemas';

export const foodEventTypeSchema = z.enum([
  'craving',
  'availability_update',
  'recommendation',
  'actual_meal',
  'purchase',
  'snack',
  'drink',
  'recipe_candidate',
  'note',
]);
export type FoodEventType = z.infer<typeof foodEventTypeSchema>;

export const foodEventSourceSchema = z.enum([
  'assistant',
  'api',
  'web',
  'import',
  'photo',
  'receipt',
]);
export type FoodEventSource = z.infer<typeof foodEventSourceSchema>;

export const foodEventItemRoleSchema = z.enum([
  'ingredient',
  'protein',
  'carb',
  'vegetable',
  'fruit',
  'fat',
  'sauce',
  'drink',
  'dessert',
  'snack',
  'other',
]);
export type FoodEventItemRole = z.infer<typeof foodEventItemRoleSchema>;

export const estimateSourceSchema = z.enum([
  'user',
  'ai_estimate',
  'nutrition_database',
  'unknown',
]);
export type EstimateSource = z.infer<typeof estimateSourceSchema>;

export const imageRefSchema = z.object({
  url: z.string().url().optional(),
  hash: z.string().optional(),
  mime: z.string().optional(),
  notes: z.string().optional(),
});
export type ImageRef = z.infer<typeof imageRefSchema>;

export const foodEventItemSchema = z.object({
  id: idSchema,
  foodEventId: idSchema,
  name: z.string().min(1).max(200),
  normalizedName: z.string().min(1).max(200),
  role: foodEventItemRoleSchema,
  quantity: z.number().nonnegative().nullable(),
  unit: z.string().max(40).nullable(),
  caloriesEstimated: z.number().nonnegative().nullable(),
  proteinGEstimated: z.number().nonnegative().nullable(),
  carbsGEstimated: z.number().nonnegative().nullable(),
  fatGEstimated: z.number().nonnegative().nullable(),
  estimateConfidence: confidenceSchema.nullable(),
  estimateSource: estimateSourceSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type FoodEventItem = z.infer<typeof foodEventItemSchema>;

export const createFoodEventItemSchema = z.object({
  name: z.string().min(1).max(200),
  role: foodEventItemRoleSchema,
  quantity: z.number().nonnegative().optional(),
  unit: z.string().max(40).optional(),
  caloriesEstimated: z.number().nonnegative().optional(),
  proteinGEstimated: z.number().nonnegative().optional(),
  carbsGEstimated: z.number().nonnegative().optional(),
  fatGEstimated: z.number().nonnegative().optional(),
  estimateConfidence: confidenceSchema.optional(),
  estimateSource: estimateSourceSchema.optional(),
});
export type CreateFoodEventItem = z.infer<typeof createFoodEventItemSchema>;

export const foodEventSchema = z
  .object({
    id: idSchema,
    userId: idSchema,
    eventType: foodEventTypeSchema,
    occurredAt: isoDateTimeSchema,
    source: foodEventSourceSchema,
    rawText: z.string().nullable(),
    imageRefs: z.array(imageRefSchema).nullable(),
    cravingText: z.string().nullable(),
    availableFoodContext: z.array(jsonValueSchema).nullable(),
    mealName: z.string().max(200).nullable(),
    actualEaten: z.boolean().nullable(),
    eatenByUser: z.boolean().nullable(),
    forPerson: z.string().max(120).nullable(),
    notes: z.string().nullable(),
  })
  .merge(timestampsSchema);
export type FoodEvent = z.infer<typeof foodEventSchema>;

export const createFoodEventSchema = z.object({
  eventType: foodEventTypeSchema,
  occurredAt: isoDateTimeSchema.optional(),
  source: foodEventSourceSchema.default('api'),
  rawText: z.string().optional(),
  imageRefs: z.array(imageRefSchema).optional(),
  cravingText: z.string().optional(),
  availableFoodContext: z.array(jsonValueSchema).optional(),
  mealName: z.string().max(200).optional(),
  actualEaten: z.boolean().optional(),
  eatenByUser: z.boolean().optional(),
  forPerson: z.string().max(120).optional(),
  notes: z.string().optional(),
  items: z.array(createFoodEventItemSchema).default([]),
});
export type CreateFoodEvent = z.infer<typeof createFoodEventSchema>;
export type CreateFoodEventInput = z.input<typeof createFoodEventSchema>;

export const updateFoodEventSchema = createFoodEventSchema.partial();
export type UpdateFoodEvent = z.infer<typeof updateFoodEventSchema>;
