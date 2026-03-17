import { eq } from 'drizzle-orm';
import { getDb } from '../database.js';
import { webCredentials } from '../schema.js';

export async function findWebCredentialByUsername(username: string) {
  const db = getDb();
  const [credential] = await db.select().from(webCredentials)
    .where(eq(webCredentials.username, username))
    .limit(1);
  return credential ?? null;
}
