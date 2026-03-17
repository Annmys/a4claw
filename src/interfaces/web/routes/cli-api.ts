import { Router, Request, Response } from 'express';
import { spawn, execSync } from 'child_process';
import logger from '../../../utils/logger.js';
import { Engine } from '../../../core/engine.js';

/** Env override to avoid "nested session" error when spawning CLI */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  return env;
}

/**
 * Run `claude auth login` via `script` (pty wrapper) so the CLI writes its
 * OAuth URL to a file we can read. Returns the captured auth URL or null.
 */
function captureLoginUrl(): Promise<string | null> {
  return new Promise((resolve) => {
    const outFile = `/tmp/claude-login-${Date.now()}.txt`;
    const proc = spawn('script', ['-qc', 'claude auth login', outFile], {
      env: cleanEnv(),
      stdio: 'ignore',
      detached: true,
    });
    proc.unref();

    // Poll the output file for the auth URL (max ~25s)
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      try {
        const content = execSync(`cat ${outFile} 2>/dev/null | strings`, { env: cleanEnv() }).toString();
        const match = content.match(/(https:\/\/claude\.ai\/oauth\/authorize[^\s\x1b\x00-\x1f]+)/);
        if (match) {
          clearInterval(interval);
          resolve(match[1]);
          return;
        }
      } catch {}
      if (attempts > 25) {
        clearInterval(interval);
        resolve(null);
      }
    }, 1000);
  });
}

export function setupCLIRoutes(engine: Engine): Router {
  const router = Router();

  // GET /api/cli/status — Claude Code CLI connection status
  router.get('/status', (_req: Request, res: Response) => {
    const adapter = engine.getAIClient().getClaudeCodeAdapter();
    if (!adapter) {
      res.json({ available: false, authenticated: false, cliPath: 'claude', lastCheckAt: 0 });
      return;
    }
    const status = (adapter as any).provider?.getStatus?.() ?? {
      available: adapter.available,
      authenticated: adapter.available,
      cliPath: 'claude',
      lastCheckAt: 0,
    };
    res.json(status);
  });

  // POST /api/cli/auth — Trigger OAuth login and return auth URL for the user
  router.post('/auth', async (_req: Request, res: Response) => {
    try {
      // Step 1: Logout first to clear stale credentials
      try {
        execSync('claude auth logout', { env: cleanEnv(), timeout: 10000 });
        logger.info('Claude CLI: cleared old credentials');
      } catch {
        // Ignore — might already be logged out
      }

      // Step 2: Trigger login and capture the OAuth URL
      logger.info('Claude CLI login triggered from dashboard — capturing auth URL');
      const authUrl = await captureLoginUrl();

      if (authUrl) {
        logger.info('Claude CLI auth URL captured successfully');
        res.json({
          ok: true,
          authUrl,
          message: 'Open the link below to authenticate with Anthropic',
        });
      } else {
        logger.warn('Claude CLI: could not capture auth URL');
        res.json({
          ok: false,
          authUrl: null,
          message: 'Could not get auth URL. Make sure Claude CLI is installed (claude --version).',
        });
      }
    } catch (err: any) {
      logger.error('Failed to trigger Claude CLI login', { error: err.message });
      res.status(500).json({ ok: false, authUrl: null, message: `Failed to launch Claude CLI: ${err.message}` });
    }
  });

  // POST /api/cli/recheck — Re-check CLI availability after auth
  router.post('/recheck', async (_req: Request, res: Response) => {
    try {
      // Quick check via auth status first
      try {
        const raw = execSync('claude auth status', { env: cleanEnv(), timeout: 10000 }).toString();
        const parsed = JSON.parse(raw);
        if (!parsed.loggedIn) {
          res.json({ available: false, authenticated: false, cliPath: 'claude', lastCheckAt: Date.now() });
          return;
        }
      } catch {
        // auth status failed — try full init
      }

      await engine.getAIClient().initClaudeCode();
      const adapter = engine.getAIClient().getClaudeCodeAdapter();
      const status = (adapter as any)?.provider?.getStatus?.() ?? {
        available: adapter?.available ?? false,
        authenticated: adapter?.available ?? false,
        cliPath: 'claude',
        lastCheckAt: Date.now(),
      };
      logger.info('Claude CLI re-checked from dashboard', { available: status.available, authenticated: status.authenticated });
      res.json(status);
    } catch (err: any) {
      logger.error('CLI recheck failed', { error: err.message });
      res.status(500).json({ available: false, authenticated: false, error: err.message });
    }
  });

  return router;
}
