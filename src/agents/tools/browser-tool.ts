import { BaseTool, ToolResult } from './base-tool.js';
import { BrowserSessionManager } from '../../actions/browser/session-manager.js';
import logger from '../../utils/logger.js';

/** Block SSRF — deny navigation to internal/private networks and dangerous protocols */
function isUrlSafe(rawUrl: string): { safe: boolean; reason?: string } {
  try {
    const u = new URL(rawUrl);

    // Block dangerous protocols
    if (!['http:', 'https:'].includes(u.protocol)) {
      return { safe: false, reason: `Blocked protocol: ${u.protocol}` };
    }

    // Block metadata endpoints, localhost, and private IPs
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') {
      return { safe: false, reason: 'Blocked: localhost' };
    }
    if (host === '169.254.169.254' || host === 'metadata.google.internal') {
      return { safe: false, reason: 'Blocked: cloud metadata endpoint' };
    }

    // Block RFC-1918 private ranges
    const parts = host.split('.').map(Number);
    if (parts.length === 4 && parts.every(n => !isNaN(n))) {
      if (parts[0] === 10) return { safe: false, reason: 'Blocked: private IP (10.x.x.x)' };
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return { safe: false, reason: 'Blocked: private IP (172.16-31.x.x)' };
      if (parts[0] === 192 && parts[1] === 168) return { safe: false, reason: 'Blocked: private IP (192.168.x.x)' };
      if (parts[0] === 169 && parts[1] === 254) return { safe: false, reason: 'Blocked: link-local IP' };
    }

    return { safe: true };
  } catch {
    return { safe: false, reason: 'Invalid URL' };
  }
}

/**
 * BrowserTool — uses BrowserSessionManager for all browser operations.
 * Sessions created here are visible in the Browser View page.
 * Users can attach VNC to watch the agent work in real time.
 */
export class BrowserTool extends BaseTool {
  name = 'browser';
  description = 'Web browser automation. Actions: navigate(url), click(selector), type(selector,text), fill_form(fields), screenshot(), extract(selector), get_links(), scroll(direction), wait(selector), evaluate(js), close(). Use for: signing up for websites, filling forms, scraping data, web interactions.';

  private sessionId: string | null = null;

  /** Get the current session ID (for external use, e.g. chat UI badge) */
  getSessionId(): string | null { return this.sessionId; }

  private async ensureSession(): Promise<{ page: any; sessionId: string }> {
    const mgr = BrowserSessionManager.getInstance();

    // If we have a session, check it's still alive
    if (this.sessionId) {
      const page = mgr.getPage(this.sessionId);
      if (page) return { page, sessionId: this.sessionId };
      // Session died — clear and recreate
      this.sessionId = null;
    }

    // Create a headless session (no VNC by default — user can attach from Browser View)
    const session = await mgr.createSession(undefined, false);
    this.sessionId = session.id;
    logger.info('BrowserTool created session via SessionManager', { sessionId: session.id });
    return { page: mgr.getPage(session.id)!, sessionId: session.id };
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = input.action as string;
    const url = input.url as string | undefined;
    const selector = input.selector as string | undefined;
    const text = input.text as string | undefined;
    const fields = input.fields as Record<string, string> | undefined;
    const js = input.js as string | undefined;
    const direction = input.direction as string | undefined;

    try {
      const { page, sessionId } = await this.ensureSession();

      switch (action) {
        case 'navigate': {
          if (!url) return { success: false, output: '', error: 'URL required' };
          const urlCheck = isUrlSafe(url);
          if (!urlCheck.safe) return { success: false, output: '', error: `SSRF blocked: ${urlCheck.reason}` };
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          const title = await page.title();
          const bodyText = await page.innerText('body').catch(() => '');
          const truncated = bodyText.slice(0, 3000);
          this.log('Navigated', { url, title });
          return { success: true, output: `[session:${sessionId}] Page: ${title}\nURL: ${page.url()}\n\n${truncated}` };
        }

        case 'click': {
          if (!selector) return { success: false, output: '', error: 'Selector required' };
          await page.click(selector, { timeout: 10000 });
          await page.waitForTimeout(1000);
          return { success: true, output: `Clicked: ${selector}\nCurrent URL: ${page.url()}` };
        }

        case 'type': {
          if (!selector || !text) return { success: false, output: '', error: 'Selector and text required' };
          await page.fill(selector, text);
          return { success: true, output: `Typed "${text}" into ${selector}` };
        }

        case 'fill_form': {
          if (!fields) return { success: false, output: '', error: 'Fields required' };
          const results: string[] = [];
          for (const [sel, value] of Object.entries(fields)) {
            try {
              await page.fill(sel, value);
              results.push(`OK ${sel}: "${value}"`);
            } catch (err: any) {
              results.push(`FAIL ${sel}: ${err.message}`);
            }
          }
          return { success: true, output: results.join('\n') };
        }

        case 'screenshot': {
          const mgr = BrowserSessionManager.getInstance();
          const screenshot = await mgr.screenshot(sessionId);
          const fs = await import('fs/promises');
          const path = await import('path');
          const tmpDir = process.env.TEMP ?? '/tmp';
          const filePath = path.join(tmpDir, `screenshot_${Date.now()}.png`);
          await fs.writeFile(filePath, screenshot);
          this.log('Screenshot saved', { path: filePath });
          return { success: true, output: `Screenshot saved: ${filePath}\nPage: ${await page.title()}\nURL: ${page.url()}` };
        }

        case 'extract': {
          if (!selector) return { success: false, output: '', error: 'Selector required' };
          const elements = await page.$$(selector);
          const texts = await Promise.all(elements.map((el: any) => el.innerText()));
          return { success: true, output: texts.join('\n') };
        }

        case 'get_links': {
          const links = await page.$$eval('a[href]', (els: any[]) =>
            els.map(el => ({ text: el.textContent?.trim(), href: el.getAttribute('href') }))
              .filter((l: any) => l.href && !l.href.startsWith('#'))
              .slice(0, 50)
          );
          return { success: true, output: links.map((l: any) => `${l.text} -> ${l.href}`).join('\n') };
        }

        case 'scroll': {
          const dir = direction === 'up' ? -500 : 500;
          await page.evaluate(`window.scrollBy(0, ${dir})`);
          return { success: true, output: `Scrolled ${direction ?? 'down'}` };
        }

        case 'wait': {
          if (!selector) return { success: false, output: '', error: 'Selector required' };
          await page.waitForSelector(selector, { timeout: 15000 });
          return { success: true, output: `Element found: ${selector}` };
        }

        case 'evaluate': {
          if (!js) return { success: false, output: '', error: 'JavaScript required' };
          const result = await page.evaluate(js);
          return { success: true, output: `Result: ${JSON.stringify(result)}` };
        }

        case 'close': {
          await this.cleanup();
          return { success: true, output: 'Browser closed' };
        }

        default:
          return { success: false, output: '', error: `Unknown action: ${action}. Available: navigate, click, type, fill_form, screenshot, extract, get_links, scroll, wait, evaluate, close` };
      }
    } catch (err: any) {
      this.error('Browser error', { action, error: err.message });
      return { success: false, output: '', error: `Browser error: ${err.message}` };
    }
  }

  async cleanup() {
    if (this.sessionId) {
      try {
        await BrowserSessionManager.getInstance().closeSession(this.sessionId);
      } catch { /* session may already be closed */ }
      this.sessionId = null;
    }
  }
}
