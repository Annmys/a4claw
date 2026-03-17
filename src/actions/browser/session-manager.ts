/**
 * Browser Session Manager — manages Xvfb/VNC/Playwright lifecycle for browser sessions.
 * On-demand VNC: Browser runs headless by default, VNC attached only when user views.
 * This saves ~150MB RAM per session when nobody is watching.
 */
import { spawn, ChildProcess, execSync } from 'child_process';
import { readFileSync } from 'fs';
import logger from '../../utils/logger.js';
import { STEALTH_ARGS, STEALTH_INIT_SCRIPT, getStealthContextOptions } from './stealth-config.js';

export interface BrowserSession {
  id: string;
  displayNumber: number;
  vncPort: number;
  wsPort: number;
  url: string;
  title: string;
  status: 'starting' | 'running' | 'error' | 'closing';
  vncEnabled: boolean;
  createdAt: string;
  error?: string;
}

interface InternalSession {
  id: string;
  displayNumber: number;
  vncPort: number;
  wsPort: number;
  url: string;
  title: string;
  status: 'starting' | 'running' | 'error' | 'closing';
  vncEnabled: boolean;
  createdAt: Date;
  error?: string;
  xvfbProcess: ChildProcess | null;
  vncProcess: ChildProcess | null;
  wsProcess: ChildProcess | null;
  browser: any; // playwright Browser
  page: any;    // playwright Page
  context: any; // playwright BrowserContext
  /** Auto-detach VNC after inactivity */
  vncIdleTimer: ReturnType<typeof setTimeout> | null;
  /** True when browser is being intentionally relaunched (attach/detach VNC) — suppresses disconnect watchdog */
  relaunching: boolean;
}

const MAX_SESSIONS = 3;
const BASE_DISPLAY = 200;
const BASE_WS_PORT = 6200;
const STARTUP_TIMEOUT = 15_000;
const VNC_IDLE_TIMEOUT = 5 * 60_000; // Auto-detach VNC after 5 min inactivity

let playwright: any = null;

async function getPlaywright() {
  if (!playwright) {
    playwright = await import('playwright');
  }
  return playwright;
}

function getAvailableRamMB(): number {
  try {
    const meminfo = readFileSync('/proc/meminfo', 'utf-8');
    const match = meminfo.match(/MemAvailable:\s+(\d+)/);
    if (match) return Math.round(parseInt(match[1], 10) / 1024);
  } catch { /* fallback */ }
  return 0;
}

function getTotalRamMB(): number {
  try {
    const meminfo = readFileSync('/proc/meminfo', 'utf-8');
    const match = meminfo.match(/MemTotal:\s+(\d+)/);
    if (match) return Math.round(parseInt(match[1], 10) / 1024);
  } catch { /* fallback */ }
  return 0;
}

function killProcess(proc: ChildProcess | null) {
  if (!proc || proc.killed) return;
  try {
    proc.kill('SIGTERM');
    setTimeout(() => {
      try { if (!proc.killed) proc.kill('SIGKILL'); } catch { /* dead */ }
    }, 3000);
  } catch { /* dead */ }
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      try {
        execSync(`ss -tlnp | grep :${port}`, { timeout: 2000, stdio: 'pipe' });
        resolve();
      } catch {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Port ${port} not ready after ${timeoutMs}ms`));
        } else {
          setTimeout(check, 500);
        }
      }
    };
    check();
  });
}

export class BrowserSessionManager {
  private static instance: BrowserSessionManager;
  private sessions: Map<string, InternalSession> = new Map();

  static getInstance(): BrowserSessionManager {
    if (!BrowserSessionManager.instance) {
      BrowserSessionManager.instance = new BrowserSessionManager();
    }
    return BrowserSessionManager.instance;
  }

  /**
   * Kill orphaned Xvfb/VNC/websockify processes from previous runs.
   * Targets only our display/port range (200-202) to avoid killing unrelated processes.
   * Safe to call at startup.
   */
  static cleanupOrphans(): void {
    const cmds = [
      `pkill -f "Xvfb :20[0-2]" 2>/dev/null || true`,
      `pkill -f "x11vnc.*-rfbport 6[12]0[0-2]" 2>/dev/null || true`,
      `pkill -f "websockify.*(6200|6201|6202)" 2>/dev/null || true`,
    ];
    for (const cmd of cmds) {
      try { execSync(cmd, { stdio: 'pipe', timeout: 5000 }); } catch { /* ignore */ }
    }
    logger.info('Browser orphan cleanup done');
  }

  /**
   * Create a new browser session.
   * Launches headless by default — call attachVnc() to start VNC streaming.
   * If `withVnc` is true, VNC is attached immediately (for BrowserView page).
   */
  async createSession(url?: string, withVnc = true): Promise<BrowserSession> {
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new Error(`Maximum ${MAX_SESSIONS} concurrent sessions allowed. Close an existing session first.`);
    }

    const availableRam = getAvailableRamMB();
    if (availableRam < 500) {
      throw new Error(`Insufficient RAM: ${availableRam}MB available (need at least 500MB).`);
    }

    const id = crypto.randomUUID();
    const displayNumber = this.getNextDisplay();
    const vncPort = 5900 + displayNumber;
    const wsPort = BASE_WS_PORT + (displayNumber - BASE_DISPLAY);

    const session: InternalSession = {
      id, displayNumber, vncPort, wsPort,
      url: url ?? 'about:blank',
      title: 'Starting...',
      status: 'starting',
      vncEnabled: false,
      createdAt: new Date(),
      xvfbProcess: null, vncProcess: null, wsProcess: null,
      browser: null, page: null, context: null,
      vncIdleTimer: null, relaunching: false,
    };

    this.sessions.set(id, session);
    logger.info('Creating browser session', { id, display: `:${displayNumber}`, withVnc });

    try {
      if (withVnc) {
        // Headed mode: start VNC stack + visible browser
        await this.startVncStack(session);
        await this.launchBrowser(session, false); // headed
      } else {
        // Headless mode: just the browser, no VNC
        await this.launchBrowser(session, true); // headless
      }

      // Navigate to initial URL
      if (url && url !== 'about:blank') {
        await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        session.url = session.page.url();
        session.title = await session.page.title();
      }

      session.status = 'running';
      logger.info('Browser session ready', { id, vncEnabled: session.vncEnabled, url: session.url });

      return this.toPublicSession(session);
    } catch (err: any) {
      session.status = 'error';
      session.error = err.message;
      logger.error('Failed to create browser session', { id, error: err.message });
      await this.closeSessionInternal(session);
      this.sessions.delete(id);
      throw new Error(`Failed to create browser session: ${err.message}`);
    }
  }

  /**
   * Attach VNC on-demand — starts Xvfb + x11vnc + websockify.
   * If the browser was headless, it is relaunched in headed mode.
   */
  async attachVnc(id: string): Promise<{ wsPort: number; display: number }> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);

    if (session.vncEnabled) {
      this.resetVncIdleTimer(session);
      return { wsPort: session.wsPort, display: session.displayNumber };
    }

    logger.info('Attaching VNC on-demand', { id });

    // Save current URL before relaunch
    let currentUrl = session.url;
    try { currentUrl = session.page?.url() ?? session.url; } catch { /* */ }

    // Flag: suppress disconnect watchdog during intentional relaunch
    session.relaunching = true;

    // Close headless browser
    try { await session.page?.close().catch(() => {}); } catch { /* */ }
    try { await session.browser?.close().catch(() => {}); } catch { /* */ }

    // Start VNC stack
    await this.startVncStack(session);
    // Relaunch in headed mode
    await this.launchBrowser(session, false);
    session.relaunching = false;

    // Restore navigation
    if (currentUrl && currentUrl !== 'about:blank') {
      try {
        await session.page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        session.url = session.page.url();
        session.title = await session.page.title();
      } catch { /* best effort */ }
    }

    this.resetVncIdleTimer(session);
    return { wsPort: session.wsPort, display: session.displayNumber };
  }

  /**
   * Detach VNC — kills VNC stack, browser continues headless.
   * Saves ~150MB RAM.
   */
  async detachVnc(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session || !session.vncEnabled) return;

    logger.info('Detaching VNC to save resources', { id });

    if (session.vncIdleTimer) {
      clearTimeout(session.vncIdleTimer);
      session.vncIdleTimer = null;
    }

    // Save current URL
    let currentUrl = session.url;
    try { currentUrl = session.page?.url() ?? session.url; } catch { /* */ }

    // Flag: suppress disconnect watchdog during intentional relaunch
    session.relaunching = true;

    // Close headed browser
    try { await session.page?.close().catch(() => {}); } catch { /* */ }
    try { await session.browser?.close().catch(() => {}); } catch { /* */ }

    // Kill VNC stack
    killProcess(session.wsProcess);
    killProcess(session.vncProcess);
    killProcess(session.xvfbProcess);
    session.wsProcess = null;
    session.vncProcess = null;
    session.xvfbProcess = null;
    session.vncEnabled = false;

    // Relaunch headless
    await this.launchBrowser(session, true);
    session.relaunching = false;

    // Restore navigation
    if (currentUrl && currentUrl !== 'about:blank') {
      try {
        await session.page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        session.url = session.page.url();
        session.title = await session.page.title();
      } catch { /* best effort */ }
    }

    logger.info('VNC detached, browser continuing headless', { id });
  }

  /** Ping to keep VNC alive — call from frontend polling */
  keepVncAlive(id: string): void {
    const session = this.sessions.get(id);
    if (session?.vncEnabled) {
      this.resetVncIdleTimer(session);
    }
  }

  async closeSession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);
    session.status = 'closing';
    if (session.vncIdleTimer) clearTimeout(session.vncIdleTimer);
    await this.closeSessionInternal(session);
    this.sessions.delete(id);
    logger.info('Browser session closed', { id });
  }

  async closeAll(): Promise<void> {
    for (const id of [...this.sessions.keys()]) {
      try { await this.closeSession(id); } catch { /* best effort */ }
    }
  }

  listSessions(): BrowserSession[] {
    return [...this.sessions.values()].map(s => this.toPublicSession(s));
  }

  getSession(id: string): BrowserSession | undefined {
    const s = this.sessions.get(id);
    return s ? this.toPublicSession(s) : undefined;
  }

  async navigateTo(id: string, url: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session || !session.page) throw new Error(`Session ${id} not found or not ready`);
    await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    session.url = session.page.url();
    session.title = await session.page.title();
  }

  async screenshot(id: string): Promise<Buffer> {
    const session = this.sessions.get(id);
    if (!session || !session.page) throw new Error(`Session ${id} not found or not ready`);
    return session.page.screenshot({ type: 'png' });
  }

  /** Get the Playwright page for direct Playwright API access (used by MCP/AI) */
  getPage(id: string): any {
    const session = this.sessions.get(id);
    if (!session || !session.page) return null;
    return session.page;
  }

  /** Execute AI-driven browser action */
  async aiAction(id: string, instruction: string, claudeClient: any): Promise<string> {
    const session = this.sessions.get(id);
    if (!session || !session.page) throw new Error(`Session ${id} not found or not ready`);

    const results: string[] = [];
    const maxSteps = 10;

    for (let step = 0; step < maxSteps; step++) {
      // Take accessibility snapshot of interactive elements
      const snapshotResult = await session.page.evaluate(`(() => {
        const elements = [];
        const selectors = 'a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [onclick], [data-action]';
        const nodes = document.querySelectorAll(selectors);
        let ref = 1;
        nodes.forEach(node => {
          const el = node;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          if (rect.top > window.innerHeight * 2) return;
          elements.push({
            ref: ref++,
            tag: el.tagName.toLowerCase(),
            type: el.type || undefined,
            text: (el.innerText || el.textContent || '').trim().slice(0, 100) || undefined,
            placeholder: el.placeholder || undefined,
            href: el.href || undefined,
            name: el.name || el.id || undefined,
            visible: rect.top >= 0 && rect.top < window.innerHeight,
          });
        });
        return JSON.stringify({
          elements,
          url: location.href,
          title: document.title,
          scrollY: window.scrollY,
          bodyHeight: document.body.scrollHeight,
          viewHeight: window.innerHeight,
        });
      })()`);

      let parsed;
      try { parsed = JSON.parse(snapshotResult); } catch { parsed = { elements: [], url: '', title: '' }; }

      const visibleElements = parsed.elements
        .filter((e: any) => e.visible)
        .map((e: any) =>
          `[ref=${e.ref}] <${e.tag}${e.type ? ` type="${e.type}"` : ''}${e.name ? ` name="${e.name}"` : ''}> "${e.text || e.placeholder || ''}" ${e.href ? `→ ${e.href}` : ''}`
        ).join('\n');

      const scrollInfo = `(scroll: ${parsed.scrollY}/${parsed.bodyHeight - parsed.viewHeight}px)`;

      // Ask LLM for next action
      let response;
      try {
        response = await claudeClient.chat({
          systemPrompt: `You are a browser automation AI. Given the page state and visible elements, decide the next action.
Rules:
- Use CSS selectors for "selector" (prefer [name], #id, or specific text selectors)
- For type action, clear the field first is handled automatically
- You can use "waitForNavigation" as action to wait after a click
Respond with ONLY valid JSON: { "action": "click|type|scroll|navigate|screenshot|done|impossible", "selector": "CSS selector", "value": "text/URL", "explanation": "brief why" }`,
          messages: [{ role: 'user', content: `PAGE: ${parsed.title} (${parsed.url}) ${scrollInfo}
VISIBLE ELEMENTS:\n${visibleElements || '(none visible — try scrolling)'}
${results.length ? `\nPROGRESS:\n${results.join('\n')}` : ''}
\nGOAL: ${instruction}
\nStep ${step + 1}/${maxSteps} — What next?` }],
          maxTokens: 400,
          temperature: 0.1,
        });
      } catch (err: any) {
        results.push(`AI Error: ${err.message}`);
        break;
      }

      let decision;
      try { decision = JSON.parse(response.content); } catch {
        results.push(`AI returned invalid JSON, stopping`);
        break;
      }

      if (decision.action === 'done') {
        results.push(`Done: ${decision.explanation}`);
        break;
      }
      if (decision.action === 'impossible') {
        results.push(`Cannot: ${decision.explanation}`);
        break;
      }

      try {
        switch (decision.action) {
          case 'click':
            await session.page.click(decision.selector, { timeout: 10_000 });
            results.push(`Clicked: ${decision.selector} — ${decision.explanation}`);
            await session.page.waitForLoadState('domcontentloaded').catch(() => {});
            break;
          case 'type':
            await session.page.fill(decision.selector, '');
            await session.page.fill(decision.selector, decision.value);
            results.push(`Typed: "${decision.value}" in ${decision.selector}`);
            break;
          case 'navigate':
            await session.page.goto(decision.value, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            results.push(`Navigated: ${decision.value}`);
            break;
          case 'scroll':
            await session.page.evaluate('window.scrollBy(0, 600)');
            results.push('Scrolled down');
            break;
          case 'screenshot':
            results.push('Screenshot taken');
            break;
        }
        await new Promise(r => setTimeout(r, 1500));
        session.url = session.page.url();
        session.title = await session.page.title();
      } catch (err: any) {
        results.push(`Action error: ${err.message}`);
      }
    }

    return results.join('\n');
  }

  getResources() {
    const vncSessions = [...this.sessions.values()].filter(s => s.vncEnabled).length;
    return {
      sessions: this.sessions.size,
      maxSessions: MAX_SESSIONS,
      vncSessions,
      headlessSessions: this.sessions.size - vncSessions,
      ramAvailableMB: getAvailableRamMB(),
      ramTotalMB: getTotalRamMB(),
      ramPerSessionMB: 250,      // headless
      ramPerVncSessionMB: 400,   // headed with VNC
      warning: this.sessions.size >= 2
        ? 'High resource usage. Consider detaching VNC from inactive sessions.'
        : undefined,
    };
  }

  // ── Internal helpers ──────────────────────────────────────────

  private markErrorAndCleanup(session: InternalSession, reason: string) {
    if (session.status === 'closing' || session.status === 'error') return;
    session.status = 'error';
    session.error = reason;
    if (session.vncIdleTimer) clearTimeout(session.vncIdleTimer);
    this.closeSessionInternal(session).then(() => {
      this.sessions.delete(session.id);
      logger.info('Crashed session cleaned up', { id: session.id, reason });
    }).catch(() => {
      this.sessions.delete(session.id);
    });
  }

  /** Start VNC stack: Xvfb + x11vnc + websockify */
  private async startVncStack(session: InternalSession): Promise<void> {
    const { id, displayNumber, vncPort, wsPort } = session;

    // 1. Xvfb
    session.xvfbProcess = spawn('Xvfb', [
      `:${displayNumber}`, '-screen', '0', '1920x1080x24',
      '-ac', '+extension', 'GLX', '+render', '-noreset',
    ], { stdio: 'pipe' });

    session.xvfbProcess.on('error', (err) => logger.error('Xvfb error', { id, error: err.message }));
    session.xvfbProcess.on('exit', (code) => {
      if (session.relaunching) return;
      if (session.status === 'running' || session.status === 'starting') {
        this.markErrorAndCleanup(session, 'Xvfb exited unexpectedly');
      }
    });
    await new Promise(r => setTimeout(r, 1500));

    // 2. x11vnc
    session.vncProcess = spawn('x11vnc', [
      '-display', `:${displayNumber}`, '-rfbport', String(vncPort),
      '-shared', '-forever', '-nopw', '-noxdamage', '-noshm',
    ], { stdio: 'pipe' });

    session.vncProcess.on('error', (err) => logger.error('x11vnc error', { id, error: err.message }));
    session.vncProcess.on('exit', (code) => {
      if (session.relaunching) return;
      if (session.status === 'running' || session.status === 'starting') {
        this.markErrorAndCleanup(session, 'VNC server exited unexpectedly');
      }
    });
    await waitForPort(vncPort, STARTUP_TIMEOUT);

    // 3. websockify
    session.wsProcess = spawn('websockify', [
      '--web=/usr/share/novnc', String(wsPort), `localhost:${vncPort}`,
    ], { stdio: 'pipe' });

    session.wsProcess.on('error', (err) => logger.error('websockify error', { id, error: err.message }));
    session.wsProcess.on('exit', (code) => {
      if (session.relaunching) return;
      if (session.status === 'running' || session.status === 'starting') {
        this.markErrorAndCleanup(session, 'WebSocket proxy exited unexpectedly');
      }
    });
    await waitForPort(wsPort, STARTUP_TIMEOUT);

    session.vncEnabled = true;
    logger.info('VNC stack started', { id, display: `:${displayNumber}`, vncPort, wsPort });
  }

  /** Launch Playwright browser (headless or headed) */
  private async launchBrowser(session: InternalSession, headless: boolean): Promise<void> {
    const pw = await getPlaywright();
    const args = [...STEALTH_ARGS];
    const env = { ...process.env };

    if (!headless) {
      args.push(`--display=:${session.displayNumber}`);
      env.DISPLAY = `:${session.displayNumber}`;
    }

    session.browser = await pw.chromium.launch({
      headless,
      args,
      env,
    });

    session.context = await session.browser.newContext(getStealthContextOptions());
    session.page = await session.context.newPage();
    await session.page.addInitScript(STEALTH_INIT_SCRIPT);

    // Watchdog: browser crash → cleanup (skip during intentional relaunch)
    session.browser.on('disconnected', () => {
      if (session.relaunching) return; // Intentional close during VNC attach/detach
      if (session.status === 'running' || session.status === 'starting') {
        logger.warn('Browser disconnected', { id: session.id });
        this.markErrorAndCleanup(session, 'Browser crashed or disconnected');
      }
    });

    // Track navigation
    session.page.on('framenavigated', async () => {
      try {
        session.url = session.page.url();
        session.title = await session.page.title();
      } catch { /* page closed */ }
    });
  }

  /** Reset the VNC idle auto-detach timer */
  private resetVncIdleTimer(session: InternalSession) {
    if (session.vncIdleTimer) clearTimeout(session.vncIdleTimer);
    session.vncIdleTimer = setTimeout(() => {
      if (session.vncEnabled && session.status === 'running') {
        logger.info('VNC idle timeout — auto-detaching', { id: session.id });
        this.detachVnc(session.id).catch(() => {});
      }
    }, VNC_IDLE_TIMEOUT);
  }

  private getNextDisplay(): number {
    const used = new Set([...this.sessions.values()].map(s => s.displayNumber));
    for (let d = BASE_DISPLAY; d < BASE_DISPLAY + MAX_SESSIONS; d++) {
      if (!used.has(d)) return d;
    }
    throw new Error('No available display numbers');
  }

  private async closeSessionInternal(session: InternalSession): Promise<void> {
    try { await session.page?.close().catch(() => {}); } catch { /* */ }
    try { await session.browser?.close().catch(() => {}); } catch { /* */ }
    killProcess(session.wsProcess);
    killProcess(session.vncProcess);
    killProcess(session.xvfbProcess);
    session.page = null;
    session.browser = null;
    session.context = null;
    session.wsProcess = null;
    session.vncProcess = null;
    session.xvfbProcess = null;
    session.vncEnabled = false;
  }

  private toPublicSession(s: InternalSession): BrowserSession {
    return {
      id: s.id,
      displayNumber: s.displayNumber,
      vncPort: s.vncPort,
      wsPort: s.wsPort,
      url: s.url,
      title: s.title,
      status: s.status,
      vncEnabled: s.vncEnabled,
      createdAt: s.createdAt.toISOString(),
      error: s.error,
    };
  }
}
