/**
 * Message Guard — Pre-AI Input Validation
 *
 * Scans incoming messages BEFORE they reach the LLM.
 * Catches prompt injection, role confusion, obfuscation, and rate-limit abuse.
 * This is the first line of defense — runs before any AI call.
 */

import { scanForInjection } from './content-guard.js';
import logger from '../utils/logger.js';

// ── Obfuscation Patterns ──────────────────────────────────────────────────
// Detect attempts to hide malicious content via encoding/unicode tricks
const OBFUSCATION_PATTERNS = [
  /atob\s*\(/i,                          // Base64 decode in JS
  /Buffer\.from\s*\(/i,                  // Node.js buffer decode
  /String\.fromCharCode/i,              // Char code assembly
  /\\x[0-9a-f]{2}/i,                    // Hex escape sequences
  /\\u[0-9a-f]{4}/i,                    // Unicode escapes
  /[\u200B-\u200F\u2028-\u202F\uFEFF]/, // Zero-width / invisible chars
  /[\u0300-\u036F]{3,}/,                // Stacked combining diacriticals
  /[\uFF01-\uFF5E]{5,}/,               // Fullwidth ASCII (homoglyph abuse)
  /base64[,;:]/i,                        // data:text/html;base64,...
];

// ── Role Confusion Patterns ───────────────────────────────────────────────
// Detect attempts to trick the AI into adopting a different role
const ROLE_CONFUSION_PATTERNS = [
  /\bsystem\s*:/i,                       // Fake system message prefix
  /<\|im_start\|>/i,                     // ChatML injection
  /<\|im_end\|>/i,                       // ChatML injection
  /<\|endoftext\|>/i,                    // GPT tokenizer boundary
  /\[INST\]/i,                           // Llama instruction token
  /\[\/INST\]/i,                         // Llama end instruction
  /<<SYS>>/i,                            // Llama system block
  /Human:\s*$|Assistant:\s*$/mi,         // Claude role injection
  /\buser\s*:\s*$|assistant\s*:\s*$/mi,  // Generic role injection
  /new\s+instructions?\s*:/i,            // Override attempt
  /updated?\s+system\s+prompt/i,         // Prompt override
  /from\s+now\s+on\s*,?\s*(you|your|ignore|forget)/i,  // Behavioral override
];

// ── Rate Limiting ─────────────────────────────────────────────────────────
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;  // 1 minute
const RATE_LIMIT_MAX = 30;            // 30 messages per minute (generous)

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(userId, { count: 1, windowStart: now });
    return true;
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return false;
  }
  return true;
}

// Cleanup stale rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitMap.delete(key);
    }
  }
}, 5 * 60_000); // Every 5 minutes

// ── Main Scan Function ────────────────────────────────────────────────────

export interface MessageGuardResult {
  safe: boolean;
  flags: string[];
  blocked: boolean;
  score: number;
}

/**
 * Scan an incoming message for security threats before it reaches the AI.
 *
 * @param text - The user's message text
 * @param userId - User identifier for rate limiting
 * @returns Scan result with flags and block decision
 */
export function scanMessage(text: string, userId: string): MessageGuardResult {
  const flags: string[] = [];
  let score = 0;

  // 1. Rate limiting
  if (!checkRateLimit(userId)) {
    logger.warn('Message rate limit exceeded', { userId });
    return { safe: false, flags: ['rate_limit_exceeded'], blocked: true, score: 100 };
  }

  // 2. Injection pattern scan (reuse content-guard patterns)
  const injectionResult = scanForInjection(text);
  if (injectionResult.detected) {
    flags.push(...injectionResult.patterns.map(p => `injection:${p}`));
    score += injectionResult.score;
  }

  // 3. Obfuscation detection
  for (const pattern of OBFUSCATION_PATTERNS) {
    if (pattern.test(text)) {
      flags.push(`obfuscation:${pattern.source.slice(0, 40)}`);
      score += 3;
    }
  }

  // 4. Role confusion detection
  for (const pattern of ROLE_CONFUSION_PATTERNS) {
    if (pattern.test(text)) {
      flags.push(`role_confusion:${pattern.source.slice(0, 40)}`);
      score += 7;
    }
  }

  // 5. Excessive length (potential context overflow attack)
  if (text.length > 50_000) {
    flags.push('excessive_length');
    score += 5;
  }

  // Decision: block if score >= 15 (high confidence threat)
  const blocked = score >= 15;

  if (flags.length > 0) {
    logger.warn('Message guard flags detected', {
      userId,
      flagCount: flags.length,
      score,
      blocked,
      flags: flags.slice(0, 10),
    });
  }

  return {
    safe: flags.length === 0,
    flags,
    blocked,
    score,
  };
}
