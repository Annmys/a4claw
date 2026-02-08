import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import helmet from 'helmet';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import { Engine } from '../../core/engine.js';
import { BaseInterface } from '../base.js';
import { setupApiRoutes } from './routes/api.js';
import { setupAuthRoutes } from './routes/auth.js';
import { setupWebSocket } from './routes/ws.js';
import { authMiddleware } from './middleware/auth.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { setupDashboardRoutes } from './routes/dashboard.js';
import { setupWebhookRoutes } from './routes/webhook.js';

export class WebServer extends BaseInterface {
  name = 'Web';
  private app: express.Express;
  private server: ReturnType<typeof createServer>;
  private wss: WebSocketServer;

  constructor(engine: Engine) {
    super(engine);
    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });

    this.setupMiddleware();
    this.setupRoutes();
    setupWebSocket(this.wss, this.engine);
  }

  private setupMiddleware() {
    this.app.use(helmet());
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(rateLimitMiddleware);

    // Global error handler for malformed JSON (entity.parse.failed)
    this.app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (err.type === 'entity.parse.failed') {
        logger.warn('Malformed JSON in request body', { message: err.message });
        res.status(400).json({ error: 'Invalid JSON in request body' });
        return;
      }
      next(err);
    });
  }

  private setupRoutes() {
    // Webhook routes — no auth middleware (OpenClaw authenticates via shared knowledge)
    this.app.use('/webhook', setupWebhookRoutes());
    this.app.use('/api/auth', setupAuthRoutes());
    this.app.use('/api', authMiddleware, setupApiRoutes(this.engine));
    // Dashboard API routes
    this.app.use('/api/dashboard', setupDashboardRoutes({
      getUptime: () => process.uptime(),
      getCronTasks: () => this.engine.getCronEngine()?.listTasks() ?? [],
      getUsageSummary: () => this.engine.getUsageTracker()?.getTodaySummary() ?? { totalCost: 0, byModel: {}, byAction: {}, totalCalls: 0 },
      getWorkflowCount: () => 0,
      getMcpInfo: () => ({ servers: 0, tools: 0 }),
    }));
    // Serve dashboard HTML
    this.app.use('/dashboard', express.static(new URL('./public', import.meta.url).pathname));
    this.app.get('/health', (_req, res) => {
      const mem = process.memoryUsage();
      res.json({
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        version: '5.0.0',
        memory: {
          heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
          rssMB: Math.round(mem.rss / 1024 / 1024),
        },
        providers: this.engine.getAIClient().getAvailableProviders(),
        timestamp: new Date().toISOString(),
      });
    });
    this.app.get('/', (_req, res) => res.json({
      name: 'ClawdAgent',
      status: 'running',
      uptime: process.uptime(),
      interfaces: ['Telegram', 'WhatsApp', 'Web'],
      dashboard: 'http://localhost:5173',
      api: { auth: '/api/auth', chat: '/api/chat', health: '/health' },
    }));
  }

  async start() {
    return new Promise<void>((resolve) => {
      this.server.listen(config.PORT, () => {
        logger.info(`Web server started on port ${config.PORT}`);
        resolve();
      });
    });
  }

  async stop() {
    this.wss.close();
    return new Promise<void>((resolve) => { this.server.close(() => resolve()); });
  }
}
