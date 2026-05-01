import { z } from 'zod';
import { idSchema, jsonValueSchema, timestampsSchema } from './common.js';

export const userRoleSchema = z.enum(['founder', 'member']);
export type UserRole = z.infer<typeof userRoleSchema>;

export const userSchema = z
  .object({
    id: idSchema,
    email: z.string().email().nullable(),
    displayName: z.string().min(1).max(120),
    timezone: z.string().min(1),
    role: userRoleSchema,
    isActive: z.boolean(),
    preferences: z.record(jsonValueSchema).default({}),
    enabledModules: z.array(z.string()).default([]),
  })
  .merge(timestampsSchema);
export type User = z.infer<typeof userSchema>;

export const createUserSchema = z.object({
  email: z.string().email().optional(),
  displayName: z.string().min(1).max(120),
  timezone: z.string().min(1).default('UTC'),
  role: userRoleSchema.default('member'),
  preferences: z.record(jsonValueSchema).optional(),
  enabledModules: z.array(z.string()).optional(),
});
export type CreateUser = z.infer<typeof createUserSchema>;

export const updateUserSchema = createUserSchema
  .partial()
  .extend({ isActive: z.boolean().optional() });
export type UpdateUser = z.infer<typeof updateUserSchema>;
