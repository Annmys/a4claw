import { eq, and, or, sql } from 'drizzle-orm';
import { getDb } from '../database.js';
import { users, conversations, messages, knowledge, tasks, servers, exchangeConfigs, trades, portfolios, tradingRiskConfig } from '../schema.js';
import logger from '../../utils/logger.js';

export async function findOrCreateUser(platformId: string, platform: string, name?: string) {
  const db = getDb();
  const existing = await db.select().from(users).where(and(eq(users.platformId, platformId), eq(users.platform, platform))).limit(1);

  if (existing.length > 0) return existing[0];

  const [created] = await db.insert(users).values({ platformId, platform, name }).returning();
  return created;
}

export async function getUserById(id: string) {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user ?? null;
}

export async function updateUserPreferences(id: string, preferences: Record<string, unknown>) {
  const db = getDb();
  await db.update(users).set({ preferences, updatedAt: new Date() }).where(eq(users.id, id));
}

/** Get all user records linked to a master (including the master itself). */
export async function getLinkedUsers(masterUserId: string) {
  const db = getDb();
  return db.select({
    id: users.id, platformId: users.platformId, platform: users.platform, name: users.name,
  }).from(users).where(
    or(eq(users.id, masterUserId), eq(users.masterUserId, masterUserId))
  );
}

/** Migrate all data from a secondary user to the master user ID. */
async function migrateDataToMaster(fromUserId: string, toMasterUserId: string): Promise<Record<string, number>> {
  const db = getDb();
  const migrated: Record<string, number> = {};

  const tablesToMigrate = [
    { name: 'conversations', table: conversations },
    { name: 'messages', table: messages },
    { name: 'knowledge', table: knowledge },
    { name: 'tasks', table: tasks },
    { name: 'servers', table: servers },
    { name: 'exchangeConfigs', table: exchangeConfigs },
    { name: 'trades', table: trades },
    { name: 'portfolios', table: portfolios },
    { name: 'tradingRiskConfig', table: tradingRiskConfig },
  ] as const;

  for (const { name, table } of tablesToMigrate) {
    try {
      const result = await db.update(table as any)
        .set({ userId: toMasterUserId } as any)
        .where(eq((table as any).userId, fromUserId));
      migrated[name] = (result as any).rowCount ?? 0;
    } catch (err: any) {
      logger.warn(`Migration failed for ${name}`, { error: err.message });
      migrated[name] = -1;
    }
  }

  // Set masterUserId on the secondary user
  await db.update(users)
    .set({ masterUserId: toMasterUserId, updatedAt: new Date() })
    .where(eq(users.id, fromUserId));

  return migrated;
}

/**
 * Auto-link platform users at startup.
 * For each platform, picks the most active user (most messages).
 * Links all "primary" users across platforms to a single master.
 * Skips platforms that already have a linked user.
 */
export async function autoLinkUsers(): Promise<string | null> {
  const db = getDb();
  const allUsers = await db.select().from(users).orderBy(users.createdAt);

  // If any user already has a masterUserId set, linking has already happened
  const alreadyLinked = allUsers.some(u => u.masterUserId);
  if (alreadyLinked) return null;

  // Group by platform
  const byPlatform = new Map<string, typeof allUsers>();
  for (const u of allUsers) {
    const list = byPlatform.get(u.platform) ?? [];
    list.push(u);
    byPlatform.set(u.platform, list);
  }

  // Need at least 2 platforms to link
  if (byPlatform.size < 2) return null;

  // For each platform, pick the user with the most messages
  const primaryUsers: typeof allUsers = [];
  for (const [_platform, platformUsers] of byPlatform) {
    if (platformUsers.length === 1) {
      primaryUsers.push(platformUsers[0]);
    } else {
      // Pick user with most messages
      let best = platformUsers[0];
      let bestCount = 0;
      for (const u of platformUsers) {
        const [row] = await db.select({ count: sql<number>`count(*)::int` })
          .from(messages).where(eq(messages.userId, u.id));
        const count = row?.count ?? 0;
        if (count > bestCount) { best = u; bestCount = count; }
      }
      primaryUsers.push(best);
    }
  }

  // Pick the one with earliest creation as master
  const master = primaryUsers[0];
  const secondaries = primaryUsers.slice(1);

  if (secondaries.length === 0) return null;

  logger.info('Auto-linking platform identities', {
    master: `${master.platform}:${master.platformId}`,
    secondaries: secondaries.map(u => `${u.platform}:${u.platformId}`),
  });

  for (const secondary of secondaries) {
    const migrated = await migrateDataToMaster(secondary.id, master.id);
    logger.info('Migrated user data', {
      from: `${secondary.platform}:${secondary.platformId}`,
      to: `${master.platform}:${master.platformId}`,
      migrated,
    });
  }

  return master.id;
}
