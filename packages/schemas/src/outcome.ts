import { z } from 'zod';
import { idSchema, isoDateTimeSchema, score1to5Schema } from './common.js';

export const mealOutcomeSchema = z.object({
  id: idSchema,
  userId: idSchema,
  foodEventId: idSchema,
  satisfactionScore: score1to5Schema.nullable(),
  hungerAfter: score1to5Schema.nullable(),
  energyAfter: score1to5Schema.nullable(),
  cravingsAfter: score1to5Schema.nullable(),
  moodAfter: z.string().max(120).nullable(),
  notes: z.string().nullable(),
  recipeCandidate: z.boolean().default(false),
  createdAt: isoDateTimeSchema,
});
export type MealOutcome = z.infer<typeof mealOutcomeSchema>;

export const createMealOutcomeSchema = z.object({
  foodEventId: idSchema,
  satisfactionScore: score1to5Schema.optional(),
  hungerAfter: score1to5Schema.optional(),
  energyAfter: score1to5Schema.optional(),
  cravingsAfter: score1to5Schema.optional(),
  moodAfter: z.string().max(120).optional(),
  notes: z.string().optional(),
  recipeCandidate: z.boolean().optional(),
});
export type CreateMealOutcome = z.infer<typeof createMealOutcomeSchema>;
