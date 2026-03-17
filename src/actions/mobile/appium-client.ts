import logger from '../../utils/logger.js';

/**
 * Appium W3C WebDriver client — connects to Appium server for advanced mobile automation.
 * Supports: element finding, clicking, typing, gestures, screenshots, app management.
 */
export class AppiumClient {
  private serverUrl = '';
  private sessionId = '';

  private get baseUrl(): string {
    return `${this.serverUrl}/session/${this.sessionId}`;
  }

  // ─── Session Management ─────────────────────────────────

  async createSession(serverUrl: string, capabilities: Record<string, unknown>): Promise<string> {
    this.serverUrl = serverUrl.replace(/\/$/, '');

    const body = {
      capabilities: {
        alwaysMatch: capabilities,
      },
    };

    const res = await this.request('POST', `${this.serverUrl}/session`, body);
    this.sessionId = res.value?.sessionId || res.sessionId;
    logger.info('[Appium] Session created', { sessionId: this.sessionId });
    return this.sessionId;
  }

  async deleteSession(): Promise<void> {
    if (!this.sessionId) return;
    await this.request('DELETE', this.baseUrl);
    logger.info('[Appium] Session deleted', { sessionId: this.sessionId });
    this.sessionId = '';
  }

  // ─── Element Operations ─────────────────────────────────

  async findElement(strategy: string, selector: string): Promise<{ elementId: string }> {
    // W3C strategies: 'id', 'xpath', 'css selector', 'class name', 'accessibility id',
    // '-android uiautomator' (UiAutomator2)
    const using = this.normalizeStrategy(strategy);
    const res = await this.request('POST', `${this.baseUrl}/element`, { using, value: selector });
    const elementId = res.value?.ELEMENT || res.value?.['element-6066-11e4-a52e-4f735466cecf'] || Object.values(res.value || {})[0];
    return { elementId: elementId as string };
  }

  async findElements(strategy: string, selector: string): Promise<Array<{ elementId: string }>> {
    const using = this.normalizeStrategy(strategy);
    const res = await this.request('POST', `${this.baseUrl}/elements`, { using, value: selector });
    return (res.value || []).map((el: Record<string, string>) => {
      const elementId = el.ELEMENT || el['element-6066-11e4-a52e-4f735466cecf'] || Object.values(el)[0];
      return { elementId };
    });
  }

  async clickElement(elementId: string): Promise<void> {
    await this.request('POST', `${this.baseUrl}/element/${elementId}/click`, {});
  }

  async sendKeys(elementId: string, text: string): Promise<void> {
    await this.request('POST', `${this.baseUrl}/element/${elementId}/value`, { text });
  }

  async clearElement(elementId: string): Promise<void> {
    await this.request('POST', `${this.baseUrl}/element/${elementId}/clear`, {});
  }

  async getElementText(elementId: string): Promise<string> {
    const res = await this.request('GET', `${this.baseUrl}/element/${elementId}/text`);
    return res.value || '';
  }

  async getElementAttribute(elementId: string, attribute: string): Promise<string> {
    const res = await this.request('GET', `${this.baseUrl}/element/${elementId}/attribute/${attribute}`);
    return res.value || '';
  }

  async isElementDisplayed(elementId: string): Promise<boolean> {
    const res = await this.request('GET', `${this.baseUrl}/element/${elementId}/displayed`);
    return !!res.value;
  }

  // ─── Touch Actions (W3C Actions API) ───────────────────

  async tap(x: number, y: number): Promise<void> {
    await this.performActions([{
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x, y },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 50 },
        { type: 'pointerUp', button: 0 },
      ],
    }]);
  }

  async swipe(startX: number, startY: number, endX: number, endY: number, duration = 300): Promise<void> {
    await this.performActions([{
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x: startX, y: startY },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerMove', duration, x: endX, y: endY },
        { type: 'pointerUp', button: 0 },
      ],
    }]);
  }

  async longPress(x: number, y: number, duration = 1000): Promise<void> {
    await this.performActions([{
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x, y },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration },
        { type: 'pointerUp', button: 0 },
      ],
    }]);
  }

  private async performActions(actions: unknown[]): Promise<void> {
    await this.request('POST', `${this.baseUrl}/actions`, { actions });
  }

  // ─── Screen ─────────────────────────────────────────────

  async screenshot(): Promise<string> {
    const res = await this.request('GET', `${this.baseUrl}/screenshot`);
    return res.value || ''; // base64 PNG
  }

  async getPageSource(): Promise<string> {
    const res = await this.request('GET', `${this.baseUrl}/source`);
    return res.value || '';
  }

  // ─── App Management ─────────────────────────────────────

  async activateApp(appId: string): Promise<void> {
    await this.request('POST', `${this.baseUrl}/appium/device/activate_app`, { appId });
  }

  async terminateApp(appId: string): Promise<boolean> {
    const res = await this.request('POST', `${this.baseUrl}/appium/device/terminate_app`, { appId });
    return !!res.value;
  }

  async queryAppState(appId: string): Promise<number> {
    const res = await this.request('POST', `${this.baseUrl}/appium/device/app_state`, { appId });
    return res.value as number; // 0=not installed, 1=not running, 3=background, 4=foreground
  }

  // ─── Device Commands ────────────────────────────────────

  async pressKey(keycode: number): Promise<void> {
    await this.request('POST', `${this.baseUrl}/appium/device/press_keycode`, { keycode });
  }

  async setClipboard(content: string): Promise<void> {
    const b64 = Buffer.from(content).toString('base64');
    await this.request('POST', `${this.baseUrl}/appium/device/set_clipboard`, {
      content: b64, contentType: 'plaintext',
    });
  }

  async getClipboard(): Promise<string> {
    const res = await this.request('POST', `${this.baseUrl}/appium/device/get_clipboard`, { contentType: 'plaintext' });
    return Buffer.from(res.value || '', 'base64').toString('utf-8');
  }

  // ─── HTTP Transport ─────────────────────────────────────

  private async request(method: string, url: string, body?: unknown): Promise<any> {
    const opts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);
    const text = await res.text();

    let data: any;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!res.ok) {
      const errMsg = data?.value?.message || data?.message || text.slice(0, 300);
      throw new Error(`Appium ${method} ${url} failed (${res.status}): ${errMsg}`);
    }

    return data;
  }

  // ─── Helpers ────────────────────────────────────────────

  private normalizeStrategy(strategy: string): string {
    const map: Record<string, string> = {
      'id': 'id',
      'xpath': 'xpath',
      'css': 'css selector',
      'css selector': 'css selector',
      'class': 'class name',
      'class name': 'class name',
      'accessibility': 'accessibility id',
      'accessibility id': 'accessibility id',
      'uiautomator': '-android uiautomator',
      '-android uiautomator': '-android uiautomator',
    };
    return map[strategy] || strategy;
  }
}
