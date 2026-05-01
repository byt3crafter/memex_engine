/**
 * Manifest a Memex module exposes about itself. Used by the kernel
 * registry, the website's module catalogue, and the export pipeline.
 */
import { z } from 'zod';

export const moduleManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  codename: z.string().min(1).max(60),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[a-z0-9]+)?$/),
  description: z.string().min(1).max(500),
  domain: z.string().min(1).max(60),
  routePrefix: z
    .string()
    .regex(/^[a-z][a-z0-9_-]*$/)
    .optional(),
  dependsOn: z.array(z.string()).default([]),
  scopes: z.array(z.string()).default([]),
  /** Single emoji or short symbol for App-Store-style listings. */
  icon: z.string().max(8).optional(),
  /** One-line pitch ≤ 120 chars. Distinct from `description` (longer). */
  tagline: z.string().max(120).optional(),
  /** Short bullet points highlighting capabilities. */
  features: z.array(z.string().max(120)).max(8).optional(),
  /** Display category (e.g. 'Food', 'Identity', 'Sleep'). Free-text. */
  category: z.string().max(40).optional(),
  /** Optional URL for the module's own docs/site. */
  homepage: z.string().url().optional(),
});
export type ModuleManifest = z.infer<typeof moduleManifestSchema>;
