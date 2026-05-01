import { eq } from 'drizzle-orm';
import { KernelIdPrefix, newId, schema, type Db } from '@memex/db';
import { createUserSchema, type UpdateUser, type User, type UserRole } from '@memex/schemas';
import type { z } from 'zod';
import { nowIso, systemClock, type Clock } from '../util/time';

/**
 * Service-facing input — z.input gives the pre-parse shape, so callers
 * can pass partial objects and rely on Zod defaults (role → 'member',
 * timezone → 'UTC').
 */
export type CreateUserInput = z.input<typeof createUserSchema>;

export interface UserService {
  create(input: CreateUserInput): Promise<User>;
  getById(id: string): Promise<User>;
  findByEmail(email: string): Promise<User | undefined>;
  list(): Promise<User[]>;
  update(id: string, patch: UpdateUser): Promise<User>;
  count(): Promise<number>;
  hasFounder(): Promise<boolean>;
}

export interface UserServiceDeps {
  db: Db;
  clock?: Clock;
}

export function createUserService(deps: UserServiceDeps): UserService {
  const { db } = deps;
  const clock = deps.clock ?? systemClock;

  function rowToUser(row: typeof schema.user.$inferSelect): User {
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      timezone: row.timezone,
      role: row.role as UserRole,
      isActive: row.isActive,
      preferences: (row.preferences ?? {}) as Record<string, unknown>,
      enabledModules: row.enabledModules ?? [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  return {
    async create(input) {
      // Parse defensively so callers skipping the Zod boundary still
      // get role/timezone defaults filled in.
      const parsed = createUserSchema.parse(input);
      const id = newId(KernelIdPrefix.user);
      const now = nowIso(clock);
      await db.insert(schema.user).values({
        id,
        email: parsed.email ?? null,
        displayName: parsed.displayName,
        timezone: parsed.timezone,
        role: parsed.role,
        isActive: true,
        preferences: parsed.preferences ?? {},
        enabledModules: parsed.enabledModules ?? [],
        createdAt: now,
        updatedAt: now,
      });
      return this.getById(id);
    },

    async getById(id) {
      const rows = await db.select().from(schema.user).where(eq(schema.user.id, id)).limit(1).all();
      const row = rows[0];
      if (!row) throw new UserNotFoundError(id);
      return rowToUser(row);
    },

    async findByEmail(email) {
      const rows = await db
        .select()
        .from(schema.user)
        .where(eq(schema.user.email, email))
        .limit(1)
        .all();
      const row = rows[0];
      return row ? rowToUser(row) : undefined;
    },

    async list() {
      const rows = await db.select().from(schema.user).all();
      return rows.map(rowToUser);
    },

    async update(id, patch) {
      const existing = await this.getById(id);
      const now = nowIso(clock);
      const values: Partial<typeof schema.user.$inferInsert> = { updatedAt: now };
      if (patch.email !== undefined) values.email = patch.email;
      if (patch.displayName !== undefined) values.displayName = patch.displayName;
      if (patch.timezone !== undefined) values.timezone = patch.timezone;
      if (patch.role !== undefined) values.role = patch.role;
      if (patch.preferences !== undefined) values.preferences = patch.preferences;
      if (patch.enabledModules !== undefined) values.enabledModules = patch.enabledModules;
      if (patch.isActive !== undefined) values.isActive = patch.isActive;
      await db.update(schema.user).set(values).where(eq(schema.user.id, existing.id));
      return this.getById(existing.id);
    },

    async count() {
      const rows = await db.select().from(schema.user).all();
      return rows.length;
    },

    async hasFounder() {
      const rows = await db
        .select()
        .from(schema.user)
        .where(eq(schema.user.role, 'founder'))
        .limit(1)
        .all();
      return rows.length > 0;
    },
  };
}

export class UserNotFoundError extends Error {
  readonly code = 'user_not_found' as const;
  constructor(public readonly id: string) {
    super(`user ${id} not found`);
  }
}
