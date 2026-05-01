import { z } from 'zod';
import {
  idSchema,
  isoDateSchema,
  jsonValueSchema,
  timestampsSchema,
} from './common.js';

export const menuGeneratedFromSchema = z.enum(['recipes', 'pantry', 'assistant', 'manual']);
export type MenuGeneratedFrom = z.infer<typeof menuGeneratedFromSchema>;

export const menuPlanItemSchema = z.object({
  date: isoDateSchema.optional(),
  slot: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
  title: z.string().min(1).max(200),
  recipeId: idSchema.nullable().optional(),
  ingredients: z.array(z.string()).default([]),
  notes: z.string().max(500).optional(),
});
export type MenuPlanItem = z.infer<typeof menuPlanItemSchema>;

export const shoppingGapSchema = z.object({
  name: z.string().min(1).max(200),
  quantity: z.number().nonnegative().optional(),
  unit: z.string().max(40).optional(),
  reason: z.string().max(200).optional(),
});
export type ShoppingGap = z.infer<typeof shoppingGapSchema>;

export const menuPlanSchema = z
  .object({
    id: idSchema,
    userId: idSchema,
    title: z.string().min(1).max(200),
    startDate: isoDateSchema.nullable(),
    endDate: isoDateSchema.nullable(),
    generatedFrom: menuGeneratedFromSchema,
    items: z.array(menuPlanItemSchema).default([]),
    shoppingGaps: z.array(shoppingGapSchema).default([]),
    card: jsonValueSchema,
  })
  .merge(timestampsSchema);
export type MenuPlan = z.infer<typeof menuPlanSchema>;

export const suggestMenuSchema = z.object({
  days: z.number().int().min(1).max(14).default(3),
  useAvailableFood: z.boolean().default(true),
  goal: z.string().max(200).optional(),
  preferences: z.record(jsonValueSchema).optional(),
});
export type SuggestMenuInput = z.infer<typeof suggestMenuSchema>;
