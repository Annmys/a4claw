/**
 * Facebook Agent API routes — control autonomous Facebook agents.
 */
import { Router, Request, Response } from 'express';
import { FacebookAgent, type AgentConfig, type ActionType } from '../../../actions/browser/facebook-agent.js';
import { FacebookAccountManager } from '../../../actions/browser/facebook-manager.js';
import logger from '../../../utils/logger.js';

export function setupFacebookAgentRoutes(): Router {
  const router = Router();

  /** GET /api/facebook-agent/agents — list all running agents */
  router.get('/agents', (_req: Request, res: Response) => {
    res.json({ agents: FacebookAgent.listAgents() });
  });

  /** GET /api/facebook-agent/agents/:accountId — get agent status */
  router.get('/agents/:accountId', (req: Request, res: Response) => {
    const agent = FacebookAgent.getAgent(req.params.accountId as string);
    if (!agent) { res.status(404).json({ error: 'No agent for this account' }); return; }
    res.json(agent.getStatus());
  });

  /** POST /api/facebook-agent/agents — create and start an agent */
  router.post('/agents', async (req: Request, res: Response) => {
    try {
      const { accountId, config } = req.body ?? {};
      if (!accountId) { res.status(400).json({ error: 'accountId is required' }); return; }

      // Verify account exists
      const account = FacebookAccountManager.getInstance().getAccount(accountId);
      if (!account) { res.status(404).json({ error: 'Account not found' }); return; }

      // Build config with defaults
      const agentConfig: AgentConfig = {
        accountId,
        actions: config?.actions ?? ['post', 'comment'],
        schedule: config?.schedule ?? {
          post: { intervalMinutes: 60, dailyLimit: 5 },
          comment: { intervalMinutes: 30, dailyLimit: 20 },
          friend_request: { intervalMinutes: 120, dailyLimit: 10 },
          group_join: { intervalMinutes: 180, dailyLimit: 3 },
          message: { intervalMinutes: 45, dailyLimit: 10 },
        },
        activeHours: config?.activeHours ?? {
          weekday: { start: 8, end: 22 },
          weekend: { start: 10, end: 23 },
        },
        content: {
          tone: config?.content?.tone ?? 'friendly and engaging',
          language: config?.content?.language ?? 'Chinese',
          topics: config?.content?.topics ?? ['general'],
          promoLink: config?.content?.promoLink,
          promoFrequency: config?.content?.promoFrequency ?? 0,
          maxLength: config?.content?.maxLength ?? 500,
        },
        safety: config?.safety ?? {
          minDelaySeconds: 30,
          maxActionsPerHour: 15,
          pauseOnErrorCount: 3,
          pauseDurationMinutes: 30,
        },
        groups: config?.groups ?? [],
        testMode: config?.testMode ?? false,
      };

      const agent = FacebookAgent.createAgent(agentConfig);
      await agent.start();

      res.json({ ok: true, status: agent.getStatus() });
    } catch (err: any) {
      logger.warn('Failed to create Facebook agent', { error: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  /** POST /api/facebook-agent/agents/:accountId/stop — stop an agent */
  router.post('/agents/:accountId/stop', async (req: Request, res: Response) => {
    try {
      const agent = FacebookAgent.getAgent(req.params.accountId as string);
      if (!agent) { res.status(404).json({ error: 'No agent for this account' }); return; }
      await agent.stop();
      FacebookAgent.removeAgent(req.params.accountId as string);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** POST /api/facebook-agent/agents/:accountId/pause — pause an agent */
  router.post('/agents/:accountId/pause', (req: Request, res: Response) => {
    const agent = FacebookAgent.getAgent(req.params.accountId as string);
    if (!agent) { res.status(404).json({ error: 'No agent for this account' }); return; }
    agent.pause();
    res.json({ ok: true, status: agent.getStatus() });
  });

  /** POST /api/facebook-agent/agents/:accountId/resume — resume a paused agent */
  router.post('/agents/:accountId/resume', (req: Request, res: Response) => {
    const agent = FacebookAgent.getAgent(req.params.accountId as string);
    if (!agent) { res.status(404).json({ error: 'No agent for this account' }); return; }
    agent.resume();
    res.json({ ok: true, status: agent.getStatus() });
  });

  /** PUT /api/facebook-agent/agents/:accountId/config — update agent config */
  router.put('/agents/:accountId/config', (req: Request, res: Response) => {
    const agent = FacebookAgent.getAgent(req.params.accountId as string);
    if (!agent) { res.status(404).json({ error: 'No agent for this account' }); return; }
    agent.updateConfig(req.body);
    res.json({ ok: true, config: agent.getConfig() });
  });

  /** GET /api/facebook-agent/agents/:accountId/logs — get agent logs */
  router.get('/agents/:accountId/logs', (req: Request, res: Response) => {
    const agent = FacebookAgent.getAgent(req.params.accountId as string);
    if (!agent) { res.status(404).json({ error: 'No agent for this account' }); return; }
    const limit = parseInt(req.query.limit as string) || 50;
    res.json({ logs: agent.getLogs(limit) });
  });

  /** GET /api/facebook-agent/agents/:accountId/config — get agent config */
  router.get('/agents/:accountId/config', (req: Request, res: Response) => {
    const agent = FacebookAgent.getAgent(req.params.accountId as string);
    if (!agent) { res.status(404).json({ error: 'No agent for this account' }); return; }
    res.json(agent.getConfig());
  });

  return router;
}
