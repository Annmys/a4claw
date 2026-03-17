import logger from '../utils/logger.js';
import { getCache } from '../memory/cache.js';

export interface SyncState {
  lastSyncAt: number;
  syncCount: number;
  pendingOutbound: number;
  pendingInbound: number;
  errors: number;
}

export interface SyncMessage {
  id: string;
  type: 'knowledge' | 'task' | 'status' | 'command' | 'event';
  direction: 'inbound' | 'outbound';
  payload: Record<string, unknown>;
  timestamp: number;
}

type OpenClawExecutor = (action: string, params?: Record<string, unknown>) => Promise<{ success: boolean; output: string; error?: string }>;

export class OpenClawSync {
  private executor: OpenClawExecutor | null = null;
  private syncInterval: NodeJS.Timeout | null = null;
  private state: SyncState = {
    lastSyncAt: 0,
    syncCount: 0,
    pendingOutbound: 0,
    pendingInbound: 0,
    errors: 0,
  };
  private outboundQueue: SyncMessage[] = [];
  private syncIntervalMs: number;

  constructor(intervalMs: number = 300000) { // 5 min default
    this.syncIntervalMs = intervalMs;
  }

  setExecutor(executor: OpenClawExecutor): void {
    this.executor = executor;
  }

  /** Start periodic bidirectional sync */
  start(): void {
    if (this.syncInterval) return;

    this.syncInterval = setInterval(() => {
      this.sync().catch(err => {
        logger.debug('OpenClaw sync error', { error: err.message });
        this.state.errors++;
      });
    }, this.syncIntervalMs);

    // Initial sync
    this.sync().catch(() => {});
    logger.info('OpenClaw sync started', { intervalMs: this.syncIntervalMs });
  }

  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  /** Queue a message to sync to OpenClaw */
  queueOutbound(message: Omit<SyncMessage, 'direction' | 'timestamp'>): void {
    this.outboundQueue.push({
      ...message,
      direction: 'outbound',
      timestamp: Date.now(),
    });
    this.state.pendingOutbound = this.outboundQueue.length;
  }

  /** Full bidirectional sync cycle */
  async sync(): Promise<void> {
    if (!this.executor) return;

    // 1. Push outbound messages
    await this.pushOutbound();

    // 2. Pull inbound status
    await this.pullInbound();

    // 3. Sync shared memory
    await this.syncSharedMemory();

    this.state.lastSyncAt = Date.now();
    this.state.syncCount++;
  }

  private async pushOutbound(): Promise<void> {
    if (!this.executor || this.outboundQueue.length === 0) return;

    const batch = this.outboundQueue.splice(0, 10); // Process max 10 at a time
    this.state.pendingOutbound = this.outboundQueue.length;

    for (const msg of batch) {
      try {
        if (msg.type === 'knowledge') {
          await this.executor('send', {
            to: 'system',
            message: `[SYNC:KNOWLEDGE] ${JSON.stringify(msg.payload)}`,
          });
        } else if (msg.type === 'task') {
          await this.executor('send', {
            to: 'system',
            message: `[SYNC:TASK] ${JSON.stringify(msg.payload)}`,
          });
        } else if (msg.type === 'event') {
          await this.executor('send', {
            to: 'system',
            message: `[SYNC:EVENT] ${JSON.stringify(msg.payload)}`,
          });
        }
      } catch (err: any) {
        logger.debug('Outbound sync failed', { type: msg.type, error: err.message });
        this.state.errors++;
      }
    }
  }

  private async pullInbound(): Promise<void> {
    if (!this.executor) return;

    try {
      const result = await this.executor('health', {});
      if (result.success) {
        // Cache OpenClaw status
        const cache = getCache();
        if (cache) {
          await cache.set('openclaw:status', result.output, 'EX', 600);
        }
      }
    } catch (err: any) {
      logger.debug('Inbound sync failed', { error: err.message });
    }
  }

  private async syncSharedMemory(): Promise<void> {
    if (!this.executor) return;

    const cache = getCache();
    if (!cache) return;

    try {
      // Push ClawdAgent's important state to shared cache
      const agentState = {
        lastSync: Date.now(),
        syncCount: this.state.syncCount,
        uptime: process.uptime(),
        memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      };
      await cache.set('openclaw:shared:clawdagent_state', JSON.stringify(agentState), 'EX', 600);

      // Read OpenClaw's shared state (if available)
      const openclawState = await cache.get('openclaw:shared:openclaw_state');
      if (openclawState) {
        this.state.pendingInbound = 0; // Successfully read state
      }
    } catch (err: any) {
      logger.debug('Shared memory sync failed', { error: err.message });
    }
  }

  getState(): SyncState {
    return { ...this.state };
  }

  isRunning(): boolean {
    return this.syncInterval !== null;
  }
}
