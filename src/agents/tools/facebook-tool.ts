/**
 * FacebookTool — Exposes Facebook account management and autonomous agent control
 * to the chat AI. Wraps FacebookAccountManager + FacebookAgent.
 */
import { BaseTool, ToolResult } from './base-tool.js';
import { FacebookAccountManager } from '../../actions/browser/facebook-manager.js';
import { FacebookAgent, type AgentConfig } from '../../actions/browser/facebook-agent.js';
import { BrowserSessionManager } from '../../actions/browser/session-manager.js';
import logger from '../../utils/logger.js';

export class FacebookTool extends BaseTool {
  name = 'facebook';
  description = `Facebook account management and autonomous agent. Actions:
- list_accounts: Show all Facebook accounts
- account_status(accountId): Get account status and details
- start_agent(accountId, actions?, language?, tone?, topics?, testMode?): Start autonomous agent
- stop_agent(accountId): Stop autonomous agent
- pause_agent(accountId): Pause agent
- resume_agent(accountId): Resume agent
- agent_status(accountId): Get agent status and stats
- agent_logs(accountId, limit?): Get recent agent logs
- open_facebook(accountId, url?): Open Facebook in browser with cookies (visible in Browser View)
- post(accountId, content): Post to Facebook wall
- navigate(accountId, url): Navigate logged-in Facebook session to URL`;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = input.action as string;
    const accountId = input.accountId as string | undefined;

    try {
      switch (action) {
        case 'list_accounts':
          return this.listAccounts();

        case 'account_status':
          if (!accountId) return { success: false, output: '', error: 'accountId required' };
          return this.accountStatus(accountId);

        case 'start_agent':
          if (!accountId) return { success: false, output: '', error: 'accountId required' };
          return this.startAgent(accountId, input);

        case 'stop_agent':
          if (!accountId) return { success: false, output: '', error: 'accountId required' };
          return this.stopAgent(accountId);

        case 'pause_agent':
          if (!accountId) return { success: false, output: '', error: 'accountId required' };
          return this.pauseAgent(accountId);

        case 'resume_agent':
          if (!accountId) return { success: false, output: '', error: 'accountId required' };
          return this.resumeAgent(accountId);

        case 'agent_status':
          if (!accountId) return { success: false, output: '', error: 'accountId required' };
          return this.agentStatus(accountId);

        case 'agent_logs':
          if (!accountId) return { success: false, output: '', error: 'accountId required' };
          return this.agentLogs(accountId, (input.limit as number) ?? 20);

        case 'open_facebook':
          if (!accountId) return { success: false, output: '', error: 'accountId required' };
          return this.openFacebook(accountId, input.url as string | undefined);

        case 'post':
          if (!accountId) return { success: false, output: '', error: 'accountId required' };
          if (!input.content) return { success: false, output: '', error: 'content required' };
          return this.postToFacebook(accountId, input.content as string);

        case 'navigate':
          if (!accountId) return { success: false, output: '', error: 'accountId required' };
          if (!input.url) return { success: false, output: '', error: 'url required' };
          return this.navigateFacebook(accountId, input.url as string);

        default:
          return { success: false, output: '', error: `Unknown action: ${action}. Available: list_accounts, account_status, start_agent, stop_agent, pause_agent, resume_agent, agent_status, agent_logs, open_facebook, post, navigate` };
      }
    } catch (err: any) {
      this.error('Facebook tool error', { action, error: err.message });
      return { success: false, output: '', error: `Facebook error: ${err.message}` };
    }
  }

  private listAccounts(): ToolResult {
    const mgr = FacebookAccountManager.getInstance();
    const accounts = mgr.listAccounts();

    if (accounts.length === 0) {
      return { success: true, output: 'No Facebook accounts configured. Add accounts from the Facebook tab in the web UI.' };
    }

    const lines = accounts.map(a => {
      const agent = FacebookAgent.getAgent(a.id);
      const agentStatus = agent ? ` | Agent: ${agent.getStatus().state}` : '';
      return `- ${a.name} (${a.id}) — Status: ${a.status}${agentStatus}`;
    });

    return { success: true, output: `Facebook Accounts (${accounts.length}):\n${lines.join('\n')}` };
  }

  private accountStatus(accountId: string): ToolResult {
    const mgr = FacebookAccountManager.getInstance();
    const account = mgr.getAccount(accountId);
    if (!account) return { success: false, output: '', error: `Account not found: ${accountId}` };

    const agent = FacebookAgent.getAgent(accountId);
    const agentInfo = agent ? `\nAgent: ${agent.getStatus().state} (${agent.getStatus().stats.totalActions} actions)` : '\nAgent: not running';

    return {
      success: true,
      output: `Account: ${account.name}\nID: ${account.id}\nStatus: ${account.status}\nCookies: ${account.cookies?.length ?? 0} cookies loaded\nLast verified: ${account.lastVerified ?? 'never'}${agentInfo}`,
    };
  }

  private async startAgent(accountId: string, input: Record<string, unknown>): Promise<ToolResult> {
    const mgr = FacebookAccountManager.getInstance();
    const account = mgr.getAccount(accountId);
    if (!account) return { success: false, output: '', error: `Account not found: ${accountId}` };

    if (FacebookAgent.getAgent(accountId)) {
      return { success: false, output: '', error: 'Agent already running for this account. Use stop_agent first.' };
    }

    const actions = (input.actions as string[] | undefined) ?? ['post', 'comment'];
    const config: AgentConfig = {
      accountId,
      actions: actions as any[],
      schedule: {
        post: { intervalMinutes: 60, dailyLimit: 5 },
        comment: { intervalMinutes: 30, dailyLimit: 20 },
        friend_request: { intervalMinutes: 120, dailyLimit: 10 },
        group_join: { intervalMinutes: 180, dailyLimit: 3 },
        message: { intervalMinutes: 45, dailyLimit: 10 },
      },
      activeHours: {
        weekday: { start: 8, end: 22 },
        weekend: { start: 10, end: 23 },
      },
      content: {
        tone: (input.tone as string) ?? 'friendly and engaging',
        language: (input.language as string) ?? 'Chinese',
        topics: (input.topics as string[]) ?? ['general'],
        maxLength: 500,
        promoFrequency: 0,
      },
      safety: {
        minDelaySeconds: 30,
        maxActionsPerHour: 15,
        pauseOnErrorCount: 3,
        pauseDurationMinutes: 30,
      },
      groups: (input.groups as string[]) ?? [],
      testMode: (input.testMode as boolean) ?? false,
    };

    const agent = FacebookAgent.createAgent(config);
    await agent.start();

    const status = agent.getStatus();
    return {
      success: true,
      output: `Facebook agent started for ${account.name}!\nState: ${status.state}\nActions: ${actions.join(', ')}\nTest mode: ${config.testMode ? 'ON' : 'OFF'}\nLanguage: ${config.content.language}\n\nThe agent will autonomously post, comment, and interact on Facebook. Check status with agent_status or logs with agent_logs.`,
    };
  }

  private async stopAgent(accountId: string): Promise<ToolResult> {
    const agent = FacebookAgent.getAgent(accountId);
    if (!agent) return { success: false, output: '', error: 'No agent running for this account' };

    const stats = agent.getStatus().stats;
    await agent.stop();
    FacebookAgent.removeAgent(accountId);

    return {
      success: true,
      output: `Agent stopped. Final stats: ${stats.totalActions} total actions, ${stats.posts} posts, ${stats.comments} comments, ${stats.errors} errors.`,
    };
  }

  private pauseAgent(accountId: string): ToolResult {
    const agent = FacebookAgent.getAgent(accountId);
    if (!agent) return { success: false, output: '', error: 'No agent running for this account' };
    agent.pause();
    return { success: true, output: `Agent paused for account ${accountId}.` };
  }

  private resumeAgent(accountId: string): ToolResult {
    const agent = FacebookAgent.getAgent(accountId);
    if (!agent) return { success: false, output: '', error: 'No agent running for this account' };
    agent.resume();
    return { success: true, output: `Agent resumed for account ${accountId}.` };
  }

  private agentStatus(accountId: string): ToolResult {
    const agent = FacebookAgent.getAgent(accountId);
    if (!agent) return { success: false, output: '', error: 'No agent running for this account' };

    const s = agent.getStatus();
    return {
      success: true,
      output: `Agent Status: ${s.state}\nRunning since: ${s.startedAt ?? 'N/A'}\nLast action: ${s.lastAction ?? 'none'} at ${s.lastActionTime ?? 'N/A'}\nNext action: ${s.nextActionTime ?? 'N/A'}\nStats: ${s.stats.totalActions} total | ${s.stats.posts} posts | ${s.stats.comments} comments | ${s.stats.friendRequests} friend requests | ${s.stats.errors} errors`,
    };
  }

  private agentLogs(accountId: string, limit: number): ToolResult {
    const agent = FacebookAgent.getAgent(accountId);
    if (!agent) return { success: false, output: '', error: 'No agent running for this account' };

    const logs = agent.getLogs(limit);
    if (logs.length === 0) return { success: true, output: 'No logs yet.' };

    const lines = logs.map(l => {
      const time = new Date(l.timestamp).toLocaleTimeString('he-IL');
      const statusIcon = l.status === 'success' ? 'OK' : l.status === 'error' ? 'FAIL' : l.status.toUpperCase();
      return `[${time}] ${statusIcon} ${l.action}: ${l.message}${l.details ? ` (${l.details})` : ''}`;
    });

    return { success: true, output: `Recent logs (${logs.length}):\n${lines.join('\n')}` };
  }

  private async openFacebook(accountId: string, url?: string): Promise<ToolResult> {
    const mgr = FacebookAccountManager.getInstance();
    const account = mgr.getAccount(accountId);
    if (!account) return { success: false, output: '', error: `Account not found: ${accountId}` };
    if (!account.cookies?.length) return { success: false, output: '', error: 'No cookies loaded for this account. Import cookies first.' };

    const browserMgr = BrowserSessionManager.getInstance();
    const session = await browserMgr.createSession(undefined, false);

    // Inject cookies
    const page = browserMgr.getPage(session.id);
    if (!page) return { success: false, output: '', error: 'Failed to get browser page' };

    const context = page.context();
    await context.addCookies(account.cookies);

    // Navigate to Facebook
    const targetUrl = url ?? 'https://www.facebook.com';
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const title = await page.title();

    this.log('Opened Facebook session', { accountId, url: targetUrl, sessionId: session.id });
    return {
      success: true,
      output: `[session:${session.id}] Facebook opened as ${account.name}\nPage: ${title}\nURL: ${page.url()}\n\nYou can watch this session live in Browser View.`,
    };
  }

  private async postToFacebook(accountId: string, content: string): Promise<ToolResult> {
    const mgr = FacebookAccountManager.getInstance();
    const account = mgr.getAccount(accountId);
    if (!account) return { success: false, output: '', error: `Account not found: ${accountId}` };
    if (!account.cookies?.length) return { success: false, output: '', error: 'No cookies loaded. Import cookies first.' };

    const browserMgr = BrowserSessionManager.getInstance();
    const session = await browserMgr.createSession(undefined, false);
    const page = browserMgr.getPage(session.id);
    if (!page) return { success: false, output: '', error: 'Failed to get browser page' };

    // Inject cookies and navigate
    const context = page.context();
    await context.addCookies(account.cookies);
    await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Click the "What's on your mind?" field
    const postSelectors = [
      '[data-testid="status-attachment-mentions-input"]',
      'div[role="textbox"][contenteditable="true"]',
      '[aria-label*="What\'s on your mind"]',
      '[aria-label*="מה על דעתך"]',
      'span:text("What\'s on your mind")',
      'span:text("מה על דעתך")',
    ];

    let clicked = false;
    for (const sel of postSelectors) {
      try {
        await page.click(sel, { timeout: 3000 });
        clicked = true;
        break;
      } catch { /* try next */ }
    }

    if (!clicked) {
      await browserMgr.closeSession(session.id);
      return { success: false, output: '', error: 'Could not find the post input field. Facebook UI may have changed.' };
    }

    await page.waitForTimeout(1000);

    // Type the content character by character (human-like)
    const textbox = await page.$('div[role="textbox"][contenteditable="true"]');
    if (textbox) {
      for (const char of content) {
        await textbox.type(char, { delay: 50 + Math.random() * 80 });
      }
    }

    await page.waitForTimeout(1500);

    // Click Post button
    const postBtnSelectors = [
      '[data-testid="react-composer-post-button"]',
      'div[aria-label="Post"]',
      'div[aria-label="פרסם"]',
      'span:text("Post")',
      'span:text("פרסם")',
    ];

    let posted = false;
    for (const sel of postBtnSelectors) {
      try {
        await page.click(sel, { timeout: 3000 });
        posted = true;
        break;
      } catch { /* try next */ }
    }

    await page.waitForTimeout(3000);
    await browserMgr.closeSession(session.id);

    if (posted) {
      this.log('Posted to Facebook', { accountId, contentLength: content.length });
      return { success: true, output: `[session:${session.id}] Posted to Facebook as ${account.name}!\nContent: ${content.slice(0, 100)}${content.length > 100 ? '...' : ''}` };
    } else {
      return { success: false, output: '', error: 'Typed content but could not find the Post button. Check manually.' };
    }
  }

  private async navigateFacebook(accountId: string, url: string): Promise<ToolResult> {
    // Reuse openFacebook with custom URL
    return this.openFacebook(accountId, url);
  }
}
