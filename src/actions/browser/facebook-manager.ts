/**
 * Facebook Account Manager — stores accounts, injects cookies, verifies login.
 * Uses JSON file storage in data/facebook-accounts.json.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import {
  parseFacebookCookies,
  validateFacebookCookies,
  toPlaywrightCookies,
  type FacebookCookie,
  type ParseResult,
} from './facebook-cookies.js';
import { BrowserSessionManager } from './session-manager.js';
import logger from '../../utils/logger.js';

export interface FacebookAccount {
  id: string;
  name: string;
  userId?: string;
  cookies: FacebookCookie[];
  cookieFormat: 'json' | 'buy' | 'plain';
  status: 'untested' | 'active' | 'failed' | 'blocked' | 'checkpoint';
  profileName?: string;
  profilePicUrl?: string;
  lastVerified?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

const DATA_DIR = resolve(process.cwd(), 'data');
const ACCOUNTS_FILE = resolve(DATA_DIR, 'facebook-accounts.json');

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadAccounts(): FacebookAccount[] {
  ensureDataDir();
  if (!existsSync(ACCOUNTS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveAccounts(accounts: FacebookAccount[]) {
  ensureDataDir();
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf-8');
}

export class FacebookAccountManager {
  private static instance: FacebookAccountManager;

  static getInstance(): FacebookAccountManager {
    if (!FacebookAccountManager.instance) {
      FacebookAccountManager.instance = new FacebookAccountManager();
    }
    return FacebookAccountManager.instance;
  }

  /** List all stored accounts */
  listAccounts(): FacebookAccount[] {
    return loadAccounts();
  }

  /** Get a single account by ID */
  getAccount(id: string): FacebookAccount | undefined {
    return loadAccounts().find(a => a.id === id);
  }

  /**
   * Add a new Facebook account from raw cookie input.
   * Parses cookies, validates, and stores.
   */
  addAccount(name: string, cookieInput: string): { account: FacebookAccount; validation: ReturnType<typeof validateFacebookCookies>; parseResult: ParseResult } {
    const parseResult = parseFacebookCookies(cookieInput);

    if (parseResult.error) {
      throw new Error(`Cookie parse error: ${parseResult.error}`);
    }

    if (parseResult.cookies.length === 0) {
      throw new Error('No cookies found in input');
    }

    const validation = validateFacebookCookies(parseResult.cookies);

    const account: FacebookAccount = {
      id: crypto.randomUUID(),
      name,
      userId: parseResult.userId,
      cookies: parseResult.cookies,
      cookieFormat: parseResult.format,
      status: validation.valid ? 'untested' : 'failed',
      lastError: validation.valid ? undefined : `Missing required cookies: ${validation.missing.join(', ')}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const accounts = loadAccounts();
    accounts.push(account);
    saveAccounts(accounts);

    logger.info('Facebook account added', { id: account.id, name, userId: account.userId, format: parseResult.format, cookieCount: parseResult.cookies.length });

    return { account, validation, parseResult };
  }

  /** Update cookies for an existing account */
  updateCookies(id: string, cookieInput: string): { account: FacebookAccount; validation: ReturnType<typeof validateFacebookCookies> } {
    const accounts = loadAccounts();
    const idx = accounts.findIndex(a => a.id === id);
    if (idx === -1) throw new Error(`Account ${id} not found`);

    const parseResult = parseFacebookCookies(cookieInput);
    if (parseResult.error) throw new Error(`Cookie parse error: ${parseResult.error}`);
    if (parseResult.cookies.length === 0) throw new Error('No cookies found in input');

    const validation = validateFacebookCookies(parseResult.cookies);

    accounts[idx].cookies = parseResult.cookies;
    accounts[idx].cookieFormat = parseResult.format;
    accounts[idx].userId = parseResult.userId || accounts[idx].userId;
    accounts[idx].status = validation.valid ? 'untested' : 'failed';
    accounts[idx].lastError = validation.valid ? undefined : `Missing required: ${validation.missing.join(', ')}`;
    accounts[idx].updatedAt = new Date().toISOString();

    saveAccounts(accounts);
    return { account: accounts[idx], validation };
  }

  /** Delete an account */
  deleteAccount(id: string): void {
    const accounts = loadAccounts();
    const filtered = accounts.filter(a => a.id !== id);
    if (filtered.length === accounts.length) throw new Error(`Account ${id} not found`);
    saveAccounts(filtered);
    logger.info('Facebook account deleted', { id });
  }

  /**
   * Launch a browser session, inject cookies, navigate to Facebook, and verify login.
   * Returns session ID + verification result.
   */
  async verifyAccount(id: string): Promise<{
    success: boolean;
    sessionId: string;
    profileName?: string;
    profilePicUrl?: string;
    error?: string;
  }> {
    const accounts = loadAccounts();
    const idx = accounts.findIndex(a => a.id === id);
    if (idx === -1) throw new Error(`Account ${id} not found`);

    const account = accounts[idx];
    const validation = validateFacebookCookies(account.cookies);
    if (!validation.valid) {
      throw new Error(`Cannot verify — missing required cookies: ${validation.missing.join(', ')}`);
    }

    const mgr = BrowserSessionManager.getInstance();
    let sessionId: string | null = null;

    try {
      // Create a headless session (no VNC by default — user can attach later)
      const session = await mgr.createSession(undefined, false);
      sessionId = session.id;

      const page = mgr.getPage(sessionId);
      if (!page) throw new Error('Failed to get page from session');

      // Step 1: Navigate to Facebook first (cookies need the domain context)
      await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 });

      // Step 2: Inject cookies via Playwright context
      const context = page.context();
      const pwCookies = toPlaywrightCookies(account.cookies);
      await context.addCookies(pwCookies);

      // Step 3: Reload the page to apply cookies
      await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(3000); // Wait for FB to process session

      // Step 4: Check if we're logged in
      const loginCheck = await page.evaluate(`(() => {
        // Check for login form (means NOT logged in)
        const loginForm = document.querySelector('#email') || document.querySelector('[name="email"]');
        if (loginForm) return { loggedIn: false, reason: 'Login form detected' };

        // Check for checkpoint
        const checkpoint = document.querySelector('#checkpoint_title') || document.body.innerText.includes('Confirm Your Identity');
        if (checkpoint) return { loggedIn: false, reason: 'Checkpoint/security verification required' };

        // Check for logged-in indicators
        const profileLink = document.querySelector('[aria-label="Your profile"]') ||
                            document.querySelector('[data-pagelet="ProfileTile"]') ||
                            document.querySelector('div[role="banner"]');

        // Try to get profile name
        const nameEl = document.querySelector('[aria-label="Your profile"]');
        const profileName = nameEl ? nameEl.getAttribute('aria-label') : null;

        // Try to get profile pic
        const picEl = document.querySelector('svg[aria-label="Your profile"] image') ||
                     document.querySelector('image[preserveAspectRatio]');
        const profilePic = picEl ? picEl.getAttribute('xlink:href') || picEl.getAttribute('href') : null;

        if (profileLink) return { loggedIn: true, profileName, profilePic };

        // Fallback: check URL isn't login page
        if (!location.href.includes('login') && !location.href.includes('checkpoint')) {
          return { loggedIn: true, profileName: null, profilePic: null };
        }

        return { loggedIn: false, reason: 'Unknown state' };
      })()`);

      // Update account status
      if (loginCheck.loggedIn) {
        accounts[idx].status = 'active';
        accounts[idx].profileName = loginCheck.profileName || undefined;
        accounts[idx].profilePicUrl = loginCheck.profilePic || undefined;
        accounts[idx].lastVerified = new Date().toISOString();
        accounts[idx].lastError = undefined;
      } else if (loginCheck.reason?.includes('Checkpoint')) {
        accounts[idx].status = 'checkpoint';
        accounts[idx].lastError = loginCheck.reason;
      } else {
        accounts[idx].status = 'failed';
        accounts[idx].lastError = loginCheck.reason || 'Login failed';
      }

      accounts[idx].updatedAt = new Date().toISOString();
      saveAccounts(accounts);

      // Close the session after verification
      try { await mgr.closeSession(sessionId); } catch { /* best effort */ }

      return {
        success: loginCheck.loggedIn,
        sessionId,
        profileName: loginCheck.profileName || undefined,
        profilePicUrl: loginCheck.profilePic || undefined,
        error: loginCheck.loggedIn ? undefined : loginCheck.reason,
      };
    } catch (err: any) {
      // Cleanup on error
      if (sessionId) {
        try { await mgr.closeSession(sessionId); } catch { /* */ }
      }

      accounts[idx].status = 'failed';
      accounts[idx].lastError = err.message;
      accounts[idx].updatedAt = new Date().toISOString();
      saveAccounts(accounts);

      logger.error('Facebook account verification failed', { id, error: err.message });
      return { success: false, sessionId: sessionId || '', error: err.message };
    }
  }

  /**
   * Launch a browser session with Facebook cookies injected — ready for use.
   * Unlike verify, this keeps the session open for the user/agent to use.
   */
  async launchSession(id: string, withVnc = true): Promise<{ sessionId: string; url: string }> {
    const account = this.getAccount(id);
    if (!account) throw new Error(`Account ${id} not found`);

    const validation = validateFacebookCookies(account.cookies);
    if (!validation.valid) {
      throw new Error(`Cannot launch — missing required cookies: ${validation.missing.join(', ')}`);
    }

    const mgr = BrowserSessionManager.getInstance();
    const session = await mgr.createSession(undefined, withVnc);

    try {
      const page = mgr.getPage(session.id);
      if (!page) throw new Error('Failed to get page');

      // Navigate to Facebook first
      await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 });

      // Inject cookies
      const context = page.context();
      await context.addCookies(toPlaywrightCookies(account.cookies));

      // Reload with cookies
      await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 });

      return { sessionId: session.id, url: 'https://www.facebook.com/' };
    } catch (err: any) {
      try { await mgr.closeSession(session.id); } catch { /* */ }
      throw new Error(`Failed to launch Facebook session: ${err.message}`);
    }
  }
}
