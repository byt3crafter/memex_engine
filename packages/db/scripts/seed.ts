/**
 * Seed script. Real fixture data lands in Phase 5; for now this script
 * just inserts a single user_profile row so other apps can boot.
 */
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq } from 'drizzle-orm';
import { newId } from '../src/ids';
import * as schema from '../src/schema/index';

const url = process.env['HEALTHLOOP_DATABASE_URL'] ?? 'file:./data/pantrymind.db';
const authToken = process.env['HEALTHLOOP_DATABASE_AUTH_TOKEN'];
const timezone = process.env['HEALTHLOOP_DEFAULT_TIMEZONE'] ?? 'Indian/Mauritius';

const client = createClient({ url, ...(authToken !== undefined ? { authToken } : {}) });
const db = drizzle(client, { schema });

const now = new Date().toISOString();
const existing = await db.select().from(schema.userProfile).limit(1).all();

if (existing.length === 0) {
  const id = newId('user');
  await db.insert(schema.userProfile).values({
    id,
    displayName: 'PantryMind User',
    timezone,
    goals: {},
    dietaryPreferences: {},
    allergies: [],
    healthNotes: {},
    createdAt: now,
    updatedAt: now,
  });
  console.log(`[seed] inserted user_profile ${id}`);
} else {
  const first = existing[0]!;
  await db
    .update(schema.userProfile)
    .set({ updatedAt: now })
    .where(eq(schema.userProfile.id, first.id));
  console.log(`[seed] user_profile ${first.id} already exists; bumped updatedAt`);
}

client.close();
