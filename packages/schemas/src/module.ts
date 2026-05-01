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
});
export type ModuleManifest = z.infer<typeof moduleManifestSchema>;
