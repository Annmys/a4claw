import { Router, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { generateToken, hashPassword, verifyPassword } from '../../../security/auth.js';
import { audit } from '../../../security/audit-log.js';
import { getDb } from '../../../memory/database.js';
import { webCredentials } from '../../../memory/schema.js';
import logger from '../../../utils/logger.js';

// Failed login tracking for brute-force protection (in-memory is fine for this)
const failedAttempts = new Map<string, { count: number; lockedUntil: number }>();
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

function checkBruteForce(key: string): { allowed: boolean; waitSeconds?: number } {
  const entry = failedAttempts.get(key);
  if (!entry) return { allowed: true };

  if (Date.now() < entry.lockedUntil) {
    const waitSeconds = Math.ceil((entry.lockedUntil - Date.now()) / 1000);
    return { allowed: false, waitSeconds };
  }

  failedAttempts.delete(key);
  return { allowed: true };
}

function recordFailedAttempt(key: string): void {
  const entry = failedAttempts.get(key) ?? { count: 0, lockedUntil: 0 };
  entry.count++;
  if (entry.count >= MAX_FAILED_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
    logger.warn('Account locked due to failed attempts', { key, lockoutMinutes: LOCKOUT_DURATION_MS / 60000 });
  }
  failedAttempts.set(key, entry);
}

function clearFailedAttempts(key: string): void {
  failedAttempts.delete(key);
}

function isStrongPassword(password: string): { valid: boolean; reason?: string } {
  if (password.length < 8) return { valid: false, reason: 'Password must be at least 8 characters' };
  if (!/[A-Z]/.test(password)) return { valid: false, reason: 'Password must contain an uppercase letter' };
  if (!/[a-z]/.test(password)) return { valid: false, reason: 'Password must contain a lowercase letter' };
  if (!/[0-9]/.test(password)) return { valid: false, reason: 'Password must contain a number' };
  return { valid: true };
}

export function setupAuthRoutes(): Router {
  const router = Router();

  // POST /register — First user becomes admin, subsequent self-register as regular user
  router.post('/register', async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) { res.status(400).json({ error: 'Username and password required' }); return; }

      if (!/^[a-zA-Z0-9_-]{3,30}$/.test(username)) {
        res.status(400).json({ error: 'Username must be 3-30 characters (letters, numbers, _, -)' });
        return;
      }

      const pwCheck = isStrongPassword(password);
      if (!pwCheck.valid) { res.status(400).json({ error: pwCheck.reason }); return; }

      const db = getDb();

      // Check if user already exists
      const existing = await db.select().from(webCredentials)
        .where(eq(webCredentials.username, username)).limit(1);
      if (existing.length > 0) { res.status(409).json({ error: 'User exists' }); return; }

      // Check if any user exists (first user = admin)
      const allUsers = await db.select().from(webCredentials).limit(1);
      const isFirstUser = allUsers.length === 0;

      const role = isFirstUser ? 'admin' : 'user';
      const pwHash = await hashPassword(password);

      await db.insert(webCredentials).values({
        username,
        passwordHash: pwHash,
        role,
        lastLogin: new Date(),
      });

      if (isFirstUser) {
        logger.info('First web user registered as admin (persisted to DB)', { username });
      }

      await audit(username, 'user.register', { role, isFirstUser });
      const token = generateToken({ userId: username, role, platform: 'web' });
      res.json({ token, role });
    } catch (err: any) {
      logger.error('Registration failed', { error: err.message });
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  // POST /login — Authenticate with brute-force protection
  router.post('/login', async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) { res.status(400).json({ error: 'Username and password required' }); return; }

      const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
      const bruteForceKey = `${ip}:${username}`;

      const bfCheck = checkBruteForce(bruteForceKey);
      if (!bfCheck.allowed) {
        await audit(username, 'user.login_locked', { ip, waitSeconds: bfCheck.waitSeconds });
        res.status(429).json({ error: `Account locked. Try again in ${bfCheck.waitSeconds}s` });
        return;
      }

      const db = getDb();
      const [user] = await db.select().from(webCredentials)
        .where(eq(webCredentials.username, username)).limit(1);

      if (!user) {
        recordFailedAttempt(bruteForceKey);
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        recordFailedAttempt(bruteForceKey);
        await audit(username, 'user.login_failed', { ip });
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      // Success
      clearFailedAttempts(bruteForceKey);
      await db.update(webCredentials)
        .set({ lastLogin: new Date() })
        .where(eq(webCredentials.id, user.id));

      await audit(username, 'user.login', { ip, role: user.role });
      const token = generateToken({ userId: username, role: user.role, platform: 'web' });
      res.json({ token, role: user.role });
    } catch (err: any) {
      logger.error('Login failed', { error: err.message });
      res.status(500).json({ error: 'Login failed' });
    }
  });

  // POST /logout — Revoke current token
  router.post('/logout', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { res.status(401).json({ error: 'No token' }); return; }

    const token = authHeader.slice(7);
    const { revokeToken } = await import('../../../security/auth.js');
    const revoked = revokeToken(token);
    if (revoked) {
      await audit('system', 'user.logout', { success: true });
    }
    res.json({ ok: true });
  });

  return router;
}

// Cleanup failed attempts every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of failedAttempts) {
    if (now >= entry.lockedUntil + LOCKOUT_DURATION_MS) failedAttempts.delete(key);
  }
}, 5 * 60 * 1000);
