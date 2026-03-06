import { Router, Request, Response } from 'express';
import logger from '../../../utils/logger.js';
import { executeTool } from '../../../core/tool-executor.js';
import { audit } from '../../../security/audit-log.js';

type AuthUser = { userId: string; role: string };
type OpenClawScope = { sessionKey: string; agentId: string };

const RATE_WINDOW_MS = 60_000;
const CHAT_LIMIT_PER_WINDOW = 20;
const AGENT_LIMIT_PER_WINDOW = 10;
const userRateBuckets = new Map<string, number[]>();

function getAuthUser(req: Request, res: Response): AuthUser | null {
  const user = (req as any).user as AuthUser | undefined;
  if (!user?.userId || !user?.role) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return user;
}

function toSafeScopeId(raw: string): string {
  const safe = raw.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
  return safe || 'user';
}

function buildScope(user: AuthUser): OpenClawScope {
  const safeUserId = toSafeScopeId(user.userId);
  return {
    sessionKey: `web:${safeUserId}`,
    agentId: `web_${safeUserId}`,
  };
}

function withActor(input: Record<string, unknown>, user: AuthUser): Record<string, unknown> {
  return {
    ...input,
    _userId: user.userId,
    _userRole: user.role,
  };
}

function takeRateToken(userId: string, limit: number): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const existing = userRateBuckets.get(userId) ?? [];
  const active = existing.filter((ts) => now - ts < RATE_WINDOW_MS);
  if (active.length >= limit) {
    const oldest = active[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - oldest)) / 1000));
    userRateBuckets.set(userId, active);
    return { ok: false, retryAfterSec };
  }
  active.push(now);
  userRateBuckets.set(userId, active);
  return { ok: true };
}

function parseJsonMaybe(raw: string | undefined): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function extractResponseText(rawOutput: string | undefined): string {
  if (!rawOutput) return '';

  const parsed = parseJsonMaybe(rawOutput);
  if (typeof parsed === 'string') return parsed;

  const payloads = parsed?.result?.payloads;
  if (Array.isArray(payloads)) {
    const text = payloads.map((p: any) => p?.text).filter(Boolean).join('\n').trim();
    if (text) return text;
  }

  const fallback = parsed?.text ?? parsed?.message ?? parsed?.summary;
  return typeof fallback === 'string' ? fallback : rawOutput;
}

function extractSessions(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.sessions)) return payload.sessions;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function getSessionKey(session: any): string | null {
  if (typeof session === 'string') return session;
  if (!session || typeof session !== 'object') return null;

  const candidates = [
    session.sessionKey,
    session.session_key,
    session.metadata?.sessionKey,
    session.context?.sessionKey,
    session.context?.session_key,
    session.session?.sessionKey,
    session.session?.key,
  ];
  for (const key of candidates) {
    if (typeof key === 'string' && key.trim()) return key.trim();
  }
  return null;
}

function belongsToScope(session: any, scope: OpenClawScope): boolean {
  const key = getSessionKey(session);
  if (!key) return false;
  return key === scope.sessionKey || key.startsWith(`${scope.sessionKey}:`);
}

/**
 * OpenClaw direct chat API routes.
 * Provides a dedicated interface for communicating directly with OpenClaw,
 * separate from the main agent chat.
 */
export function setupOpenClawRoutes(): Router {
  const router = Router();

  /**
   * POST /api/openclaw/chat
   * Send a message to OpenClaw and wait for the AI response.
   * Uses the 'agent' method which waits for the full response (up to ~120s).
   */
  router.post('/chat', async (req: Request, res: Response) => {
    const user = getAuthUser(req, res);
    if (!user) return;

    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    if (text.length > 4000) {
      res.status(400).json({ error: 'text too long (max 4000 chars)' });
      return;
    }

    const rate = takeRateToken(user.userId, CHAT_LIMIT_PER_WINDOW);
    if (!rate.ok) {
      res.status(429).json({ error: `Too many OpenClaw requests. Retry in ${rate.retryAfterSec}s` });
      return;
    }

    const scope = buildScope(user);

    try {
      const result = await executeTool('openclaw', withActor({
        action: 'agent',
        message: text.trim(),
        sessionKey: scope.sessionKey,
        agentId: scope.agentId,
      }, user));
      const responseText = extractResponseText(result.output);

      await audit(user.userId, 'openclaw.chat', {
        success: result.success,
        sessionKey: scope.sessionKey,
      }, 'web');

      res.json({
        message: responseText || (result.success ? 'No response from OpenClaw' : 'OpenClaw request failed'),
        success: result.success,
        scope,
      });
    } catch (err: any) {
      logger.error('OpenClaw chat error', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/openclaw/agent
   * Run an OpenClaw agent task.
   */
  router.post('/agent', async (req: Request, res: Response) => {
    const user = getAuthUser(req, res);
    if (!user) return;

    const { message, agentId, thinking, deliver } = req.body;
    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const rate = takeRateToken(user.userId, AGENT_LIMIT_PER_WINDOW);
    if (!rate.ok) {
      res.status(429).json({ error: `Too many OpenClaw agent requests. Retry in ${rate.retryAfterSec}s` });
      return;
    }

    const scope = buildScope(user);
    const isAdmin = user.role === 'admin';
    const resolvedAgentId = (isAdmin && typeof agentId === 'string' && agentId.trim())
      ? agentId.trim()
      : scope.agentId;

    try {
      const result = await executeTool('openclaw', withActor({
        action: 'agent',
        message: String(message),
        agentId: resolvedAgentId,
        sessionKey: scope.sessionKey,
        ...(typeof thinking === 'string' ? { thinking } : {}),
        ...(typeof deliver === 'boolean' ? { deliver } : {}),
      }, user));

      await audit(user.userId, 'openclaw.agent', {
        success: result.success,
        agentId: resolvedAgentId,
        sessionKey: scope.sessionKey,
      }, 'web');

      res.json({
        message: result.output || 'Agent task sent',
        success: result.success,
        scope,
        agentId: resolvedAgentId,
        raw: result,
      });
    } catch (err: any) {
      logger.error('OpenClaw agent error', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/openclaw/status
   * Get OpenClaw connection status.
   */
  router.get('/status', async (req: Request, res: Response) => {
    const user = getAuthUser(req, res);
    if (!user) return;
    const scope = buildScope(user);

    try {
      // Use 'health' instead of 'status' — health works without operator.read scope
      const result = await executeTool('openclaw', withActor({ action: 'health' }, user));
      const parsed = parseJsonMaybe(result.output);
      const data = typeof parsed === 'string' ? parsed.slice(0, 500) : parsed;
      res.json({
        status: result.success ? 'connected' : 'error',
        connected: result.success,
        data,
        error: result.error || null,
        scope,
      });
    } catch (err: any) {
      res.json({ status: 'disconnected', connected: false, error: err.message || 'Unknown error', scope });
    }
  });

  /**
   * GET /api/openclaw/sessions
   * List OpenClaw sessions.
   */
  router.get('/sessions', async (req: Request, res: Response) => {
    const user = getAuthUser(req, res);
    if (!user) return;
    const scope = buildScope(user);

    try {
      const result = await executeTool('openclaw', withActor({
        action: 'sessions_list',
      }, user));

      const payload = parseJsonMaybe(result.output);
      const sessions = extractSessions(payload);
      const isAdmin = user.role === 'admin';
      const filteredSessions = isAdmin ? sessions : sessions.filter((s) => belongsToScope(s, scope));

      res.json({
        sessions: filteredSessions,
        success: result.success,
        scope,
        meta: {
          total: sessions.length,
          visible: filteredSessions.length,
          filtered: !isAdmin,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/openclaw/context
   * Return effective OpenClaw scope and permissions for the current user.
   */
  router.get('/context', (req: Request, res: Response) => {
    const user = getAuthUser(req, res);
    if (!user) return;
    const scope = buildScope(user);
    res.json({
      userId: user.userId,
      role: user.role,
      scope,
      permissions: {
        canUseRaw: user.role === 'admin',
        canViewAllSessions: user.role === 'admin',
      },
      limits: {
        chatPerMinute: CHAT_LIMIT_PER_WINDOW,
        agentPerMinute: AGENT_LIMIT_PER_WINDOW,
      },
    });
  });

  /**
   * POST /api/openclaw/raw
   * Send a raw method call to OpenClaw gateway.
   */
  router.post('/raw', async (req: Request, res: Response) => {
    const user = getAuthUser(req, res);
    if (!user) return;
    if (user.role !== 'admin') {
      res.status(403).json({ error: 'Admin only: raw OpenClaw calls are restricted' });
      return;
    }

    const { method, params } = req.body;
    if (!method) {
      res.status(400).json({ error: 'method is required' });
      return;
    }

    try {
      const result = await executeTool('openclaw', withActor({
        action: 'raw',
        method,
        params: params || {},
      }, user));
      await audit(user.userId, 'openclaw.raw', {
        method,
        success: result.success,
      }, 'web');
      res.json({ output: result.output, success: result.success, error: result.error });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

setInterval(() => {
  const now = Date.now();
  for (const [userId, timestamps] of userRateBuckets) {
    const active = timestamps.filter((ts) => now - ts < RATE_WINDOW_MS);
    if (active.length === 0) userRateBuckets.delete(userId);
    else userRateBuckets.set(userId, active);
  }
}, RATE_WINDOW_MS);
