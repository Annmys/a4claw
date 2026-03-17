import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';
import logger from '../utils/logger.js';

export type NotificationType =
  | 'model_new'
  | 'model_deprecated'
  | 'price_change'
  | 'skill_installed'
  | 'agent_created'
  | 'self_repair'
  | 'evolution_complete'
  | 'update_available'
  | 'ecosystem_discovery'
  | 'security_alert'
  | 'cron_publish';

export type NotificationSeverity = 'info' | 'warning' | 'success' | 'critical';
export type NotificationSource = 'llm-tracker' | 'auto-upgrade' | 'evolution' | 'heartbeat' | 'updater' | 'ecosystem-scanner' | 'self-repair' | 'system';

export interface SystemNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  severity: NotificationSeverity;
  source: NotificationSource;
  createdAt: number;
  readAt: number | null;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
}

const MAX_NOTIFICATIONS = 200;
const PERSIST_PATH = join(process.cwd(), 'data', 'notifications.json');

/** WebSocket emitter — set from ws.ts at startup */
let wsEmitter: ((notification: SystemNotification) => void) | null = null;

export function setNotificationEmitter(emitter: (notification: SystemNotification) => void) {
  wsEmitter = emitter;
}

class NotificationStoreImpl {
  private notifications: SystemNotification[] = [];
  private dirty = false;

  push(params: Omit<SystemNotification, 'id' | 'createdAt' | 'readAt'>): SystemNotification {
    const notification: SystemNotification = {
      ...params,
      id: randomUUID(),
      createdAt: Date.now(),
      readAt: null,
    };

    this.notifications.unshift(notification);

    // Auto-prune oldest beyond limit
    if (this.notifications.length > MAX_NOTIFICATIONS) {
      this.notifications = this.notifications.slice(0, MAX_NOTIFICATIONS);
    }

    this.dirty = true;

    // Push to connected WebSocket clients
    if (wsEmitter) {
      try { wsEmitter(notification); } catch { /* ignore */ }
    }

    logger.info('Notification pushed', {
      type: notification.type,
      severity: notification.severity,
      title: notification.title.slice(0, 60),
    });

    return notification;
  }

  markRead(id: string): boolean {
    const n = this.notifications.find(n => n.id === id);
    if (n && !n.readAt) {
      n.readAt = Date.now();
      this.dirty = true;
      return true;
    }
    return false;
  }

  markAllRead(): number {
    let count = 0;
    const now = Date.now();
    for (const n of this.notifications) {
      if (!n.readAt) {
        n.readAt = now;
        count++;
      }
    }
    if (count > 0) this.dirty = true;
    return count;
  }

  getAll(options?: { unreadOnly?: boolean; limit?: number; type?: NotificationType }): SystemNotification[] {
    let result = this.notifications;
    if (options?.unreadOnly) result = result.filter(n => !n.readAt);
    if (options?.type) result = result.filter(n => n.type === options.type);
    if (options?.limit) result = result.slice(0, options.limit);
    return result;
  }

  getUnreadCount(): number {
    return this.notifications.filter(n => !n.readAt).length;
  }

  clear(): void {
    this.notifications = [];
    this.dirty = true;
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    try {
      const dir = dirname(PERSIST_PATH);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(PERSIST_PATH, JSON.stringify(this.notifications, null, 2), 'utf-8');
      this.dirty = false;
    } catch (err: any) {
      logger.warn('Failed to persist notifications', { error: err.message });
    }
  }

  async loadFromDisk(): Promise<void> {
    try {
      if (existsSync(PERSIST_PATH)) {
        const raw = readFileSync(PERSIST_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.notifications = parsed.slice(0, MAX_NOTIFICATIONS);
          logger.info('Loaded notifications from disk', { count: this.notifications.length });
        }
      }
    } catch (err: any) {
      logger.warn('Failed to load notifications', { error: err.message });
    }
  }

  getCount(): number {
    return this.notifications.length;
  }
}

/** Global singleton */
export const notificationStore = new NotificationStoreImpl();
