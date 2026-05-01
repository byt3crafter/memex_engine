import { z } from 'zod';
import { idSchema, score1to5Schema, timestampsSchema } from './common.js';

export const recipeIngredientSchema = z.object({
  name: z.string().min(1).max(200),
  quantity: z.number().nonnegative().nullable().optional(),
  unit: z.string().max(40).nullable().optional(),
  notes: z.string().max(200).optional(),
  optional: z.boolean().default(false),
});
export type RecipeIngredient = z.infer<typeof recipeIngredientSchema>;

export const recipeStepSchema = z.object({
  order: z.number().int().nonnegative(),
  text: z.string().min(1),
  durationMinutes: z.number().int().nonnegative().optional(),
});
export type RecipeStep = z.infer<typeof recipeStepSchema>;

export const recipeSchema = z
  .object({
    id: idSchema,
    userId: idSchema,
    title: z.string().min(1).max(200),
    description: z.string().nullable(),
    sourceFoodEventId: idSchema.nullable(),
    ingredients: z.array(recipeIngredientSchema).default([]),
    steps: z.array(recipeStepSchema).default([]),
    proteinSource: z.string().max(120).nullable(),
    tags: z.array(z.string().min(1).max(40)).default([]),
    estimatedCalories: z.number().nonnegative().nullable(),
    estimatedProteinG: z.number().nonnegative().nullable(),
    estimatedCarbsG: z.number().nonnegative().nullable(),
    estimatedFatG: z.number().nonnegative().nullable(),
    personalRating: score1to5Schema.nullable(),
    isActive: z.boolean().default(true),
  })
  .merge(timestampsSchema);
export type Recipe = z.infer<typeof recipeSchema>;

export const createRecipeSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  sourceFoodEventId: idSchema.optional(),
  ingredients: z.array(recipeIngredientSchema).default([]),
  steps: z.array(recipeStepSchema).default([]),
  proteinSource: z.string().max(120).optional(),
  tags: z.array(z.string().min(1).max(40)).default([]),
  estimatedCalories: z.number().nonnegative().optional(),
  estimatedProteinG: z.number().nonnegative().optional(),
  estimatedCarbsG: z.number().nonnegative().optional(),
  estimatedFatG: z.number().nonnegative().optional(),
  personalRating: score1to5Schema.optional(),
});
export type CreateRecipe = z.infer<typeof createRecipeSchema>;

export const updateRecipeSchema = createRecipeSchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateRecipe = z.infer<typeof updateRecipeSchema>;
