import { z } from 'zod';

export const idSchema = z.string().min(1);
export type Id = z.infer<typeof idSchema>;

export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const timestampsSchema = z.object({
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);
export type JsonValue = z.infer<typeof jsonValueSchema>;

export const confidenceSchema = z.number().min(0).max(1);
export type Confidence = z.infer<typeof confidenceSchema>;

export const score1to5Schema = z.number().int().min(1).max(5);
export type Score1to5 = z.infer<typeof score1to5Schema>;
