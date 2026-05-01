import { z } from 'zod';
import { confidenceSchema, idSchema, isoDateSchema, timestampsSchema } from '@memex/schemas';

export const pantryCategorySchema = z.enum([
  'protein',
  'carb',
  'vegetable',
  'fruit',
  'dairy',
  'fat',
  'snack',
  'drink',
  'condiment',
  'other',
]);
export type PantryCategory = z.infer<typeof pantryCategorySchema>;

export const pantrySourceSchema = z.enum(['manual', 'receipt', 'photo', 'import', 'assistant']);
export type PantrySource = z.infer<typeof pantrySourceSchema>;

export const pantryItemSchema = z
  .object({
    id: idSchema,
    userId: idSchema,
    name: z.string().min(1).max(200),
    normalizedName: z.string().min(1).max(200),
    category: pantryCategorySchema,
    quantity: z.number().nonnegative().nullable(),
    unit: z.string().max(40).nullable(),
    expiryDate: isoDateSchema.nullable(),
    source: pantrySourceSchema,
    confidence: confidenceSchema.nullable(),
    isAvailable: z.boolean(),
  })
  .merge(timestampsSchema);
export type PantryItem = z.infer<typeof pantryItemSchema>;

export const createPantryItemSchema = z.object({
  name: z.string().min(1).max(200),
  category: pantryCategorySchema,
  quantity: z.number().nonnegative().optional(),
  unit: z.string().max(40).optional(),
  expiryDate: isoDateSchema.optional(),
  source: pantrySourceSchema.default('manual'),
  confidence: confidenceSchema.optional(),
  isAvailable: z.boolean().default(true),
});
export type CreatePantryItem = z.infer<typeof createPantryItemSchema>;
export type CreatePantryItemInput = z.input<typeof createPantryItemSchema>;

export const updatePantryItemSchema = createPantryItemSchema.partial();
export type UpdatePantryItem = z.infer<typeof updatePantryItemSchema>;

export const bulkPantryUpdateSchema = z.object({
  items: z.array(createPantryItemSchema).max(500),
  replace: z.boolean().default(false),
});
export type BulkPantryUpdate = z.infer<typeof bulkPantryUpdateSchema>;
export type BulkPantryUpdateInput = z.input<typeof bulkPantryUpdateSchema>;
