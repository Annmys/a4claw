import { Router, Request, Response } from 'express';
import logger from '../../../utils/logger.js';
import { notificationStore } from '../../../core/notification-store.js';

/** Dependencies injected from server.ts */
interface EvolutionDeps {
  getLLMTracker: () => { getKnownModels: () => unknown[]; getRecentUpdates: (limit?: number) => unknown[]; getModelCount: () => number; getLastScanAt: () => number; getProviderSummary: () => Record<string, number>; scan: () => Promise<unknown[]> } | null;
  getEcosystemScanner: () => { getDiscoveries: (limit?: number) => unknown[]; getLastScanAt: () => number; discover: () => Promise<unknown> } | null;
  getEvolutionEngine: () => { getStatus: () => unknown; evolve: (full?: boolean) => Promise<unknown> } | null;
  getServiceTracker?: () => { getState: () => unknown; scan: () => Promise<unknown[]> } | null;
}

export function setupEvolutionRoutes(deps: EvolutionDeps): Router {
  const router = Router();

  // GET /api/evolution/status — full evolution status
  router.get('/status', (_req: Request, res: Response) => {
    try {
      const evolution = deps.getEvolutionEngine();
      const llmTracker = deps.getLLMTracker();
      const scanner = deps.getEcosystemScanner();

      res.json({
        evolution: evolution?.getStatus() ?? null,
        llmTracker: llmTracker ? {
          modelCount: llmTracker.getModelCount(),
          lastScanAt: llmTracker.getLastScanAt(),
          providerSummary: llmTracker.getProviderSummary(),
          recentUpdates: llmTracker.getRecentUpdates(10),
        } : null,
        ecosystemScanner: scanner ? {
          discoveryCount: scanner.getDiscoveries().length,
          lastScanAt: scanner.getLastScanAt(),
        } : null,
        notifications: {
          total: notificationStore.getCount(),
          unread: notificationStore.getUnreadCount(),
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/evolution/models — LLM ecosystem model list
  router.get('/models', (req: Request, res: Response) => {
    try {
      const tracker = deps.getLLMTracker();
      if (!tracker) {
        res.json({ models: [], summary: {} });
        return;
      }

      const provider = req.query.provider as string | undefined;
      let models = tracker.getKnownModels() as Array<Record<string, unknown>>;
      if (provider) {
        models = models.filter(m => m.provider === provider);
      }

      const limit = parseInt(req.query.limit as string) || 100;
      res.json({
        models: models.slice(0, limit),
        total: models.length,
        summary: tracker.getProviderSummary(),
        lastScanAt: tracker.getLastScanAt(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/evolution/discovered — ecosystem scanner discoveries
  router.get('/discovered', (_req: Request, res: Response) => {
    try {
      const scanner = deps.getEcosystemScanner();
      const limit = parseInt(_req.query.limit as string) || 50;
      res.json({
        items: scanner?.getDiscoveries(limit) ?? [],
        lastScanAt: scanner?.getLastScanAt() ?? 0,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/evolution/trigger — manually trigger evolution cycle
  router.post('/trigger', async (req: Request, res: Response) => {
    try {
      const full = req.body.full === true;
      const evolution = deps.getEvolutionEngine();
      if (!evolution) {
        res.status(503).json({ error: 'Evolution engine not available' });
        return;
      }

      // Run in background
      evolution.evolve(full).catch(err =>
        logger.error('Manual evolution trigger failed', { error: err.message })
      );

      res.json({ success: true, message: `Evolution cycle triggered (full=${full})` });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/evolution/scan-models — manually trigger LLM scan
  router.post('/scan-models', async (_req: Request, res: Response) => {
    try {
      const tracker = deps.getLLMTracker();
      if (!tracker) {
        res.status(503).json({ error: 'LLM tracker not available' });
        return;
      }
      const updates = await tracker.scan();
      res.json({ success: true, updates });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/evolution/scan-ecosystem — manually trigger ecosystem scan
  router.post('/scan-ecosystem', async (_req: Request, res: Response) => {
    try {
      const scanner = deps.getEcosystemScanner();
      if (!scanner) {
        res.status(503).json({ error: 'Ecosystem scanner not available' });
        return;
      }
      const result = await scanner.discover();
      res.json({ success: true, result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/evolution/services — service tracker state (Kie, fal, Blotato)
  router.get('/services', (_req: Request, res: Response) => {
    try {
      const tracker = deps.getServiceTracker?.();
      if (!tracker) {
        res.json({ items: {}, lastScanAt: 0, scanCount: 0, updates: [] });
        return;
      }
      res.json(tracker.getState());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/evolution/scan-services — manually trigger service scan
  router.post('/scan-services', async (_req: Request, res: Response) => {
    try {
      const tracker = deps.getServiceTracker?.();
      if (!tracker) {
        res.status(503).json({ error: 'Service tracker not available' });
        return;
      }
      const updates = await tracker.scan();
      res.json({ success: true, updates });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Notification endpoints ──

  // GET /api/evolution/notifications — list notifications
  router.get('/notifications', (req: Request, res: Response) => {
    const unreadOnly = req.query.unread === 'true';
    const limit = parseInt(req.query.limit as string) || 50;
    const type = req.query.type as string | undefined;

    res.json({
      notifications: notificationStore.getAll({
        unreadOnly,
        limit,
        ...(type ? { type: type as any } : {}),
      }),
      unreadCount: notificationStore.getUnreadCount(),
      total: notificationStore.getCount(),
    });
  });

  // GET /api/evolution/notifications/unread-count
  router.get('/notifications/unread-count', (_req: Request, res: Response) => {
    res.json({ count: notificationStore.getUnreadCount() });
  });

  // POST /api/evolution/notifications/:id/read
  router.post('/notifications/:id/read', (req: Request, res: Response) => {
    const success = notificationStore.markRead(String(req.params.id));
    res.json({ success });
  });

  // POST /api/evolution/notifications/read-all
  router.post('/notifications/read-all', (_req: Request, res: Response) => {
    const count = notificationStore.markAllRead();
    res.json({ success: true, marked: count });
  });

  return router;
}
