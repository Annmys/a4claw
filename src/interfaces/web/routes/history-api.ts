import { Router, Request, Response } from 'express';
import { findOrCreateUser } from '../../../memory/repositories/users.js';
import {
  extractConversationRuntime,
  getUserConversations,
  getOrCreateConversation,
  getConversationByIdForUser,
  getConversationMetadataForUser,
  mergeConversationMetadataForUser,
  updateConversationTitleForUser,
  softDeleteConversationForUser,
  type ConversationRuntimeMetadata,
} from '../../../memory/repositories/conversations.js';
import { getRecentMessages } from '../../../memory/repositories/messages.js';
import logger from '../../../utils/logger.js';
import type { Engine } from '../../../core/engine.js';

async function resolveDbUserId(jwtUserId: string): Promise<string> {
  const user = await findOrCreateUser(jwtUserId, 'web', jwtUserId);
  return user.masterUserId ?? user.id;
}

function normalizeRuntimeUpdate(
  input: unknown,
  current: ConversationRuntimeMetadata | null,
): ConversationRuntimeMetadata {
  const body = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const next: ConversationRuntimeMetadata = { ...(current ?? {}) };

  if (Object.prototype.hasOwnProperty.call(body, 'model')) {
    next.model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'responseMode')) {
    next.responseMode = body.responseMode === 'auto' || body.responseMode === 'quick' || body.responseMode === 'deep'
      ? body.responseMode
      : undefined;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'interactionMode')) {
    next.interactionMode = body.interactionMode === 'chat' || body.interactionMode === 'task'
      ? body.interactionMode
      : undefined;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'thinkingMode')) {
    next.thinkingMode = body.thinkingMode === 'standard' || body.thinkingMode === 'deep'
      ? body.thinkingMode
      : undefined;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'verbosity')) {
    next.verbosity = body.verbosity === 'concise' || body.verbosity === 'balanced' || body.verbosity === 'detailed'
      ? body.verbosity
      : undefined;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'compactSummary')) {
    next.compactSummary = typeof body.compactSummary === 'string' && body.compactSummary.trim()
      ? body.compactSummary.trim()
      : null;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'compactedAt')) {
    next.compactedAt = typeof body.compactedAt === 'string' && body.compactedAt.trim()
      ? body.compactedAt.trim()
      : null;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'compactSourceMessages')) {
    next.compactSourceMessages = typeof body.compactSourceMessages === 'number'
      ? body.compactSourceMessages
      : null;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'compactTokensSaved')) {
    next.compactTokensSaved = typeof body.compactTokensSaved === 'number'
      ? body.compactTokensSaved
      : null;
  }

  return next;
}

function extractSummaryFromCompactedText(text: string): string {
  const match = text.match(/\[Conversation Summary\]\s*([\s\S]*?)\s*\[End Summary/);
  if (match?.[1]?.trim()) return match[1].trim();
  return '';
}

export function setupHistoryRoutes(engine: Engine): Router {
  const router = Router();

  const listConversations = async (req: Request, res: Response) => {
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
  };

  // GET /api/history — list all conversations for user
  router.get('/', listConversations);
  // Legacy compatibility for older frontend bundles
  router.get('/conversations', listConversations);

  router.get('/:id/runtime', async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const id = req.params.id as string;
      const dbUserId = await resolveDbUserId(user.userId);
      const conv = await getConversationByIdForUser(id, dbUserId);
      if (!conv) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      res.json({ id, runtime: extractConversationRuntime(conv.metadata) });
    } catch (err: any) {
      logger.error('Failed to load conversation runtime', { error: err.message });
      res.status(500).json({ error: `Failed to load runtime: ${err.message}` });
    }
  });

  router.put('/:id/runtime', async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const id = req.params.id as string;
      const dbUserId = await resolveDbUserId(user.userId);
      const conv = await getConversationByIdForUser(id, dbUserId);
      if (!conv) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      const metadata = await getConversationMetadataForUser(id, dbUserId);
      const currentRuntime = extractConversationRuntime(metadata);
      const runtime = normalizeRuntimeUpdate(req.body, currentRuntime);
      await mergeConversationMetadataForUser(id, dbUserId, { runtime });
      res.json({ ok: true, runtime });
    } catch (err: any) {
      logger.error('Failed to update conversation runtime', { error: err.message });
      res.status(500).json({ error: `Failed to update runtime: ${err.message}` });
    }
  });

  router.post('/:id/compact', async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const id = req.params.id as string;
      const dbUserId = await resolveDbUserId(user.userId);
      const conv = await getConversationByIdForUser(id, dbUserId);
      if (!conv) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      const msgs = await getRecentMessages(id, 120);
      if (msgs.length < 2) {
        res.status(400).json({ error: 'Not enough messages to compact' });
        return;
      }

      const aiMessages = msgs.map((m) => ({
        role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: m.content,
      }));

      const compactedResult = await engine.getAIClient().compactMessages(aiMessages, 'Web conversation compaction');
      let summary = '';
      if (compactedResult.compacted.length > 0 && typeof compactedResult.compacted[0]?.content === 'string') {
        summary = extractSummaryFromCompactedText(compactedResult.compacted[0].content);
      }

      if (!summary) {
        const fallback = await engine.getAIClient().chat({
          systemPrompt: '你是会话压缩器。请总结对话中的目标、关键事实、用户偏好、已完成内容、未完成事项、文件上下文和后续约束。输出简洁中文摘要。',
          messages: [
            ...aiMessages.slice(-80),
            { role: 'user', content: '请压缩总结上面的对话，保留后续继续工作所需的全部关键信息。' },
          ],
          maxTokens: 1200,
          temperature: 0.2,
          effort: 'low',
        });
        summary = fallback.content.trim();
      }

      const metadata = await getConversationMetadataForUser(id, dbUserId);
      const currentRuntime = extractConversationRuntime(metadata);
      const runtime: ConversationRuntimeMetadata = {
        ...(currentRuntime ?? {}),
        compactSummary: summary,
        compactedAt: new Date().toISOString(),
        compactSourceMessages: msgs.length,
        compactTokensSaved: compactedResult.tokensSaved,
      };

      await mergeConversationMetadataForUser(id, dbUserId, { runtime });
      res.json({
        ok: true,
        runtime,
        summary,
        sourceMessages: msgs.length,
        tokensSaved: compactedResult.tokensSaved,
      });
    } catch (err: any) {
      logger.error('Failed to compact conversation', { error: err.message });
      res.status(500).json({ error: `Failed to compact conversation: ${err.message}` });
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
        runtime: extractConversationRuntime(conv.metadata),
        messages: msgs.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          agent: m.agentId,
          artifacts: Array.isArray((m.metadata as any)?.artifacts) ? (m.metadata as any).artifacts : undefined,
          skillUsed: (m.metadata as any)?.skill,
          pluginUsed: Array.isArray((m.metadata as any)?.pluginUsed) ? (m.metadata as any).pluginUsed : undefined,
          executionPath: Array.isArray((m.metadata as any)?.executionPath) ? (m.metadata as any).executionPath : undefined,
          memoryHits: typeof (m.metadata as any)?.memoryHits === 'number' ? (m.metadata as any).memoryHits : undefined,
          routePlan: (m.metadata as any)?.routePlan,
          routingReason: typeof (m.metadata as any)?.routingReason === 'string' ? (m.metadata as any).routingReason : undefined,
          requiredCapabilities: Array.isArray((m.metadata as any)?.requiredCapabilities) ? (m.metadata as any).requiredCapabilities : undefined,
          artifactPlan: (m.metadata as any)?.artifactPlan,
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
