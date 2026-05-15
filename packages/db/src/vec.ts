import type { Client } from '@libsql/client';

/**
 * Attempt to load the sqlite-vec extension into the given libsql client.
 *
 * sqlite-vec ships as a native .so/.dylib/.dll (the `sqlite-vec` npm package
 * contains the platform binary). Loading requires the SQLite handle to have
 * extension loading enabled — which is the default for libsql local-file
 * databases but is not guaranteed on all builds. Any failure is caught and
 * logged; callers must treat the return value as the source of truth for
 * whether vector features are available.
 */
export async function loadVecExtension(client: Client): Promise<boolean> {
  try {
    const { getLoadablePath } = await import('sqlite-vec');
    const vecPath = getLoadablePath();
    await client.execute({ sql: 'SELECT load_extension(?)', args: [vecPath] });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[memex/db] sqlite-vec: extension unavailable (${msg}); vector features disabled`);
    return false;
  }
}
