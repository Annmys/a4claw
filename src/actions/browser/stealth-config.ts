/**
 * Browser stealth configuration — anti-detection measures applied via addInitScript().
 * No external dependencies (no playwright-extra). Inline stealth only.
 */

/** Chromium launch args for stealth mode */
export const STEALTH_ARGS: string[] = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-sync',
  '--disable-translate',
  '--metrics-recording-only',
  '--no-first-run',
  '--no-default-browser-check',
  '--password-store=basic',
  '--use-mock-keychain',
  '--lang=en-US,en',
  '--window-size=1920,1080',
];

/** Rotating pool of realistic Chrome User-Agents */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
];

/** Pick a random User-Agent from the pool */
export function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * JavaScript snippet injected into every page via page.addInitScript().
 * Masks navigator.webdriver, injects chrome.runtime, canvas/WebGL noise, etc.
 */
export const STEALTH_INIT_SCRIPT = `
// ── 1. Mask navigator.webdriver ──
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

// ── 2. Inject chrome.runtime (sites check this) ──
if (!window.chrome) window.chrome = {};
if (!window.chrome.runtime) {
  window.chrome.runtime = {
    connect: function() {},
    sendMessage: function() {},
    id: 'browser-session',
  };
}

// ── 3. Fix permissions API (Notification always 'denied' in automation) ──
const origQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
if (origQuery) {
  window.navigator.permissions.query = (params) => {
    if (params.name === 'notifications') {
      return Promise.resolve({ state: Notification.permission });
    }
    return origQuery(params);
  };
}

// ── 4. Canvas fingerprint noise ──
const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
HTMLCanvasElement.prototype.toDataURL = function(type) {
  const ctx = this.getContext('2d');
  if (ctx) {
    const imageData = ctx.getImageData(0, 0, Math.min(this.width, 4), Math.min(this.height, 4));
    for (let i = 0; i < imageData.data.length; i += 4) {
      imageData.data[i] = imageData.data[i] ^ (Math.random() > 0.5 ? 1 : 0);
    }
    ctx.putImageData(imageData, 0, 0);
  }
  return origToDataURL.apply(this, arguments);
};

// ── 5. WebGL vendor/renderer spoofing ──
const getParameterOrig = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(param) {
  if (param === 37445) return 'Google Inc. (NVIDIA)';
  if (param === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Direct3D11 vs_5_0 ps_5_0, D3D11)';
  return getParameterOrig.call(this, param);
};

// ── 6. Mask plugins array (headless has 0 plugins) ──
Object.defineProperty(navigator, 'plugins', {
  get: () => [
    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
    { name: 'Native Client', filename: 'internal-nacl-plugin' },
  ],
});

// ── 7. Mask languages ──
Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

// ── 8. Mask hardwareConcurrency (headless often shows 1) ──
Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });

// ── 9. Mask deviceMemory ──
Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
`;

/** Default browser context options for stealth sessions */
export function getStealthContextOptions() {
  return {
    viewport: { width: 1920, height: 1080 },
    userAgent: getRandomUserAgent(),
    locale: 'en-US',
    timezoneId: 'America/New_York',
    colorScheme: 'light' as const,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    javaScriptEnabled: true,
    ignoreHTTPSErrors: true,
  };
}
