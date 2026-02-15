import { eq, and, desc, ne, count } from 'drizzle-orm';
import { getDb } from '../database.js';
import { conversations, messages } from '../schema.js';

export async function getOrCreateConversation(userId: string, platform: string, conversationId?: string) {
  const db = getDb();

  // If a specific conversationId was provided (web multi-chat), look it up or create it
  if (conversationId) {
    const byId = await db.select().from(conversations)
      .where(eq(conversations.id, conversationId)).limit(1);
    if (byId.length > 0) return byId[0];
    // Create with the provided ID
    const [created] = await db.insert(conversations).values({ id: conversationId, userId, platform }).returning();
    return created;
  }

  const existing = await db.select().from(conversations)
    .where(and(eq(conversations.userId, userId), eq(conversations.platform, platform), eq(conversations.isActive, true)))
    .orderBy(desc(conversations.updatedAt)).limit(1);

  if (existing.length > 0) return existing[0];

  const [created] = await db.insert(conversations).values({ userId, platform }).returning();
  return created;
}

export async function getConversationHistory(userId: string, platform: string, limit = 20) {
  const db = getDb();
  return db.select().from(conversations)
    .where(and(eq(conversations.userId, userId), eq(conversations.platform, platform)))
    .orderBy(desc(conversations.createdAt)).limit(limit);
}

/** List all conversations for a user with message count and last message preview. */
export async function getUserConversations(
  userId: string,
  opts: { platform?: string; limit?: number; offset?: number } = {},
) {
  const db = getDb();
  const { platform, limit = 50, offset = 0 } = opts;

  const conditions = [eq(conversations.userId, userId), eq(conversations.isActive, true)];
  if (platform) conditions.push(eq(conversations.platform, platform));

  const convs = await db.select().from(conversations)
    .where(and(...conditions))
    .orderBy(desc(conversations.updatedAt))
    .limit(limit)
    .offset(offset);

  // Enrich with message count and last message preview
  const enriched = await Promise.all(convs.map(async (conv) => {
    const [countResult] = await db.select({ value: count() }).from(messages)
      .where(eq(messages.conversationId, conv.id));

    const [lastMsg] = await db.select({
      content: messages.content,
      role: messages.role,
      createdAt: messages.createdAt,
    }).from(messages)
      .where(eq(messages.conversationId, conv.id))
      .orderBy(desc(messages.createdAt))
      .limit(1);

    return {
      id: conv.id,
      title: conv.title,
      platform: conv.platform,
      messageCount: countResult?.value ?? 0,
      lastMessage: lastMsg ? { content: lastMsg.content.slice(0, 100), role: lastMsg.role, createdAt: lastMsg.createdAt } : null,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    };
  }));

  return enriched;
}

/** Update conversation title. */
export async function updateConversationTitle(conversationId: string, title: string) {
  const db = getDb();
  await db.update(conversations)
    .set({ title, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

/** Soft-delete a conversation. */
export async function softDeleteConversation(conversationId: string) {
  const db = getDb();
  await db.update(conversations)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

/** Get recent activity from platforms OTHER than the current one. */
export async function getCrossPlatformSummary(
  userId: string,
  currentPlatform: string,
  messagesPerPlatform = 3,
): Promise<Array<{ platform: string; msgs: Array<{ role: string; content: string; createdAt: Date }> }>> {
  const db = getDb();

  // Get active conversations on OTHER platforms
  const otherConvs = await db.select().from(conversations)
    .where(and(
      eq(conversations.userId, userId),
      ne(conversations.platform, currentPlatform),
      eq(conversations.isActive, true),
    ))
    .orderBy(desc(conversations.updatedAt))
    .limit(5);

  const result: Array<{ platform: string; msgs: Array<{ role: string; content: string; createdAt: Date }> }> = [];

  for (const conv of otherConvs) {
    const recentMsgs = await db.select().from(messages)
      .where(eq(messages.conversationId, conv.id))
      .orderBy(desc(messages.createdAt))
      .limit(messagesPerPlatform);

    if (recentMsgs.length > 0) {
      result.push({
        platform: conv.platform,
        msgs: recentMsgs.reverse().map(m => ({
          role: m.role,
          content: m.content.slice(0, 200),
          createdAt: m.createdAt,
        })),
      });
    }
  }

  return result;
}
