import logger from '../utils/logger.js';
import { notificationStore } from './notification-store.js';

export interface DiscoveredItem {
  id: string;
  type: 'mcp-server' | 'skill-repo' | 'npm-package' | 'agent-framework';
  name: string;
  description: string;
  url: string;
  stars?: number;
  relevanceScore: number;
  discoveredAt: number;
}

export class EcosystemScanner {
  private knownIds = new Set<string>();
  private discoveries: DiscoveredItem[] = [];
  private lastScanAt = 0;
  private evolutionMode: string;

  constructor(opts: { evolutionMode?: string } = {}) {
    this.evolutionMode = opts.evolutionMode || 'notify';
  }

  updateSettings(opts: { evolutionMode?: string }) {
    if (opts.evolutionMode !== undefined) this.evolutionMode = opts.evolutionMode;
  }

  async discover(): Promise<{ items: DiscoveredItem[]; errors: string[]; scannedAt: number }> {
    if (this.evolutionMode === 'disabled') {
      return { items: [], errors: [], scannedAt: Date.now() };
    }

    const items: DiscoveredItem[] = [];
    const errors: string[] = [];
    const now = Date.now();

    // Source 1: GitHub — MCP servers and AI agent repos
    try {
      const ghItems = await this.scanGitHub();
      items.push(...ghItems);
    } catch (err: any) {
      errors.push(`GitHub: ${err.message}`);
    }

    // Source 2: npm — MCP server packages
    try {
      const npmItems = await this.scanNpm();
      items.push(...npmItems);
    } catch (err: any) {
      errors.push(`npm: ${err.message}`);
    }

    // Deduplicate
    const newItems = items.filter(item => {
      const key = `${item.type}:${item.name}`;
      if (this.knownIds.has(key)) return false;
      this.knownIds.add(key);
      return true;
    });

    // Notify for high-relevance discoveries
    for (const item of newItems) {
      if (item.relevanceScore >= 6) {
        this.discoveries.push(item);
        notificationStore.push({
          type: 'ecosystem_discovery',
          title: `🔍 发现：${item.name}`,
          body: `${item.description}\n⭐ ${item.stars || 0} stars | 评分：${item.relevanceScore}/10`,
          severity: item.relevanceScore >= 8 ? 'warning' : 'info',
          source: 'ecosystem-scanner',
          actionUrl: '/evolution',
          metadata: { url: item.url, type: item.type, stars: item.stars },
        });
      }
    }

    this.lastScanAt = now;
    if (this.discoveries.length > 100) this.discoveries = this.discoveries.slice(-100);

    logger.info('Ecosystem scan complete', {
      total: items.length, new: newItems.length,
      relevant: newItems.filter(i => i.relevanceScore >= 6).length,
    });

    return { items: newItems, errors, scannedAt: now };
  }

  getDiscoveries(limit = 50): DiscoveredItem[] {
    return this.discoveries.slice(-limit).reverse();
  }

  getLastScanAt(): number {
    return this.lastScanAt;
  }

  private async scanGitHub(): Promise<DiscoveredItem[]> {
    const items: DiscoveredItem[] = [];
    const now = Date.now();
    const queries = [
      'topic:mcp-server language:typescript sort:stars',
      '"mcp server" claude stars:>10',
    ];

    for (const q of queries) {
      try {
        const resp = await fetch(
          `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=15`,
          {
            headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'ClawdAgent/6.0' },
            signal: AbortSignal.timeout(15000),
          }
        );
        if (!resp.ok) continue;
        const data = await resp.json() as { items?: Array<Record<string, unknown>> };
        if (!data.items) continue;

        for (const repo of data.items) {
          const name = String(repo.full_name || '');
          const desc = String(repo.description || '').slice(0, 200);
          const stars = Number(repo.stargazers_count || 0);
          const url = String(repo.html_url || '');
          const topics = (repo.topics as string[]) || [];

          let score = 0;
          if (topics.includes('mcp-server') || topics.includes('mcp')) score += 4;
          if (topics.includes('ai-agent') || topics.includes('autonomous')) score += 3;
          if (topics.includes('claude') || topics.includes('anthropic')) score += 2;
          if (stars > 100) score += 2;
          else if (stars > 20) score += 1;
          score = Math.min(score, 10);

          const type = topics.includes('mcp-server') || topics.includes('mcp')
            ? 'mcp-server' as const : 'skill-repo' as const;

          items.push({ id: `gh:${name}`, type, name, description: desc, url, stars, relevanceScore: score, discoveredAt: now });
        }
      } catch { /* skip */ }
    }
    return items;
  }

  private async scanNpm(): Promise<DiscoveredItem[]> {
    const items: DiscoveredItem[] = [];
    const now = Date.now();

    try {
      const resp = await fetch(
        'https://registry.npmjs.org/-/v1/search?text=mcp-server&size=20',
        { signal: AbortSignal.timeout(15000) }
      );
      if (!resp.ok) return [];
      const data = await resp.json() as { objects?: Array<{ package: Record<string, unknown>; score?: { final?: number } }> };
      if (!data.objects) return [];

      for (const obj of data.objects) {
        const pkg = obj.package;
        const name = String(pkg.name || '');
        const desc = String(pkg.description || '').slice(0, 200);
        const url = `https://www.npmjs.com/package/${name}`;
        let score = 3 + Math.round((obj.score?.final || 0) * 5);
        if (name.includes('mcp')) score += 2;
        score = Math.min(score, 10);

        items.push({ id: `npm:${name}`, type: 'mcp-server', name, description: desc, url, relevanceScore: score, discoveredAt: now });
      }
    } catch { /* skip */ }
    return items;
  }
}
