/**
 * Service Ecosystem Tracker
 *
 * Monitors Kie.ai, fal.ai, and Blotato for new models, features, and changes.
 * Follows the same pattern as llm-ecosystem-tracker.ts.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import logger from '../utils/logger.js';
import { notificationStore } from './notification-store.js';

const STATE_PATH = join(process.cwd(), 'data', 'service-ecosystem-state.json');

export interface TrackedServiceItem {
  id: string;
  name: string;
  provider: 'kie' | 'fal' | 'blotato';
  type: 'model' | 'feature' | 'platform';
  category?: string;
  status: 'active' | 'deprecated';
  firstSeenAt: number;
  lastSeenAt: number;
  metadata?: Record<string, unknown>;
}

export interface ServiceUpdate {
  type: 'new_model' | 'new_feature' | 'deprecation' | 'new_platform';
  provider: 'kie' | 'fal' | 'blotato';
  itemId: string;
  itemName: string;
  details: string;
  significance: 'low' | 'medium' | 'high';
  detectedAt: number;
}

interface ServiceEcosystemState {
  items: Record<string, TrackedServiceItem>;
  lastScanAt: number;
  scanCount: number;
  updates: ServiceUpdate[];
}

export class ServiceEcosystemTracker {
  private state: ServiceEcosystemState = { items: {}, lastScanAt: 0, scanCount: 0, updates: [] };
  private kieApiKey: string;
  private falApiKey: string;
  private blotatoApiKey: string;

  constructor(opts: { kieApiKey?: string; falApiKey?: string; blotatoApiKey?: string }) {
    this.kieApiKey = opts.kieApiKey || '';
    this.falApiKey = opts.falApiKey || '';
    this.blotatoApiKey = opts.blotatoApiKey || '';
    this.loadState();
  }

  /** Run all three scanners in parallel */
  async scan(): Promise<ServiceUpdate[]> {
    const updates: ServiceUpdate[] = [];
    const isFirstScan = this.state.lastScanAt === 0;

    const results = await Promise.allSettled([
      this.kieApiKey ? this.scanKie() : Promise.resolve([]),
      this.falApiKey ? this.scanFal() : Promise.resolve([]),
      this.blotatoApiKey ? this.scanBlotato() : Promise.resolve([]),
    ]);

    for (const r of results) {
      if (r.status === 'fulfilled') updates.push(...r.value);
    }

    this.state.lastScanAt = Date.now();
    this.state.scanCount++;
    this.state.updates = [...updates, ...this.state.updates].slice(0, 100);
    this.saveState();

    // Only notify after first scan (same pattern as LLMEcosystemTracker)
    if (!isFirstScan) {
      for (const u of updates) {
        try {
          notificationStore.push({
            type: 'ecosystem_discovery',
            title: u.type === 'new_model'
              ? `🆕 ${u.provider}: ${u.itemName}`
              : u.type === 'deprecation'
              ? `⚠️ ${u.provider}: ${u.itemName} deprecated`
              : `✨ ${u.provider}: ${u.itemName}`,
            body: u.details,
            severity: u.significance === 'high' ? 'warning' : 'info',
            source: 'ecosystem-scanner',
            actionUrl: '/evolution',
            metadata: { provider: u.provider, itemId: u.itemId, type: u.type },
          });
        } catch { /* notification push failed — non-fatal */ }
      }
    }

    logger.info('Service ecosystem scan complete', {
      updates: updates.length,
      totalItems: Object.keys(this.state.items).length,
      scanCount: this.state.scanCount,
    });

    return updates;
  }

  /** Get current state for API */
  getState(): ServiceEcosystemState {
    return { ...this.state };
  }

  // ─── Kie.ai Scanner ─────────────────────────────────────────────────────
  private async scanKie(): Promise<ServiceUpdate[]> {
    const updates: ServiceUpdate[] = [];

    try {
      // Try the models endpoint
      const res = await fetch('https://api.kie.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${this.kieApiKey}` },
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const data = await res.json() as any;
        const models = Array.isArray(data) ? data : (data.models || data.data || []);

        for (const m of models) {
          const id = `kie:${m.id || m.model || m.name}`;
          const name = m.name || m.id || m.model || 'unknown';

          if (!this.state.items[id]) {
            this.state.items[id] = {
              id, name, provider: 'kie', type: 'model',
              category: m.category || m.type || 'unknown',
              status: 'active',
              firstSeenAt: Date.now(), lastSeenAt: Date.now(),
              metadata: { original: m },
            };
            updates.push({
              type: 'new_model', provider: 'kie', itemId: id, itemName: name,
              details: `Kie.ai 新模型：${name} (${m.category || 'general'})`,
              significance: 'medium', detectedAt: Date.now(),
            });
          } else {
            this.state.items[id].lastSeenAt = Date.now();
            this.state.items[id].status = 'active';
          }
        }

        // Detect deprecations — items not seen in this scan
        for (const [id, item] of Object.entries(this.state.items)) {
          if (item.provider === 'kie' && item.status === 'active' && Date.now() - item.lastSeenAt > 7 * 86400_000) {
            item.status = 'deprecated';
            updates.push({
              type: 'deprecation', provider: 'kie', itemId: id, itemName: item.name,
              details: `模型 ${item.name} 已不再可用于 Kie.ai`,
              significance: 'low', detectedAt: Date.now(),
            });
          }
        }
      } else {
        logger.debug('Kie.ai models endpoint not available', { status: res.status });
      }
    } catch (err: any) {
      logger.debug('Kie.ai scan failed', { error: err.message });
    }

    return updates;
  }

  // ─── fal.ai Scanner ─────────────────────────────────────────────────────
  private async scanFal(): Promise<ServiceUpdate[]> {
    const updates: ServiceUpdate[] = [];

    try {
      // fal.ai public models API
      const res = await fetch('https://fal.ai/models/api/models', {
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const data = await res.json() as any;
        const models = Array.isArray(data) ? data : (data.models || data.data || []);

        for (const m of models) {
          const endpointId = m.endpoint_id || m.id || m.name;
          if (!endpointId) continue;
          const id = `fal:${endpointId}`;
          const name = m.display_name || m.title || m.name || endpointId;
          const category = m.category || (m.tags || [])[0] || 'unknown';

          if (!this.state.items[id]) {
            this.state.items[id] = {
              id, name, provider: 'fal', type: 'model',
              category,
              status: 'active',
              firstSeenAt: Date.now(), lastSeenAt: Date.now(),
              metadata: { endpointId, category, tags: m.tags },
            };

            // Classify significance
            const isVideo = category === 'video' || name.toLowerCase().includes('video');
            const isFlux = name.toLowerCase().includes('flux');

            updates.push({
              type: 'new_model', provider: 'fal', itemId: id, itemName: name,
              details: `fal.ai 新模型：${name} (${category})`,
              significance: isVideo ? 'high' : isFlux ? 'medium' : 'low',
              detectedAt: Date.now(),
            });
          } else {
            this.state.items[id].lastSeenAt = Date.now();
            this.state.items[id].status = 'active';
          }
        }

        // Detect deprecations
        for (const [id, item] of Object.entries(this.state.items)) {
          if (item.provider === 'fal' && item.status === 'active' && Date.now() - item.lastSeenAt > 7 * 86400_000) {
            item.status = 'deprecated';
            updates.push({
              type: 'deprecation', provider: 'fal', itemId: id, itemName: item.name,
              details: `模型 ${item.name} 已不再可用于 fal.ai`,
              significance: 'low', detectedAt: Date.now(),
            });
          }
        }
      }
    } catch (err: any) {
      logger.debug('fal.ai scan failed', { error: err.message });
    }

    return updates;
  }

  // ─── Blotato Scanner ────────────────────────────────────────────────────
  private async scanBlotato(): Promise<ServiceUpdate[]> {
    const updates: ServiceUpdate[] = [];

    try {
      // Check connected accounts
      const res = await fetch('https://backend.blotato.com/v2/accounts', {
        headers: { 'blotato-api-key': this.blotatoApiKey },
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const data = await res.json() as any;
        const accounts = Array.isArray(data) ? data : (data.accounts || data.data || []);

        for (const acc of accounts) {
          const platform = acc.platform || acc.type || acc.provider || 'unknown';
          const id = `blotato:${acc.id || platform}`;
          const name = acc.name || acc.username || `${platform} account`;

          if (!this.state.items[id]) {
            this.state.items[id] = {
              id, name, provider: 'blotato', type: 'platform',
              category: platform,
              status: 'active',
              firstSeenAt: Date.now(), lastSeenAt: Date.now(),
              metadata: { accountId: acc.id, platform },
            };
            updates.push({
              type: 'new_platform', provider: 'blotato', itemId: id, itemName: name,
              details: `Blotato 新账号：${name} (${platform})`,
              significance: 'medium', detectedAt: Date.now(),
            });
          } else {
            this.state.items[id].lastSeenAt = Date.now();
          }
        }
      }
    } catch (err: any) {
      logger.debug('Blotato scan failed', { error: err.message });
    }

    return updates;
  }

  // ─── State persistence ──────────────────────────────────────────────────
  private loadState(): void {
    try {
      if (existsSync(STATE_PATH)) {
        const raw = readFileSync(STATE_PATH, 'utf-8');
        this.state = JSON.parse(raw);
      }
    } catch {
      logger.debug('No service ecosystem state found, starting fresh');
    }
  }

  private saveState(): void {
    try {
      const dir = dirname(STATE_PATH);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(STATE_PATH, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (err: any) {
      logger.warn('Failed to save service ecosystem state', { error: err.message });
    }
  }
}
