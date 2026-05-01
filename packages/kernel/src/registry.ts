import type { Module } from './module';

interface RegisteredModule {
  module: Module;
  services: unknown;
}

export class ModuleRegistry {
  private byId = new Map<string, RegisteredModule>();

  register(module: Module, services: unknown): void {
    const id = module.manifest.id;
    if (this.byId.has(id)) {
      throw new Error(`module already registered: ${id}`);
    }
    this.byId.set(id, { module, services });
  }

  get<S = unknown>(id: string): { module: Module<S>; services: S } | undefined {
    const entry = this.byId.get(id);
    if (!entry) return undefined;
    return entry as { module: Module<S>; services: S };
  }

  require<S = unknown>(id: string): { module: Module<S>; services: S } {
    const entry = this.get<S>(id);
    if (!entry) throw new Error(`module not registered: ${id}`);
    return entry;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  ids(): string[] {
    return [...this.byId.keys()];
  }

  list(): RegisteredModule[] {
    return [...this.byId.values()];
  }
}
