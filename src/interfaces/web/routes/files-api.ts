import { Router, Request, Response } from 'express';
import { existsSync } from 'fs';
import { resolve } from 'path';
import {
  getSharedOutputRoot,
  resolveUserShareDir,
  toUserShareKey,
} from '../../../core/shared-artifacts.js';
import logger from '../../../utils/logger.js';

function isPathInside(parent: string, child: string): boolean {
  const normalizedParent = parent.endsWith('/') ? parent : `${parent}/`;
  return child === parent || child.startsWith(normalizedParent);
}

export function setupFilesRoutes(): Router {
  const router = Router();

  // GET /api/files/:userKey/:fileName
  // Download a generated file from /data/gongxiang/<user>/... (auth required).
  router.get('/:userKey/:fileName', async (req: Request, res: Response) => {
    try {
      const user = (req as any).user as { userId: string; role: 'admin' | 'user' };
      const requestedUserKey = toUserShareKey(String(req.params.userKey ?? ''));
      const requesterKey = toUserShareKey(user.userId);

      if (user.role !== 'admin' && requestedUserKey !== requesterKey) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const rawFileName = String(req.params.fileName ?? '').trim();
      if (!rawFileName || rawFileName.includes('/') || rawFileName.includes('\\')) {
        res.status(400).json({ error: 'Invalid file name' });
        return;
      }

      const userDir = resolveUserShareDir(requestedUserKey);
      const rootDir = resolve(getSharedOutputRoot());
      const target = resolve(userDir, rawFileName);

      if (!isPathInside(rootDir, target) || !isPathInside(userDir, target)) {
        res.status(400).json({ error: 'Invalid path' });
        return;
      }

      if (!existsSync(target)) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(rawFileName)}`);
      res.sendFile(target);
    } catch (err: any) {
      logger.error('File download route error', { error: err.message });
      res.status(500).json({ error: 'Failed to download file', details: err.message });
    }
  });

  return router;
}
