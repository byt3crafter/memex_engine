/**
 * Card payload base. Modules contribute concrete card types via the
 * runtime CardSchemaRegistry in the kernel, instead of all card types
 * living in this central package as a closed discriminated union.
 *
 * cardSchemaVersion gates compatibility — bump it and renderers can
 * fall back gracefully on unknown versions instead of breaking.
 */
import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common.js';

export const CARD_SCHEMA_VERSION = 1 as const;

export const cardActionKindSchema = z.enum([
  'log_eaten',
  'save_recipe',
  'suggest_alternative',
  'add_to_shopping_list',
  'log_outcome',
  'open',
  'dismiss',
  'custom',
]);
export type CardActionKind = z.infer<typeof cardActionKindSchema>;

export const cardActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(60),
  kind: cardActionKindSchema,
  payload: z.record(z.unknown()).optional(),
});
export type CardAction = z.infer<typeof cardActionSchema>;

export const baseCardSchema = z.object({
  cardSchemaVersion: z.literal(CARD_SCHEMA_VERSION),
  type: z.string().min(1),
  module: z.string().min(1),
  id: idSchema.optional(),
  createdAt: isoDateTimeSchema.optional(),
  actions: z.array(cardActionSchema).default([]),
});
export type BaseCard = z.infer<typeof baseCardSchema>;
