/**
 * Module<S> — the contract every Memex module fulfills.
 *
 * A module declares:
 *   - a manifest (id, codename, version, dependencies)
 *   - SQL migrations (a folder Drizzle can apply)
 *   - card schemas it contributes to the runtime registry
 *   - a buildServices factory that produces its public service surface
 *   - optional Hono routes mounted at /api/v1/<routePrefix>/
 *   - optional MCP tools registered to the server
 *   - an optional export hook that contributes its slice of the user's
 *     data to the kernel-level export bundle
 *
 * Cross-module access happens through the KernelHandle passed into
 * buildServices: a Behaviour Governor module asks for
 * `kernel.getModuleServices<FoodServices>('food')` and gets typed
 * read access to food data.
 */
import type { ModuleManifest } from '@memex/schemas';
import type { Db } from '@memex/db';
import type { Hono } from 'hono';
import type { Logger } from 'pino';
import type { ZodTypeAny } from 'zod';
import type { CardSchemaContribution } from './cards';
import type { AppConfig } from './config';

export interface KernelHandle {
  config: AppConfig;
  hasModule(id: string): boolean;
  /**
   * Typed read access to another registered module's services. Throws
   * if the module is not loaded; declare a `dependsOn` in your manifest
   * if you require another module to be present.
   */
  getModuleServices<S>(id: string): S;
}

export interface ModuleContext {
  config: AppConfig;
  db: Db;
  logger: Logger;
  kernel: KernelHandle;
}

export interface McpHandlerContext {
  userId: string;
  connectionId: string;
  scopes: readonly string[];
}

export interface McpToolContribution {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  handler: (input: unknown, ctx: McpHandlerContext) => Promise<unknown>;
}

export interface Module<S = unknown> {
  manifest: ModuleManifest;
  /** Path to the module's drizzle migrations folder. Optional. */
  migrationsFolder?: string;
  /** Card payload schemas contributed to the registry. */
  cards?: CardSchemaContribution[];
  /** Build the public services surface this module exposes. */
  buildServices: (ctx: ModuleContext) => S;
  /** Build a Hono router; mounted at /api/v1/<manifest.routePrefix ?? id>/. */
  buildRoutes?: (services: S) => Hono;
  /** MCP tools contributed to the kernel's MCP server. */
  buildMcpTools?: (services: S) => McpToolContribution[];
  /** Export hook for the kernel-level /api/v1/export/json bundle. */
  buildExportData?: (services: S, userId: string) => Promise<unknown>;
}

/**
 * Helper for module authors. Lets you write a module without manually
 * specifying the generic, since `buildServices`'s return type infers.
 */
export function defineModule<S>(module: Module<S>): Module<S> {
  return module;
}
