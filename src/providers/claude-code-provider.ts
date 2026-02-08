import { exec } from 'child_process';
import { promisify } from 'util';
import logger from '../utils/logger.js';

const execAsync = promisify(exec);

export interface ClaudeCodeResponse {
  text: string;
  model: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  cost: number; // always 0 — uses Max subscription
}

export class ClaudeCodeProvider {
  private available: boolean = false;
  private authenticated: boolean = false;
  private cliPath: string;
  private lastCheckAt: number = 0;

  constructor(cliPath: string = 'claude') {
    this.cliPath = cliPath;
  }

  async checkAvailability(): Promise<boolean> {
    try {
      const { stdout: version } = await execAsync(`${this.cliPath} --version`, { timeout: 10000 });
      logger.info('Claude Code CLI found', { version: version.trim() });
      this.available = true;

      // Check if authenticated with a minimal request
      const { stdout: authCheck } = await execAsync(
        `${this.cliPath} -p "respond with just OK" --max-tokens 5 --output-format json`,
        { timeout: 30000 },
      );

      const parsed = JSON.parse(authCheck);
      if (parsed.result || parsed.content) {
        this.authenticated = true;
        this.lastCheckAt = Date.now();
        logger.info('Claude Code CLI authenticated');
        return true;
      }

      return false;
    } catch (err: any) {
      logger.debug('Claude Code CLI not available', { error: err.message });
      this.available = false;
      this.authenticated = false;
      return false;
    }
  }

  async chat(params: {
    system?: string;
    message: string;
    maxTokens?: number;
    temperature?: number;
    model?: string;
  }): Promise<ClaudeCodeResponse> {
    if (!this.available || !this.authenticated) {
      throw new Error('Claude Code CLI not available or not authenticated');
    }

    const { system, message, maxTokens, model } = params;

    // Build the full prompt with system context
    let fullPrompt = '';
    if (system) {
      fullPrompt += `<system>\n${system}\n</system>\n\n`;
    }
    fullPrompt += message;

    // Escape for shell — write to stdin via echo to avoid shell escaping issues
    const escapedPrompt = fullPrompt
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$');

    const args: string[] = ['-p', `"${escapedPrompt}"`];
    if (maxTokens) args.push(`--max-tokens ${maxTokens}`);
    if (model) args.push(`--model ${model}`);
    args.push('--output-format json');

    const command = `${this.cliPath} ${args.join(' ')}`;

    try {
      const { stdout } = await execAsync(command, {
        timeout: 120000,
        maxBuffer: 1024 * 1024 * 10,
        env: { ...process.env },
      });

      let result: any;
      try {
        result = JSON.parse(stdout);
      } catch {
        return { text: stdout.trim(), model: model || 'claude-code-cli', cost: 0 };
      }

      let text = '';
      if (result.result) {
        text = result.result;
      } else if (result.content) {
        if (Array.isArray(result.content)) {
          text = result.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('\n');
        } else {
          text = String(result.content);
        }
      } else if (typeof result === 'string') {
        text = result;
      } else {
        text = stdout.trim();
      }

      return {
        text,
        model: result.model || model || 'claude-code-cli',
        usage: {
          input_tokens: result.usage?.input_tokens || 0,
          output_tokens: result.usage?.output_tokens || 0,
        },
        cost: 0,
      };
    } catch (err: any) {
      if (err.message.includes('not authenticated') || err.message.includes('login')) {
        this.authenticated = false;
        throw new Error('Claude Code CLI: authentication expired. Run "claude login" to re-authenticate.');
      }
      if (err.message.includes('TIMEOUT') || err.killed) {
        throw new Error('Claude Code CLI: request timed out (120s)');
      }
      throw new Error(`Claude Code CLI error: ${err.message}`);
    }
  }

  async chatWithHistory(params: {
    system?: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    maxTokens?: number;
  }): Promise<ClaudeCodeResponse> {
    // Pack conversation into a single prompt (CLI doesn't support multi-turn in -p mode)
    let packed = '';
    if (params.system) {
      packed += `<system>\n${params.system}\n</system>\n\n`;
    }
    for (const msg of params.messages) {
      if (msg.role === 'user') {
        packed += `Human: ${msg.content}\n\n`;
      } else {
        packed += `Assistant: ${msg.content}\n\n`;
      }
    }

    return this.chat({ message: packed, maxTokens: params.maxTokens });
  }

  async agenticTask(params: {
    task: string;
    workingDir?: string;
    allowedTools?: string[];
    timeout?: number;
  }): Promise<ClaudeCodeResponse> {
    if (!this.available || !this.authenticated) {
      throw new Error('Claude Code CLI not available');
    }

    const { task, workingDir, allowedTools, timeout } = params;

    const escapedTask = task.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    const args: string[] = ['-p', `"${escapedTask}"`];

    if (allowedTools && allowedTools.length > 0) {
      args.push(`--allowedTools "${allowedTools.join(',')}"`);
    }
    args.push('--output-format json');

    const command = `${this.cliPath} ${args.join(' ')}`;

    const { stdout } = await execAsync(command, {
      timeout: timeout || 300000,
      maxBuffer: 1024 * 1024 * 50,
      cwd: workingDir || process.cwd(),
      env: { ...process.env },
    });

    let result: any;
    try {
      result = JSON.parse(stdout);
    } catch {
      return { text: stdout.trim(), model: 'claude-code-agent', cost: 0 };
    }

    const text = result.result || (typeof result.content === 'string' ? result.content : '') || stdout.trim();

    return {
      text,
      model: 'claude-code-agent',
      usage: result.usage,
      cost: 0,
    };
  }

  getStatus(): { available: boolean; authenticated: boolean; cliPath: string; lastCheckAt: number } {
    return {
      available: this.available,
      authenticated: this.authenticated,
      cliPath: this.cliPath,
      lastCheckAt: this.lastCheckAt,
    };
  }

  isReady(): boolean {
    return this.available && this.authenticated;
  }

  markUnauthenticated(): void {
    this.authenticated = false;
  }
}
