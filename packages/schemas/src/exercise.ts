import { z } from 'zod';
import { idSchema, isoDateTimeSchema, jsonValueSchema, score1to5Schema } from './common.js';

export const exerciseTypeSchema = z.enum(['home', 'gym', 'walk', 'other']);
export type ExerciseType = z.infer<typeof exerciseTypeSchema>;

export const exerciseEventSchema = z.object({
  id: idSchema,
  userId: idSchema,
  occurredAt: isoDateTimeSchema,
  type: exerciseTypeSchema,
  title: z.string().min(1).max(200),
  durationMinutes: z.number().int().nonnegative().nullable(),
  details: z.record(jsonValueSchema),
  difficulty: score1to5Schema.nullable(),
  painFlag: z.boolean().default(false),
  notes: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type ExerciseEvent = z.infer<typeof exerciseEventSchema>;

export const createExerciseEventSchema = z.object({
  occurredAt: isoDateTimeSchema.optional(),
  type: exerciseTypeSchema,
  title: z.string().min(1).max(200),
  durationMinutes: z.number().int().nonnegative().optional(),
  details: z.record(jsonValueSchema).optional(),
  difficulty: score1to5Schema.optional(),
  painFlag: z.boolean().optional(),
  notes: z.string().optional(),
});
export type CreateExerciseEvent = z.infer<typeof createExerciseEventSchema>;
