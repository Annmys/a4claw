import { BaseTool, ToolResult } from './base-tool.js';
import { ClaudeCodeProvider } from '../../providers/claude-code-provider.js';
import logger from '../../utils/logger.js';

let providerRef: ClaudeCodeProvider | null = null;

export function setClaudeCodeToolProvider(provider: ClaudeCodeProvider) {
  providerRef = provider;
}

export class ClaudeCodeTool extends BaseTool {
  name = 'claude-code';
  description = 'Run agentic tasks via Claude Code CLI (free via Max subscription). Actions: chat, agent, status.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = String(input.action ?? '');

    if (!providerRef) {
      return { success: false, output: '', error: 'Claude Code CLI not configured. Install: npm install -g @anthropic-ai/claude-code && claude login' };
    }

    if (!providerRef.isReady()) {
      return { success: false, output: '', error: 'Claude Code CLI not authenticated. Run: claude login' };
    }

    switch (action) {
      case 'chat': return this.chat(input);
      case 'agent': return this.agenticTask(input);
      case 'status': return this.status();
      default:
        return { success: false, output: '', error: `Unknown action: ${action}. Use: chat, agent, status` };
    }
  }

  private async chat(input: Record<string, unknown>): Promise<ToolResult> {
    const message = String(input.message ?? '');
    if (!message) return { success: false, output: '', error: 'message is required' };

    try {
      const response = await providerRef!.chat({
        system: input.system ? String(input.system) : undefined,
        message,
        maxTokens: input.maxTokens ? Number(input.maxTokens) : undefined,
      });
      return { success: true, output: response.text };
    } catch (err: any) {
      logger.error('Claude Code chat failed', { error: err.message });
      return { success: false, output: '', error: err.message };
    }
  }

  private async agenticTask(input: Record<string, unknown>): Promise<ToolResult> {
    const task = String(input.task ?? '');
    if (!task) return { success: false, output: '', error: 'task is required' };

    try {
      const response = await providerRef!.agenticTask({
        task,
        workingDir: input.workingDir ? String(input.workingDir) : undefined,
        allowedTools: input.allowedTools ? (input.allowedTools as string[]) : undefined,
        timeout: input.timeout ? Number(input.timeout) : undefined,
      });
      return { success: true, output: response.text };
    } catch (err: any) {
      logger.error('Claude Code agent task failed', { error: err.message });
      return { success: false, output: '', error: err.message };
    }
  }

  private status(): ToolResult {
    const status = providerRef!.getStatus();
    const lines = [
      `Claude Code CLI Status:`,
      `  Available: ${status.available}`,
      `  Authenticated: ${status.authenticated}`,
      `  CLI Path: ${status.cliPath}`,
      `  Last Check: ${status.lastCheckAt ? new Date(status.lastCheckAt).toISOString() : 'never'}`,
      `  Cost: $0.00 (FREE — Max subscription)`,
    ];
    return { success: true, output: lines.join('\n') };
  }
}
