import { Router, Request, Response } from 'express';
import { findOrCreateUser } from '../../../memory/repositories/users.js';
import {
  getUserConversations,
  getOrCreateConversation,
  getConversationByIdForUser,
  updateConversationTitleForUser,
  softDeleteConversationForUser,
} from '../../../memory/repositories/conversations.js';
import { getRecentMessages } from '../../../memory/repositories/messages.js';
import logger from '../../../utils/logger.js';

async function resolveDbUserId(jwtUserId: string): Promise<string> {
  const user = await findOrCreateUser(jwtUserId, 'web', jwtUserId);
  return user.masterUserId ?? user.id;
}

export function setupHistoryRoutes(): Router {
  const router = Router();

  // GET /api/history — list all conversations for user
  router.get('/', async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { platform, limit: limitStr, offset: offsetStr } = req.query;
    const limit = Math.min(parseInt(limitStr as string) || 50, 100);
    const offset = parseInt(offsetStr as string) || 0;

    try {
      const dbUserId = await resolveDbUserId(user.userId);
      const conversations = await getUserConversations(dbUserId, {
        platform: (platform as string) || undefined,
        limit,
        offset,
      });
      res.json({ conversations, total: conversations.length });
    } catch (err: any) {
      logger.error('Failed to list conversations', { error: err.message });
      res.status(500).json({ error: `Failed to load conversations: ${err.message}` });
    }
  });

  // GET /api/history/:id — get single conversation with messages
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const id = req.params.id as string;
      const dbUserId = await resolveDbUserId(user.userId);
      const conv = await getConversationByIdForUser(id, dbUserId);
      if (!conv) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      const msgs = await getRecentMessages(id, 100);
      res.json({
        id,
        messages: msgs.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          agent: m.agentId,
          artifacts: Array.isArray((m.metadata as any)?.artifacts) ? (m.metadata as any).artifacts : undefined,
          createdAt: m.createdAt,
        })),
      });
    } catch (err: any) {
      logger.error('Failed to load conversation messages', { error: err.message });
      res.status(500).json({ error: `Failed to load conversation: ${err.message}` });
    }
  });

  // PUT /api/history/:id — update conversation title
  router.put('/:id', async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { title } = req.body;
      if (!title || typeof title !== 'string') {
        res.status(400).json({ error: 'Title required' });
        return;
      }
      const dbUserId = await resolveDbUserId(user.userId);
      const conv = await getConversationByIdForUser(req.params.id as string, dbUserId);
      if (!conv) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      await updateConversationTitleForUser(req.params.id as string, dbUserId, title.slice(0, 200));
      res.json({ ok: true });
    } catch (err: any) {
      logger.error('Failed to update conversation', { error: err.message });
      res.status(500).json({ error: `Failed to update: ${err.message}` });
    }
  });

  // DELETE /api/history/:id — soft-delete conversation
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const dbUserId = await resolveDbUserId(user.userId);
      const conv = await getConversationByIdForUser(req.params.id as string, dbUserId);
      if (!conv) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      await softDeleteConversationForUser(req.params.id as string, dbUserId);
      res.json({ ok: true });
    } catch (err: any) {
      logger.error('Failed to delete conversation', { error: err.message });
      res.status(500).json({ error: `Failed to delete: ${err.message}` });
    }
  });

  // POST /api/history — create/register a conversation (from frontend)
  router.post('/', async (req: Request, res: Response) => {
    const user = (req as any).user;
    try {
      const { conversationId, title } = req.body;
      if (!conversationId) {
        res.status(400).json({ error: 'conversationId required' });
        return;
      }
      const dbUserId = await resolveDbUserId(user.userId);
      const conv = await getOrCreateConversation(dbUserId, 'web', conversationId);
      if (title) await updateConversationTitleForUser(conv.id, dbUserId, title.slice(0, 200));
      res.json({ id: conv.id, ok: true });
    } catch (err: any) {
      logger.error('Failed to create conversation', { error: err.message });
      const isAccessDenied = /access denied/i.test(err.message);
      res.status(isAccessDenied ? 403 : 500).json({ error: `Failed to create: ${err.message}` });
    }
  });

  return router;
}
