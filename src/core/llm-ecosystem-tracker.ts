import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import logger from '../utils/logger.js';
import { notificationStore } from './notification-store.js';

const STATE_PATH = join(process.cwd(), 'data', 'llm-ecosystem-state.json');

export interface TrackedModel {
  id: string;
  name: string;
  provider: string;
  costPer1kInput: number;
  costPer1kOutput: number;
  contextLength: number;
  supportsTools: boolean;
  supportsVision: boolean;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface EcosystemUpdate {
  id: string;
  type: 'new_model' | 'price_change' | 'deprecation' | 'new_capability';
  provider: string;
  modelId: string;
  modelName: string;
  details: string;
  detailsHe: string;
  significance: 'low' | 'medium' | 'high';
  detectedAt: number;
}

interface EcosystemState {
  models: Record<string, TrackedModel>;
  lastScanAt: number;
  updates: EcosystemUpdate[];
}

export class LLMEcosystemTracker {
  private state: EcosystemState = { models: {}, lastScanAt: 0, updates: [] };
  private openrouterApiKey: string;
  private evolutionMode: string;
  private notifyNewModels: boolean;
  private notifyPriceChanges: boolean;
  private notifyDeprecations: boolean;

  constructor(opts: {
    openrouterApiKey?: string;
    evolutionMode?: string;
    notifyNewModels?: boolean;
    notifyPriceChanges?: boolean;
    notifyDeprecations?: boolean;
  }) {
    this.openrouterApiKey = opts.openrouterApiKey || '';
    this.evolutionMode = opts.evolutionMode || 'notify';
    this.notifyNewModels = opts.notifyNewModels ?? true;
    this.notifyPriceChanges = opts.notifyPriceChanges ?? false;
    this.notifyDeprecations = opts.notifyDeprecations ?? true;
    this.loadState();
  }

  updateSettings(opts: {
    evolutionMode?: string;
    notifyNewModels?: boolean;
    notifyPriceChanges?: boolean;
    notifyDeprecations?: boolean;
  }) {
    if (opts.evolutionMode !== undefined) this.evolutionMode = opts.evolutionMode;
    if (opts.notifyNewModels !== undefined) this.notifyNewModels = opts.notifyNewModels;
    if (opts.notifyPriceChanges !== undefined) this.notifyPriceChanges = opts.notifyPriceChanges;
    if (opts.notifyDeprecations !== undefined) this.notifyDeprecations = opts.notifyDeprecations;
  }

  async scan(): Promise<EcosystemUpdate[]> {
    if (this.evolutionMode === 'disabled') return [];

    const updates: EcosystemUpdate[] = [];
    const now = Date.now();

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.openrouterApiKey) {
        headers['Authorization'] = `Bearer ${this.openrouterApiKey}`;
      }

      const resp = await fetch('https://openrouter.ai/api/v1/models', { headers, signal: AbortSignal.timeout(30000) });
      if (!resp.ok) {
        logger.warn('LLM Tracker: OpenRouter API error', { status: resp.status });
        return [];
      }

      const data = await resp.json() as { data?: Array<Record<string, unknown>> };
      const models = data.data;
      if (!Array.isArray(models)) return [];

      const currentIds = new Set<string>();

      for (const m of models) {
        const id = String(m.id || '');
        if (!id) continue;
        currentIds.add(id);

        const provider = id.split('/')[0] || 'unknown';
        const name = String(m.name || id);
        const pricing = m.pricing as Record<string, string> | undefined;
        const costInput = parseFloat(pricing?.prompt || '0') * 1000;
        const costOutput = parseFloat(pricing?.completion || '0') * 1000;
        const contextLength = Number(m.context_length || 0);
        const arch = m.architecture as Record<string, unknown> | undefined;
        const supportsVision = String(arch?.modality || '').includes('image');
        const supportedParams = m.supported_parameters;
        const supportsTools = Array.isArray(supportedParams) && supportedParams.includes('tools');

        const existing = this.state.models[id];

        if (!existing) {
          this.state.models[id] = {
            id, name, provider,
            costPer1kInput: costInput, costPer1kOutput: costOutput,
            contextLength, supportsTools, supportsVision,
            firstSeenAt: now, lastSeenAt: now,
          };

          // Only notify after first scan
          if (this.state.lastScanAt > 0) {
            const significance = this.classifySignificance(provider, name, contextLength);
            const update: EcosystemUpdate = {
              id: `upd_${now}_${Math.random().toString(36).slice(2, 6)}`,
              type: 'new_model', provider, modelId: id, modelName: name,
              details: `New model: ${name} (${provider}) — context: ${contextLength.toLocaleString()}, cost: $${costInput.toFixed(4)}/$${costOutput.toFixed(4)}/1k tokens`,
              detailsHe: `新模型：${name} (${provider}) — 上下文：${contextLength.toLocaleString()}，成本：$${costInput.toFixed(4)}/$${costOutput.toFixed(4)}/1k tokens`,
              significance, detectedAt: now,
            };
            updates.push(update);

            if (this.notifyNewModels && significance !== 'low') {
              notificationStore.push({
                type: 'model_new',
                title: `🆕 新模型：${name}`,
                body: update.detailsHe,
                severity: significance === 'high' ? 'warning' : 'info',
                source: 'llm-tracker',
                actionUrl: '/evolution',
                metadata: { modelId: id, provider },
              });
            }
          }
        } else {
          existing.lastSeenAt = now;
          // Check for price changes
          if (Math.abs(existing.costPer1kInput - costInput) > 0.0001 || Math.abs(existing.costPer1kOutput - costOutput) > 0.0001) {
            const update: EcosystemUpdate = {
              id: `upd_${now}_${Math.random().toString(36).slice(2, 6)}`,
              type: 'price_change', provider, modelId: id, modelName: name,
              details: `Price change: ${name} — input $${existing.costPer1kInput.toFixed(4)}→$${costInput.toFixed(4)}, output $${existing.costPer1kOutput.toFixed(4)}→$${costOutput.toFixed(4)}`,
              detailsHe: `价格变化：${name} — 输入 $${existing.costPer1kInput.toFixed(4)}→$${costInput.toFixed(4)}，输出 $${existing.costPer1kOutput.toFixed(4)}→$${costOutput.toFixed(4)}`,
              significance: 'low', detectedAt: now,
            };
            updates.push(update);
            existing.costPer1kInput = costInput;
            existing.costPer1kOutput = costOutput;

            if (this.notifyPriceChanges) {
              notificationStore.push({
                type: 'price_change', title: `💰 价格变化：${name}`,
                body: update.detailsHe, severity: 'info', source: 'llm-tracker', actionUrl: '/evolution',
              });
            }
          }
        }
      }

      // Detect deprecations
      if (this.state.lastScanAt > 0) {
        for (const [id, model] of Object.entries(this.state.models)) {
          if (!currentIds.has(id) && now - model.lastSeenAt > 7 * 24 * 60 * 60 * 1000) {
            const update: EcosystemUpdate = {
              id: `upd_${now}_${Math.random().toString(36).slice(2, 6)}`,
              type: 'deprecation', provider: model.provider, modelId: id, modelName: model.name,
              details: `Deprecated: ${model.name} — no longer available`,
              detailsHe: `已下线：${model.name} — 不再可用`,
              significance: 'medium', detectedAt: now,
            };
            updates.push(update);
            if (this.notifyDeprecations) {
              notificationStore.push({
                type: 'model_deprecated', title: `⚠️ 已下线：${model.name}`,
                body: update.detailsHe, severity: 'warning', source: 'llm-tracker', actionUrl: '/evolution',
              });
            }
          }
        }
      }

      this.state.lastScanAt = now;
      this.state.updates = [...updates, ...this.state.updates].slice(0, 100);
      this.saveState();

      logger.info('LLM Ecosystem scan complete', {
        totalModels: Object.keys(this.state.models).length,
        newUpdates: updates.length,
      });
    } catch (err: any) {
      logger.warn('LLM Ecosystem scan failed', { error: err.message });
    }

    return updates;
  }

  getKnownModels(): TrackedModel[] {
    return Object.values(this.state.models).sort((a, b) => b.firstSeenAt - a.firstSeenAt);
  }

  getRecentUpdates(limit = 20): EcosystemUpdate[] {
    return this.state.updates.slice(0, limit);
  }

  getModelCount(): number {
    return Object.keys(this.state.models).length;
  }

  getLastScanAt(): number {
    return this.state.lastScanAt;
  }

  getProviderSummary(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const m of Object.values(this.state.models)) {
      counts[m.provider] = (counts[m.provider] || 0) + 1;
    }
    return counts;
  }

  private classifySignificance(provider: string, name: string, contextLength: number): 'low' | 'medium' | 'high' {
    const lower = name.toLowerCase();
    const majorProviders = ['anthropic', 'openai', 'google', 'meta-llama'];
    const isMajor = majorProviders.includes(provider);
    const isFlagship = lower.includes('opus') || lower.includes('gpt-5') || lower.includes('gemini-2') || lower.includes('sonnet') || lower.includes('gpt-4o');
    if (isMajor && isFlagship) return 'high';
    if (isMajor || contextLength > 200000) return 'medium';
    return 'low';
  }

  private loadState() {
    try {
      if (existsSync(STATE_PATH)) {
        this.state = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
        logger.info('LLM Ecosystem state loaded', { models: Object.keys(this.state.models).length });
      }
    } catch (err: any) {
      logger.warn('Failed to load LLM state', { error: err.message });
    }
  }

  private saveState() {
    try {
      const dir = dirname(STATE_PATH);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(STATE_PATH, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (err: any) {
      logger.warn('Failed to save LLM state', { error: err.message });
    }
  }
}
