import { eq } from 'drizzle-orm';
import { newId, schema } from '@pantrymind/db';
import type { Db } from '@pantrymind/db';
import type { UpdateUserProfile, UserProfile } from '@pantrymind/schemas';
import { nowIso, type Clock, systemClock } from '../util/time';

const DEFAULT_DISPLAY_NAME = 'PantryMind User';
const DEFAULT_TIMEZONE = 'UTC';

export interface ProfileService {
  getCurrentProfile(): Promise<UserProfile>;
  updateCurrentProfile(input: UpdateUserProfile): Promise<UserProfile>;
}

export interface ProfileServiceDeps {
  db: Db;
  clock?: Clock;
  defaultTimezone?: string;
  defaultDisplayName?: string;
}

export function createProfileService(
  depsOrDb: ProfileServiceDeps | Db,
): ProfileService {
  const deps: ProfileServiceDeps =
    'db' in depsOrDb ? depsOrDb : { db: depsOrDb };
  const clock = deps.clock ?? systemClock;
  const defaultTimezone = deps.defaultTimezone ?? DEFAULT_TIMEZONE;
  const defaultDisplayName = deps.defaultDisplayName ?? DEFAULT_DISPLAY_NAME;
  const { db } = deps;

  async function loadFirst(): Promise<UserProfile | undefined> {
    const rows = await db.select().from(schema.userProfile).limit(1).all();
    const row = rows[0];
    return row ? rowToProfile(row) : undefined;
  }

  async function ensureProfile(): Promise<UserProfile> {
    const existing = await loadFirst();
    if (existing) return existing;
    const id = newId('user');
    const now = nowIso(clock);
    await db.insert(schema.userProfile).values({
      id,
      displayName: defaultDisplayName,
      timezone: defaultTimezone,
      goals: {},
      dietaryPreferences: {},
      allergies: [],
      healthNotes: {},
      createdAt: now,
      updatedAt: now,
    });
    const created = await loadFirst();
    if (!created) {
      throw new Error('failed to create user_profile');
    }
    return created;
  }

  return {
    async getCurrentProfile() {
      return ensureProfile();
    },

    async updateCurrentProfile(input) {
      const current = await ensureProfile();
      const now = nowIso(clock);
      const patch: Partial<typeof schema.userProfile.$inferInsert> = {
        updatedAt: now,
      };
      if (input.displayName !== undefined) patch.displayName = input.displayName;
      if (input.timezone !== undefined) patch.timezone = input.timezone;
      if (input.goals !== undefined) patch.goals = input.goals;
      if (input.dietaryPreferences !== undefined)
        patch.dietaryPreferences = input.dietaryPreferences;
      if (input.allergies !== undefined) patch.allergies = input.allergies;
      if (input.healthNotes !== undefined) patch.healthNotes = input.healthNotes;

      await db
        .update(schema.userProfile)
        .set(patch)
        .where(eq(schema.userProfile.id, current.id));

      const updated = await loadFirst();
      if (!updated) {
        throw new Error('user_profile vanished after update');
      }
      return updated;
    },
  };
}

function rowToProfile(row: typeof schema.userProfile.$inferSelect): UserProfile {
  return {
    id: row.id,
    displayName: row.displayName,
    timezone: row.timezone,
    goals: (row.goals ?? {}) as Record<string, unknown>,
    dietaryPreferences: (row.dietaryPreferences ?? {}) as Record<string, unknown>,
    allergies: row.allergies ?? [],
    healthNotes: (row.healthNotes ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
