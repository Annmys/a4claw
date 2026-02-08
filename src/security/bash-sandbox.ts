import logger from '../utils/logger.js';

/**
 * Bash Sandbox — restricts what bash commands can do.
 * Works alongside command-guard.ts for defense-in-depth.
 */

// Environment variables that should NEVER be exposed to bash commands
const SENSITIVE_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'DISCORD_BOT_TOKEN',
  'GITHUB_TOKEN',
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  'DATABASE_URL',
  'REDIS_URL',
  'GMAIL_CLIENT_SECRET',
  'GMAIL_REFRESH_TOKEN',
  'TWILIO_AUTH_TOKEN',
  'BLOTATO_API_KEY',
  'KIE_AI_API_KEY',
  'OPENCLAW_GATEWAY_TOKEN',
  'OPENAI_API_KEY',
];

// Patterns that indicate attempts to read secrets
const SECRET_EXFIL_PATTERNS = [
  /\$\{?\w*API_KEY/i,
  /\$\{?\w*TOKEN/i,
  /\$\{?\w*SECRET/i,
  /\$\{?\w*PASSWORD/i,
  /printenv/i,
  /env\s*\|/i,
  /cat\s+.*\.env/i,
  /cat\s+.*credentials/i,
  /cat\s+.*\/etc\/shadow/i,
  /cat\s+.*id_rsa/i,
  /cat\s+.*\.ssh/i,
];

// Max execution time for sandboxed commands (in ms)
const MAX_EXECUTION_TIME = 120000; // 2 minutes

// Max output size (in bytes)
const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB

export interface SandboxOptions {
  allowNetwork?: boolean;
  allowWriteFS?: boolean;
  maxTime?: number;
  workingDir?: string;
}

export interface SandboxResult {
  allowed: boolean;
  sanitizedCommand?: string;
  reason?: string;
  options: SandboxOptions;
}

/**
 * Sanitize a command for sandboxed execution.
 * Strips environment variable references that could leak secrets.
 */
export function sandboxCommand(command: string, options: SandboxOptions = {}): SandboxResult {
  // Check for secret exfiltration attempts
  for (const pattern of SECRET_EXFIL_PATTERNS) {
    if (pattern.test(command)) {
      logger.warn('Sandbox blocked secret exfil attempt', { command: command.slice(0, 100) });
      return { allowed: false, reason: 'Command attempts to access sensitive data', options };
    }
  }

  return {
    allowed: true,
    sanitizedCommand: command,
    options: {
      allowNetwork: options.allowNetwork ?? true,
      allowWriteFS: options.allowWriteFS ?? true,
      maxTime: Math.min(options.maxTime ?? MAX_EXECUTION_TIME, MAX_EXECUTION_TIME),
      workingDir: options.workingDir,
    },
  };
}

/**
 * Build a clean environment for sandboxed execution.
 * Removes sensitive env vars.
 */
export function getSandboxedEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue;
    if (SENSITIVE_ENV_VARS.includes(key)) continue;
    if (key.endsWith('_KEY') || key.endsWith('_TOKEN') || key.endsWith('_SECRET') || key.endsWith('_PASSWORD')) continue;
    env[key] = value;
  }

  // Add safe defaults
  env.TERM = env.TERM ?? 'xterm-256color';
  env.LANG = env.LANG ?? 'en_US.UTF-8';

  return env;
}

export const SANDBOX_LIMITS = {
  maxExecutionTime: MAX_EXECUTION_TIME,
  maxOutputSize: MAX_OUTPUT_SIZE,
  sensitiveEnvVars: SENSITIVE_ENV_VARS.length,
};
