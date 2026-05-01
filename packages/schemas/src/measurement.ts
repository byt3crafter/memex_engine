import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common.js';

export const measurementTypeSchema = z.enum(['weight', 'waist', 'blood_pressure', 'other']);
export type MeasurementType = z.infer<typeof measurementTypeSchema>;

export const measurementSchema = z.object({
  id: idSchema,
  userId: idSchema,
  type: measurementTypeSchema,
  value: z.string().min(1).max(60),
  unit: z.string().min(1).max(20),
  measuredAt: isoDateTimeSchema,
  notes: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type Measurement = z.infer<typeof measurementSchema>;

export const createMeasurementSchema = z.object({
  type: measurementTypeSchema,
  value: z.string().min(1).max(60),
  unit: z.string().min(1).max(20),
  measuredAt: isoDateTimeSchema.optional(),
  notes: z.string().optional(),
});
export type CreateMeasurement = z.infer<typeof createMeasurementSchema>;
