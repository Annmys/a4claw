import { Router, Request, Response } from 'express';
import { desc, eq, sql } from 'drizzle-orm';
import { hashPassword } from '../../../security/auth.js';
import { audit } from '../../../security/audit-log.js';
import { getDb } from '../../../memory/database.js';
import { webCredentials } from '../../../memory/schema.js';
import { findOrCreateUser } from '../../../memory/repositories/users.js';
import {
  CommandCenterBindingError,
  listCommandCenterOrgOptions,
  listCommandCenterUserBindings,
  removeCommandCenterUserBinding,
  upsertCommandCenterUserBinding,
} from '../../../memory/repositories/command-center.js';
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

async function resolveOwnerUserId(jwtUserId: string): Promise<string> {
  const user = await findOrCreateUser(jwtUserId, 'web', jwtUserId);
  return user.masterUserId ?? user.id;
}

function toSafeUser(user: {
  id: string;
  username: string;
  role: string;
  lastLogin: Date | null;
  createdAt: Date;
}, binding: {
  id: string;
  memberId: string;
  memberName: string;
  centerId: string;
  centerName: string;
  departmentId: string | null;
  departmentName: string | null;
  title: string | null;
  status: string;
  isPrimary: boolean;
  updatedAt: Date;
} | null = null) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt,
    binding,
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

  router.get('/org-options', async (req: Request, res: Response) => {
    const actor = requireAdmin(req, res);
    if (!actor) return;

    try {
      const ownerUserId = await resolveOwnerUserId(actor.userId);
      const options = await listCommandCenterOrgOptions(ownerUserId);
      res.json(options);
    } catch (err: any) {
      logger.error('Failed to load user org options', { error: err.message });
      res.status(500).json({ error: 'Failed to load org options' });
    }
  });

  router.get('/', async (req: Request, res: Response) => {
    const actor = requireAdmin(req, res);
    if (!actor) return;

    try {
      const db = getDb();
      const ownerUserId = await resolveOwnerUserId(actor.userId);
      const [users, bindings] = await Promise.all([
        db.select().from(webCredentials).orderBy(desc(webCredentials.createdAt)),
        listCommandCenterUserBindings(ownerUserId),
      ]);
      const bindingMap = new Map(bindings.map((binding) => [binding.webCredentialId, {
        id: binding.id,
        memberId: binding.memberId,
        memberName: binding.memberName,
        centerId: binding.centerId,
        centerName: binding.centerName,
        departmentId: binding.departmentId,
        departmentName: binding.departmentName,
        title: binding.title ?? binding.memberRoleTitle ?? null,
        status: binding.status,
        isPrimary: binding.isPrimary,
        updatedAt: binding.updatedAt,
      }]));
      res.json({ users: users.map((user) => toSafeUser(user, bindingMap.get(user.id) ?? null)) });
    } catch (err: any) {
      logger.error('Failed to list users', { error: err.message });
      res.status(500).json({ error: 'Failed to list users' });
    }
  });

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

  router.put('/:id/binding', async (req: Request, res: Response) => {
    const actor = requireAdmin(req, res);
    if (!actor) return;

    try {
      const targetId = req.params.id as string;
      const memberId = typeof req.body?.memberId === 'string' ? req.body.memberId.trim() : '';
      const title = typeof req.body?.title === 'string' ? req.body.title.trim() : undefined;
      const db = getDb();
      const [target] = await db.select().from(webCredentials).where(eq(webCredentials.id, targetId)).limit(1);
      if (!target) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const ownerUserId = await resolveOwnerUserId(actor.userId);

      if (!memberId) {
        await removeCommandCenterUserBinding(ownerUserId, target.id);
        await audit(actor.userId, 'web.user.binding_cleared', { targetUsername: target.username }, 'web');
      } else {
        await upsertCommandCenterUserBinding(ownerUserId, {
          webCredentialId: target.id,
          memberId,
          title,
          metadata: {
            boundBy: actor.userId,
          },
        });
        await audit(actor.userId, 'web.user.bound_to_member', {
          targetUsername: target.username,
          memberId,
        }, 'web');
      }

      const [binding] = await listCommandCenterUserBindings(ownerUserId)
        .then((items) => items.filter((item) => item.webCredentialId === target.id).slice(0, 1));

      res.json({
        success: true,
        user: toSafeUser(target, binding ? {
          id: binding.id,
          memberId: binding.memberId,
          memberName: binding.memberName,
          centerId: binding.centerId,
          centerName: binding.centerName,
          departmentId: binding.departmentId,
          departmentName: binding.departmentName,
          title: binding.title ?? binding.memberRoleTitle ?? null,
          status: binding.status,
          isPrimary: binding.isPrimary,
          updatedAt: binding.updatedAt,
        } : null),
      });
    } catch (err: any) {
      if (err instanceof CommandCenterBindingError) {
        const status = err.code === 'member_already_bound' ? 409 : 404;
        res.status(status).json({ error: err.message });
        return;
      }
      logger.error('Failed to update user binding', { error: err.message });
      res.status(500).json({ error: 'Failed to update user binding' });
    }
  });

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
