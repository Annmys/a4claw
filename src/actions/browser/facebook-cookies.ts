/**
 * Facebook Cookie Utilities — parse, validate, and inject Facebook cookies.
 * Supports 3 formats: JSON (Cookie Editor), BUY (pipe-separated), and plain cookie string.
 */

export interface FacebookCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  expires?: number;
}

export interface ParseResult {
  cookies: FacebookCookie[];
  userId?: string;
  format: 'json' | 'buy' | 'plain';
  error?: string;
}

/** Fields that Playwright doesn't accept — strip these from imported cookies */
const STRIP_FIELDS = new Set(['sameSite', 'priority', 'storeId', 'id', 'session', 'hostOnly', 'firstPartyDomain']);

/** Essential cookies that must be present for a valid Facebook session */
const REQUIRED_COOKIES = ['c_user', 'xs'];

/** Common Facebook cookie names for reference */
const KNOWN_FB_COOKIES = ['c_user', 'xs', 'datr', 'fr', 'sb', 'spin', 'wd', 'presence', 'locale'];

/**
 * Detect the format of the cookie input and parse accordingly.
 */
export function parseFacebookCookies(input: string): ParseResult {
  const trimmed = input.trim();

  // Try JSON format first (Cookie Editor export)
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return parseCookieEditorJson(trimmed);
  }

  // Try BUY format (pipe-separated)
  if (trimmed.includes('|') && trimmed.split('|').length >= 5) {
    return parseBuyFormat(trimmed);
  }

  // Fall back to plain cookie string
  return parsePlainCookies(trimmed);
}

/**
 * Parse JSON format from Cookie Editor browser extension.
 * Input: [{ "name": "c_user", "value": "123", "domain": ".facebook.com", ... }]
 */
function parseCookieEditorJson(input: string): ParseResult {
  try {
    let parsed = JSON.parse(input);
    if (!Array.isArray(parsed)) parsed = [parsed];

    const cookies: FacebookCookie[] = parsed
      .filter((c: any) => c.name && c.value)
      .map((c: any) => sanitizeCookie({
        name: String(c.name),
        value: String(c.value),
        domain: c.domain || '.facebook.com',
        path: c.path || '/',
        httpOnly: c.httpOnly ?? false,
        secure: c.secure ?? true,
        expires: c.expirationDate ? Math.floor(Number(c.expirationDate)) : undefined,
      }));

    const userId = cookies.find(c => c.name === 'c_user')?.value;

    return { cookies, userId, format: 'json' };
  } catch (err: any) {
    return { cookies: [], format: 'json', error: `Invalid JSON: ${err.message}` };
  }
}

/**
 * Parse BUY format (common in Facebook account marketplaces).
 * Format: USER_ID|PASSWORD|2FA|EMAIL|EMAIL_PASS|...|COOKIES|TOKEN
 * The COOKIES field is usually in plain cookie string format.
 */
function parseBuyFormat(input: string): ParseResult {
  const parts = input.split('|');

  // Find the part that looks like cookies (contains c_user= or ;)
  let cookiePart = '';
  for (const part of parts) {
    if (part.includes('c_user=') || (part.includes(';') && part.includes('='))) {
      cookiePart = part;
      break;
    }
  }

  if (!cookiePart) {
    // Try last non-empty part before token as cookies field
    const nonEmpty = parts.filter(p => p.trim().length > 0);
    if (nonEmpty.length >= 2) {
      cookiePart = nonEmpty[nonEmpty.length - 2]; // Second to last is usually cookies
    }
  }

  if (!cookiePart || !cookiePart.includes('=')) {
    return { cookies: [], format: 'buy', error: 'Could not find cookies field in BUY format' };
  }

  const result = parsePlainCookies(cookiePart);
  result.format = 'buy';

  // Extract user ID from first field if available
  if (parts[0] && /^\d+$/.test(parts[0].trim())) {
    result.userId = parts[0].trim();
  }

  return result;
}

/**
 * Parse plain cookie string format.
 * Input: "c_user=123456; xs=abc123; datr=xyz789"
 */
function parsePlainCookies(input: string): ParseResult {
  const cookies: FacebookCookie[] = [];

  const pairs = input.split(';').map(s => s.trim()).filter(s => s.includes('='));

  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;

    const name = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1).trim();

    if (!name || !value) continue;

    cookies.push(sanitizeCookie({
      name,
      value,
      domain: '.facebook.com',
      path: '/',
      httpOnly: name === 'xs' || name === 'c_user',
      secure: true,
    }));
  }

  const userId = cookies.find(c => c.name === 'c_user')?.value;

  return { cookies, userId, format: 'plain' };
}

/**
 * Clean up a cookie object for Playwright compatibility.
 */
function sanitizeCookie(cookie: FacebookCookie): FacebookCookie {
  // Ensure domain starts with dot for facebook.com
  if (cookie.domain && !cookie.domain.startsWith('.') && cookie.domain.includes('facebook.com')) {
    cookie.domain = '.' + cookie.domain;
  }

  // Default to .facebook.com if no domain
  if (!cookie.domain) {
    cookie.domain = '.facebook.com';
  }

  // Set far-future expiry if none
  if (!cookie.expires || cookie.expires < Date.now() / 1000) {
    cookie.expires = Math.floor(Date.now() / 1000) + 365 * 24 * 3600; // 1 year
  }

  return cookie;
}

/**
 * Validate that parsed cookies contain the essential Facebook session cookies.
 */
export function validateFacebookCookies(cookies: FacebookCookie[]): { valid: boolean; missing: string[]; warnings: string[] } {
  const names = new Set(cookies.map(c => c.name));
  const missing = REQUIRED_COOKIES.filter(r => !names.has(r));
  const warnings: string[] = [];

  if (!names.has('datr')) {
    warnings.push('Missing "datr" cookie — Facebook may flag this session as suspicious');
  }

  if (!names.has('fr')) {
    warnings.push('Missing "fr" cookie — some features may not work');
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
  };
}

/**
 * Convert cookies to Playwright-compatible format for context.addCookies().
 */
export function toPlaywrightCookies(cookies: FacebookCookie[]): Array<{
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  expires: number;
}> {
  return cookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    httpOnly: c.httpOnly,
    secure: c.secure,
    expires: c.expires || Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
  }));
}
