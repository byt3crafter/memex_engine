/**
 * The kernel composes a list of modules into a runtime: applies every
 * module's migrations after the kernel's own, builds module services,
 * and registers them so adapters (REST API, MCP server) can iterate.
 *
 * Phase 0 ships only the registry skeleton + migration application.
 * Phase 1 adds the kernel-level services (user, connection, pairing).
 */
import { applyKernelMigrations, applyMigrationsFromFolder, type Db } from '@memex/db';
import type { Logger } from 'pino';
import { CardSchemaRegistry, type CardSchemaContribution } from './cards';
import type { AppConfig } from './config';
import type { KernelHandle, Module, ModuleContext } from './module';
import { ModuleRegistry } from './registry';

export interface CreateKernelOptions {
  config: AppConfig;
  db: Db;
  logger: Logger;
  // `Module<unknown>` is invariant under exactOptionalPropertyTypes, so
  // a heterogeneous array of differently-typed modules wouldn't fit.
  // Module<any> at this boundary is the standard pragmatic shape: each
  // module is type-safe in its own buildServices, and kernel consumers
  // narrow back via registry.require<S>(id).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  modules: readonly Module<any>[];
}

export interface Kernel {
  config: AppConfig;
  db: Db;
  logger: Logger;
  modules: ModuleRegistry;
  cards: CardSchemaRegistry;
}

export async function createKernel(options: CreateKernelOptions): Promise<Kernel> {
  const { config, db, logger, modules } = options;
  const registry = new ModuleRegistry();
  const cards = new CardSchemaRegistry();

  logger.info({ moduleCount: modules.length }, 'memex.kernel.starting');

  // 1. Apply kernel migrations first.
  await applyKernelMigrations(db);

  // 2. Apply each module's migrations (idempotent — drizzle tracks).
  for (const module of modules) {
    if (module.migrationsFolder) {
      logger.debug(
        { module: module.manifest.id, folder: module.migrationsFolder },
        'memex.kernel.applying_module_migrations',
      );
      await applyMigrationsFromFolder(db, module.migrationsFolder);
    }
  }

  // 3. Register card schemas.
  for (const module of modules) {
    for (const card of module.cards ?? []) {
      registerCard(cards, card);
    }
  }

  // 4. Build module services. The kernel handle exposes cross-module
  //    lookups so a module's buildServices can find another module's
  //    services *that have already been registered*. Modules listed
  //    earlier in the array are visible to later ones.
  const handle: KernelHandle = {
    config,
    hasModule: (id) => registry.has(id),
    getModuleServices: <S>(id: string) => registry.require<S>(id).services,
  };

  for (const module of modules) {
    for (const dep of module.manifest.dependsOn ?? []) {
      if (!registry.has(dep)) {
        throw new Error(
          `module ${module.manifest.id} depends on unloaded module ${dep}; declare it earlier in the modules array`,
        );
      }
    }
    const ctx: ModuleContext = { config, db, logger, kernel: handle };
    const services = module.buildServices(ctx);
    registry.register(module, services);
    logger.info(
      {
        module: module.manifest.id,
        codename: module.manifest.codename,
        version: module.manifest.version,
      },
      'memex.kernel.module_loaded',
    );
  }

  return { config, db, logger, modules: registry, cards };
}

function registerCard(registry: CardSchemaRegistry, card: CardSchemaContribution): void {
  registry.register(card);
}
