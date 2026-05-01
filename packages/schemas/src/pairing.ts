import { z } from 'zod';
import { connectionKindSchema, scopeSchema } from './connection.js';
import { idSchema, isoDateTimeSchema } from './common.js';

export const pairingCodeSchema = z.object({
  code: z.string().min(8).max(32),
  userId: idSchema,
  clientName: z.string().min(1).max(120),
  clientKind: connectionKindSchema,
  scopes: z.array(scopeSchema).default([]),
  metadata: z.record(z.unknown()).default({}),
  createdAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
  consumedAt: isoDateTimeSchema.nullable(),
  consumedConnectionId: idSchema.nullable(),
});
export type PairingCode = z.infer<typeof pairingCodeSchema>;

export const pairStartInputSchema = z.object({
  clientName: z.string().min(1).max(120),
  clientKind: connectionKindSchema.default('mcp_stdio'),
  scopes: z.array(scopeSchema).default([]),
  metadata: z.record(z.unknown()).optional(),
  expiresInSeconds: z.number().int().min(60).max(3600).default(600),
});
export type PairStartInput = z.infer<typeof pairStartInputSchema>;

/**
 * Returned to whoever initiated the pairing (the user via website, or
 * the founder bootstrap response). Encodes everything the assistant
 * needs to complete the handshake.
 */
export const pairStartResultSchema = z.object({
  pairingCode: z.string().min(8).max(32),
  qrPayload: z.string().min(1),
  configSnippets: z.record(z.string()),
  expiresAt: isoDateTimeSchema,
  baseUrl: z.string().url(),
});
export type PairStartResult = z.infer<typeof pairStartResultSchema>;

export const pairCompleteInputSchema = z.object({
  code: z.string().min(8).max(32),
  clientFingerprint: z.string().min(1).max(200).optional(),
});
export type PairCompleteInput = z.infer<typeof pairCompleteInputSchema>;

export const pairCompleteResultSchema = z.object({
  connectionId: idSchema,
  token: z.string().min(32),
  userId: idSchema,
  scopes: z.array(scopeSchema),
  baseUrl: z.string().url(),
});
export type PairCompleteResult = z.infer<typeof pairCompleteResultSchema>;
