import { z } from 'zod';
import { idSchema, isoDateTimeSchema, timestampsSchema } from './common.js';

export const connectionKindSchema = z.enum(['mcp_stdio', 'mcp_sse', 'rest_api', 'admin_bootstrap']);
export type ConnectionKind = z.infer<typeof connectionKindSchema>;

export const scopeSchema = z.string().regex(/^[a-z][a-z0-9_:-]*$/);
export type Scope = z.infer<typeof scopeSchema>;

export const connectionSchema = z
  .object({
    id: idSchema,
    userId: idSchema,
    name: z.string().min(1).max(120),
    kind: connectionKindSchema,
    tokenPrefix: z.string().min(4).max(12),
    scopes: z.array(scopeSchema).default([]),
    metadata: z.record(z.unknown()).default({}),
    lastUsedAt: isoDateTimeSchema.nullable(),
    revokedAt: isoDateTimeSchema.nullable(),
  })
  .merge(timestampsSchema);
export type Connection = z.infer<typeof connectionSchema>;

export const createConnectionInputSchema = z.object({
  name: z.string().min(1).max(120),
  kind: connectionKindSchema,
  scopes: z.array(scopeSchema).default([]),
  metadata: z.record(z.unknown()).optional(),
});
export type CreateConnectionInput = z.infer<typeof createConnectionInputSchema>;
