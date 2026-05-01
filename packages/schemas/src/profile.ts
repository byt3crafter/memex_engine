import { z } from 'zod';
import { idSchema, jsonValueSchema, timestampsSchema } from './common.js';

export const userProfileSchema = z
  .object({
    id: idSchema,
    displayName: z.string().min(1).max(120),
    timezone: z.string().min(1),
    goals: z.record(jsonValueSchema).default({}),
    dietaryPreferences: z.record(jsonValueSchema).default({}),
    allergies: z.array(z.string()).default([]),
    healthNotes: z.record(jsonValueSchema).default({}),
  })
  .merge(timestampsSchema);

export type UserProfile = z.infer<typeof userProfileSchema>;

export const updateUserProfileSchema = userProfileSchema
  .pick({
    displayName: true,
    timezone: true,
    goals: true,
    dietaryPreferences: true,
    allergies: true,
    healthNotes: true,
  })
  .partial();

export type UpdateUserProfile = z.infer<typeof updateUserProfileSchema>;
