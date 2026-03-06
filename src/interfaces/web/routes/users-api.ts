import { Router, Request, Response } from 'express';
import { desc, eq, sql } from 'drizzle-orm';
import { hashPassword } from '../../../security/auth.js';
import { audit } from '../../../security/audit-log.js';
import { getDb } from '../../../memory/database.js';
import { webCredentials } from '../../../memory/schema.js';
import logger from '../../../utils/logger.js';

type UserRole = 'admin' | 'user';

function requireAdmin(req: Request, res: Response): { userId: string; role: string } | null {
  const user = (req as any).user as { userId: string; role: string } | undefined;
  if (!user || user.role !== 'admin') {
    res.status(403).json({ error: 'Admin only' });
    return null;
  }
  return user;
}

function isStrongPassword(password: string): { valid: boolean; reason?: string } {
  if (password.length < 8) return { valid: false, reason: 'Password must be at least 8 characters' };
  if (!/[A-Z]/.test(password)) return { valid: false, reason: 'Password must contain an uppercase letter' };
  if (!/[a-z]/.test(password)) return { valid: false, reason: 'Password must contain a lowercase letter' };
  if (!/[0-9]/.test(password)) return { valid: false, reason: 'Password must contain a number' };
  return { valid: true };
}

function toSafeUser(user: {
  id: string;
  username: string;
  role: string;
  lastLogin: Date | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt,
  };
}

async function countAdmins(): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(webCredentials)
    .where(eq(webCredentials.role, 'admin'));
  return row?.count ?? 0;
}

export function setupUsersRoutes(): Router {
  const router = Router();

  // GET /api/users — list users (admin only)
  router.get('/', async (req: Request, res: Response) => {
    const actor = requireAdmin(req, res);
    if (!actor) return;

    try {
      const db = getDb();
      const users = await db.select().from(webCredentials).orderBy(desc(webCredentials.createdAt));
      res.json({ users: users.map(toSafeUser) });
    } catch (err: any) {
      logger.error('Failed to list users', { error: err.message });
      res.status(500).json({ error: 'Failed to list users' });
    }
  });

  // POST /api/users — create user (admin only)
  router.post('/', async (req: Request, res: Response) => {
    const actor = requireAdmin(req, res);
    if (!actor) return;

    try {
      const { username, password, role: roleInput } = req.body as {
        username?: string;
        password?: string;
        role?: string;
      };

      if (!username || !password) {
        res.status(400).json({ error: 'Username and password required' });
        return;
      }
      if (!/^[a-zA-Z0-9_-]{3,30}$/.test(username)) {
        res.status(400).json({ error: 'Username must be 3-30 characters (letters, numbers, _, -)' });
        return;
      }

      const role: UserRole = roleInput === 'admin' ? 'admin' : roleInput === undefined ? 'user' : 'user';
      if (roleInput !== undefined && roleInput !== 'admin' && roleInput !== 'user') {
        res.status(400).json({ error: 'Invalid role' });
        return;
      }

      const pwCheck = isStrongPassword(password);
      if (!pwCheck.valid) {
        res.status(400).json({ error: pwCheck.reason });
        return;
      }

      const db = getDb();
      const existing = await db
        .select({ id: webCredentials.id })
        .from(webCredentials)
        .where(eq(webCredentials.username, username))
        .limit(1);
      if (existing.length > 0) {
        res.status(409).json({ error: 'User exists' });
        return;
      }

      const passwordHash = await hashPassword(password);
      const [created] = await db
        .insert(webCredentials)
        .values({ username, passwordHash, role })
        .returning();

      await audit(actor.userId, 'web.user.created', { createdUsername: username, role }, 'web');
      res.status(201).json({ user: toSafeUser(created) });
    } catch (err: any) {
      logger.error('Failed to create user', { error: err.message });
      res.status(500).json({ error: 'Failed to create user' });
    }
  });

  // PUT /api/users/:id/role — update user role (admin only)
  router.put('/:id/role', async (req: Request, res: Response) => {
    const actor = requireAdmin(req, res);
    if (!actor) return;

    try {
      const role = (req.body?.role ?? '') as string;
      const targetId = req.params.id as string;
      if (role !== 'admin' && role !== 'user') {
        res.status(400).json({ error: 'Invalid role' });
        return;
      }

      const db = getDb();
      const [target] = await db.select().from(webCredentials).where(eq(webCredentials.id, targetId)).limit(1);
      if (!target) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      if (target.role === 'admin' && role !== 'admin') {
        const adminCount = await countAdmins();
        if (adminCount <= 1) {
          res.status(400).json({ error: 'Cannot demote the last admin' });
          return;
        }
      }

      await db
        .update(webCredentials)
        .set({ role })
        .where(eq(webCredentials.id, target.id));

      await audit(actor.userId, 'web.user.role_updated', {
        targetUsername: target.username,
        fromRole: target.role,
        toRole: role,
      }, 'web');

      res.json({
        success: true,
        user: toSafeUser({ ...target, role }),
      });
    } catch (err: any) {
      logger.error('Failed to update user role', { error: err.message });
      res.status(500).json({ error: 'Failed to update user role' });
    }
  });

  // PUT /api/users/:id/password — reset password (admin only)
  router.put('/:id/password', async (req: Request, res: Response) => {
    const actor = requireAdmin(req, res);
    if (!actor) return;

    try {
      const password = req.body?.password as string | undefined;
      const targetId = req.params.id as string;
      if (!password) {
        res.status(400).json({ error: 'Password required' });
        return;
      }

      const pwCheck = isStrongPassword(password);
      if (!pwCheck.valid) {
        res.status(400).json({ error: pwCheck.reason });
        return;
      }

      const db = getDb();
      const [target] = await db.select().from(webCredentials).where(eq(webCredentials.id, targetId)).limit(1);
      if (!target) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const passwordHash = await hashPassword(password);
      await db
        .update(webCredentials)
        .set({ passwordHash })
        .where(eq(webCredentials.id, target.id));

      await audit(actor.userId, 'web.user.password_reset', { targetUsername: target.username }, 'web');
      res.json({ success: true });
    } catch (err: any) {
      logger.error('Failed to reset password', { error: err.message });
      res.status(500).json({ error: 'Failed to reset password' });
    }
  });

  // DELETE /api/users/:id — delete user (admin only)
  router.delete('/:id', async (req: Request, res: Response) => {
    const actor = requireAdmin(req, res);
    if (!actor) return;

    try {
      const targetId = req.params.id as string;
      const db = getDb();
      const [target] = await db.select().from(webCredentials).where(eq(webCredentials.id, targetId)).limit(1);
      if (!target) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      if (target.username === actor.userId) {
        res.status(400).json({ error: 'Cannot delete your own account' });
        return;
      }

      if (target.role === 'admin') {
        const adminCount = await countAdmins();
        if (adminCount <= 1) {
          res.status(400).json({ error: 'Cannot delete the last admin' });
          return;
        }
      }

      await db.delete(webCredentials).where(eq(webCredentials.id, target.id));
      await audit(actor.userId, 'web.user.deleted', { targetUsername: target.username }, 'web');
      res.json({ success: true });
    } catch (err: any) {
      logger.error('Failed to delete user', { error: err.message });
      res.status(500).json({ error: 'Failed to delete user' });
    }
  });

  return router;
}
