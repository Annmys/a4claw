import { BaseTool, ToolResult } from './base-tool.js';
import type { UsageTracker } from '../../core/usage-tracker.js';
import config from '../../config.js';

let usageTrackerRef: UsageTracker | null = null;
let claudeCodeSavingsGetter: (() => number) | null = null;

export function setAnalyticsToolDeps(tracker: UsageTracker) {
  usageTrackerRef = tracker;
}

export function setClaudeCodeSavingsGetter(getter: () => number) {
  claudeCodeSavingsGetter = getter;
}

export class AnalyticsTool extends BaseTool {
  name = 'analytics';
  description = 'Usage analytics and cost reporting.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = String(input.action ?? '');

    if (!usageTrackerRef) {
      return { success: false, output: '', error: 'Usage tracker not configured' };
    }

    switch (action) {
      case 'daily': return this.dailyReport();
      case 'cost': return this.costReport();
      case 'keys': return await this.checkApiKeys();
      case 'budget': return this.budgetStatus();
      case 'savings': return this.savingsReport();
      default:
        return { success: false, output: '', error: `Unknown action: ${action}. Use: daily, cost, keys, budget, savings` };
    }
  }

  private dailyReport(): ToolResult {
    if (!usageTrackerRef) return { success: false, output: '', error: 'Not configured' };

    const summary = usageTrackerRef.getTodaySummary();
    const lines: string[] = [`Daily Report:`];
    lines.push(`Total calls: ${summary.totalCalls}`);
    lines.push(`Total cost: $${summary.totalCost.toFixed(4)}`);

    if (Object.keys(summary.byModel).length > 0) {
      lines.push(`\nBy model:`);
      for (const [model, cost] of Object.entries(summary.byModel)) {
        lines.push(`  ${model}: $${cost.toFixed(4)}`);
      }
    }

    if (Object.keys(summary.byAction).length > 0) {
      lines.push(`\nBy action:`);
      for (const [action, cost] of Object.entries(summary.byAction)) {
        lines.push(`  ${action}: $${cost.toFixed(4)}`);
      }
    }

    const budgetLeft = usageTrackerRef.getDailyBudgetLeft();
    lines.push(`\nBudget remaining: $${budgetLeft.toFixed(2)}`);

    return { success: true, output: lines.join('\n') };
  }

  private costReport(): ToolResult {
    if (!usageTrackerRef) return { success: false, output: '', error: 'Not configured' };

    const todayCost = usageTrackerRef.getTodayCost();
    const monthCost = usageTrackerRef.getMonthCost();
    const summary = usageTrackerRef.getTodaySummary();
    const isOver = usageTrackerRef.isOverBudget();

    const lines: string[] = [`Cost Report:`];
    lines.push(`Today: $${todayCost.toFixed(4)} (${summary.totalCalls} calls)`);
    lines.push(`This month: $${monthCost.toFixed(4)}`);
    lines.push(`Daily budget: $${config.DAILY_BUDGET_USD}`);
    lines.push(`Budget status: ${isOver ? 'OVER BUDGET' : 'Within budget'}`);
    lines.push(`Projected monthly: $${(todayCost * 30).toFixed(2)}`);

    if (Object.keys(summary.byModel).length > 0) {
      lines.push(`\nCost by model:`);
      const sorted = Object.entries(summary.byModel).sort(([, a], [, b]) => b - a);
      for (const [model, cost] of sorted) {
        lines.push(`  ${model}: $${cost.toFixed(4)}`);
      }
    }

    return { success: true, output: lines.join('\n') };
  }

  private budgetStatus(): ToolResult {
    if (!usageTrackerRef) return { success: false, output: '', error: 'Not configured' };

    const left = usageTrackerRef.getDailyBudgetLeft();
    const today = usageTrackerRef.getTodayCost();
    const isOver = usageTrackerRef.isOverBudget();

    return {
      success: true,
      output: `Budget: $${config.DAILY_BUDGET_USD}/day | Spent today: $${today.toFixed(4)} | Remaining: $${left.toFixed(2)} | Status: ${isOver ? 'OVER' : 'OK'}`,
    };
  }

  private savingsReport(): ToolResult {
    const savings = claudeCodeSavingsGetter?.() ?? 0;
    const todayCost = usageTrackerRef?.getTodayCost() ?? 0;
    const monthCost = usageTrackerRef?.getMonthCost() ?? 0;
    const maxSubscription = 200; // $200/month flat

    const lines = [
      'Claude Code Savings Report:',
      '',
      'Session savings (API cost avoided):',
      `  This session: $${savings.toFixed(4)}`,
      `  Estimated monthly savings: $${(savings * 30).toFixed(2)}`,
      '',
      'Cost comparison:',
      `  Max subscription: $${maxSubscription}/month (flat, unlimited)`,
      `  API costs today: $${todayCost.toFixed(4)}`,
      `  API costs this month: $${monthCost.toFixed(4)}`,
      `  Projected API monthly: $${(todayCost * 30).toFixed(2)}`,
      '',
      `  Net savings vs API-only: $${(savings + (todayCost * 30) - maxSubscription).toFixed(2)}/month`,
      '',
      'Strategy: Claude Code CLI handles all requests for FREE.',
      'API providers are fallback only (when CLI is unavailable).',
    ];

    return { success: true, output: lines.join('\n') };
  }

  async checkApiKeys(): Promise<ToolResult> {
    const results: string[] = [];

    // Claude Code CLI
    results.push((config as any).CLAUDE_CODE_ENABLED ? 'Claude Code CLI: enabled (FREE — Max subscription)' : 'Claude Code CLI: disabled');

    // Anthropic
    if (config.ANTHROPIC_API_KEY) {
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': config.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 5,
            messages: [{ role: 'user', content: 'ping' }],
          }),
          signal: AbortSignal.timeout(10000),
        });
        results.push(res.ok ? 'Anthropic API: OK' : `Anthropic API: Error ${res.status}`);
      } catch (e: any) { results.push(`Anthropic API: ${e.message}`); }
    } else {
      results.push('Anthropic API: not configured');
    }

    // OpenRouter
    if (config.OPENROUTER_API_KEY) {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
          headers: { Authorization: `Bearer ${config.OPENROUTER_API_KEY}` },
          signal: AbortSignal.timeout(10000),
        });
        results.push(res.ok ? 'OpenRouter API: OK' : `OpenRouter API: Error ${res.status}`);
      } catch (e: any) { results.push(`OpenRouter API: ${e.message}`); }
    } else {
      results.push('OpenRouter API: not configured');
    }

    // Telegram
    results.push(config.TELEGRAM_BOT_TOKEN ? 'Telegram bot: configured' : 'Telegram bot: not configured');

    // Kie.ai
    results.push(config.KIE_AI_API_KEY ? 'Kie.ai: configured' : 'Kie.ai: not configured');

    // Blotato
    results.push(config.BLOTATO_API_KEY ? 'Blotato: configured' : 'Blotato: not configured');

    // Gmail
    results.push(config.GMAIL_CLIENT_ID ? 'Gmail: configured' : 'Gmail: not configured');

    // Twilio
    results.push(config.TWILIO_ACCOUNT_SID ? 'Twilio: configured' : 'Twilio: not configured');

    // GitHub
    results.push(config.GITHUB_TOKEN ? 'GitHub: configured' : 'GitHub: not configured');

    // Brave Search
    results.push(config.BRAVE_API_KEY ? 'Brave Search: configured' : 'Brave Search: not configured');

    // OpenClaw
    results.push(config.OPENCLAW_GATEWAY_TOKEN ? 'OpenClaw: configured' : 'OpenClaw: not configured');

    return { success: true, output: `API Keys Status:\n${results.join('\n')}` };
  }
}
