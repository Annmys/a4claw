/**
 * Browser View API routes — manage browser sessions with on-demand VNC streaming.
 */
import { Router, Request, Response } from 'express';
import { BrowserSessionManager } from '../../../actions/browser/session-manager.js';
import logger from '../../../utils/logger.js';
import type { Engine } from '../../../core/engine.js';

export function setupBrowserRoutes(engine: Engine): Router {
  const router = Router();
  const mgr = BrowserSessionManager.getInstance();

  /** GET /api/browser/sessions — list all active sessions */
  router.get('/sessions', (_req: Request, res: Response) => {
    res.json({ sessions: mgr.listSessions() });
  });

  /** POST /api/browser/sessions — create a new browser session */
  router.post('/sessions', async (req: Request, res: Response) => {
    try {
      const { url, withVnc = true } = req.body ?? {};
      const session = await mgr.createSession(url, withVnc);
      res.json(session);
    } catch (err: any) {
      logger.warn('Failed to create browser session', { error: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  /** DELETE /api/browser/sessions/:id — close a session */
  router.delete('/sessions/:id', async (req: Request, res: Response) => {
    try {
      await mgr.closeSession(req.params.id as string);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  /** POST /api/browser/sessions/:id/navigate — navigate to a URL */
  router.post('/sessions/:id/navigate', async (req: Request, res: Response) => {
    try {
      const { url } = req.body ?? {};
      if (!url) { res.status(400).json({ error: 'URL required' }); return; }
      await mgr.navigateTo(req.params.id as string, url);
      const session = mgr.getSession(req.params.id as string);
      res.json({ ok: true, url: session?.url, title: session?.title });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** POST /api/browser/sessions/:id/attach-vnc — attach VNC on-demand */
  router.post('/sessions/:id/attach-vnc', async (req: Request, res: Response) => {
    try {
      const result = await mgr.attachVnc(req.params.id as string);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** POST /api/browser/sessions/:id/detach-vnc — detach VNC to save resources */
  router.post('/sessions/:id/detach-vnc', async (req: Request, res: Response) => {
    try {
      await mgr.detachVnc(req.params.id as string);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** POST /api/browser/sessions/:id/vnc-keepalive — keep VNC alive (frontend polls) */
  router.post('/sessions/:id/vnc-keepalive', (req: Request, res: Response) => {
    mgr.keepVncAlive(req.params.id as string);
    res.json({ ok: true });
  });

  /** POST /api/browser/sessions/:id/ai-action — AI-driven browser automation */
  router.post('/sessions/:id/ai-action', async (req: Request, res: Response) => {
    try {
      const { instruction } = req.body ?? {};
      if (!instruction) { res.status(400).json({ error: 'Instruction required' }); return; }

      const claudeClient = engine.getAIClient();
      const result = await mgr.aiAction(req.params.id as string, instruction, claudeClient);
      const session = mgr.getSession(req.params.id as string);
      res.json({ result, url: session?.url, title: session?.title });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** GET /api/browser/sessions/:id/screenshot — take a screenshot (works headless too) */
  router.get('/sessions/:id/screenshot', async (req: Request, res: Response) => {
    try {
      const png = await mgr.screenshot(req.params.id as string);
      res.setHeader('Content-Type', 'image/png');
      res.send(png);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** GET /api/browser/sessions/:id/snapshot — page element snapshot for AI actions */
  router.get('/sessions/:id/snapshot', async (req: Request, res: Response) => {
    try {
      const page = mgr.getPage(req.params.id as string);
      if (!page) { res.status(404).json({ error: 'Session not found or page not ready' }); return; }

      // Build interactive element map (more reliable than accessibility.snapshot())
      const snapshot = await page.evaluate(`(() => {
        const elements = [];
        const selectors = 'a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [onclick], [data-action], h1, h2, h3, label, img[alt]';
        const nodes = document.querySelectorAll(selectors);
        let ref = 1;
        nodes.forEach(node => {
          const el = node;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          elements.push({
            ref: ref++,
            tag: el.tagName.toLowerCase(),
            role: el.getAttribute('role') || undefined,
            type: el.type || undefined,
            text: (el.innerText || el.textContent || el.alt || '').trim().slice(0, 150) || undefined,
            placeholder: el.placeholder || undefined,
            href: el.href || undefined,
            name: el.name || el.id || undefined,
            ariaLabel: el.getAttribute('aria-label') || undefined,
            visible: rect.top >= 0 && rect.top < window.innerHeight,
            bounds: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
          });
        });
        return {
          elements,
          url: location.href,
          title: document.title,
          scrollY: window.scrollY,
          bodyHeight: document.body.scrollHeight,
          viewHeight: window.innerHeight,
        };
      })()`);
      res.json(snapshot);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** POST /api/browser/sessions/:id/click — click an element by selector */
  router.post('/sessions/:id/click', async (req: Request, res: Response) => {
    try {
      const { selector } = req.body ?? {};
      if (!selector) { res.status(400).json({ error: 'Selector required' }); return; }
      const page = mgr.getPage(req.params.id as string);
      if (!page) { res.status(404).json({ error: 'Session not found' }); return; }
      await page.click(selector, { timeout: 10_000 });
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      res.json({ ok: true, url: page.url(), title: await page.title() });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** POST /api/browser/sessions/:id/type — type text into an element */
  router.post('/sessions/:id/type', async (req: Request, res: Response) => {
    try {
      const { selector, text, submit } = req.body ?? {};
      if (!selector || text === undefined) { res.status(400).json({ error: 'Selector and text required' }); return; }
      const page = mgr.getPage(req.params.id as string);
      if (!page) { res.status(404).json({ error: 'Session not found' }); return; }
      await page.fill(selector, '');
      await page.fill(selector, text);
      if (submit) await page.press(selector, 'Enter');
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** POST /api/browser/sessions/:id/evaluate — run JavaScript on the page */
  router.post('/sessions/:id/evaluate', async (req: Request, res: Response) => {
    try {
      const { script } = req.body ?? {};
      if (!script) { res.status(400).json({ error: 'Script required' }); return; }
      const page = mgr.getPage(req.params.id as string);
      if (!page) { res.status(404).json({ error: 'Session not found' }); return; }
      const result = await page.evaluate(script);
      res.json({ ok: true, result });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** GET /api/browser/resources — system resource usage */
  router.get('/resources', (_req: Request, res: Response) => {
    res.json(mgr.getResources());
  });

  return router;
}
