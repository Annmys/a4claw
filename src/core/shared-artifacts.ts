import { randomUUID } from 'crypto';
import { basename, extname, join, resolve } from 'path';
import { copyFile, mkdir, stat } from 'fs/promises';
import config from '../config.js';
import logger from '../utils/logger.js';

export interface ChatArtifact {
  id: string;
  name: string;
  originalName: string;
  mime: string;
  size: number;
  path: string;
  url: string;
  userKey: string;
  createdAt: string;
}

const SHARED_OUTPUT_ROOT = resolve(process.env.SHARED_OUTPUT_ROOT || '/data/gongxiang');

function sanitizeSegment(input: string): string {
  const safe = input
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return safe || 'user';
}

function sanitizeFileName(input: string): string {
  const base = basename(input || 'output.bin');
  const safe = base
    .replace(/[^\w.\-() \[\]]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return safe || 'output.bin';
}

function guessMime(fileName: string): string {
  const ext = extname(fileName).toLowerCase();
  const map: Record<string, string> = {
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.ts': 'text/plain',
    '.js': 'text/plain',
    '.py': 'text/plain',
    '.html': 'text/html',
  };
  return map[ext] ?? 'application/octet-stream';
}

export function toUserShareKey(userId: string): string {
  return sanitizeSegment(userId);
}

export function resolveUserShareDir(userKey: string): string {
  return resolve(SHARED_OUTPUT_ROOT, sanitizeSegment(userKey));
}

export async function ensureUserShareDir(userId: string): Promise<{ userKey: string; dir: string }> {
  const userKey = toUserShareKey(userId);
  const dir = resolveUserShareDir(userKey);
  await mkdir(dir, { recursive: true });
  return { userKey, dir };
}

export function getSharedOutputRoot(): string {
  return SHARED_OUTPUT_ROOT;
}

/**
 * Copy a generated file into /data/gongxiang/<user>/ and return metadata
 * that can be rendered in chat and downloaded via authenticated API.
 */
export async function publishFileToUserShare(
  sourcePath: string,
  userId: string,
  preferredName?: string,
): Promise<ChatArtifact> {
  const src = resolve(sourcePath);
  const srcStat = await stat(src);
  if (!srcStat.isFile()) throw new Error(`Not a file: ${src}`);

  const { userKey, dir } = await ensureUserShareDir(userId);
  const cleanName = sanitizeFileName(preferredName ?? basename(src));
  const stampedName = `${Date.now()}-${cleanName}`;
  const dst = join(dir, stampedName);

  await copyFile(src, dst);
  const dstStat = await stat(dst);

  const artifact: ChatArtifact = {
    id: randomUUID(),
    name: stampedName,
    originalName: cleanName,
    mime: guessMime(stampedName),
    size: dstStat.size,
    path: dst,
    url: `/api/files/${encodeURIComponent(userKey)}/${encodeURIComponent(stampedName)}`,
    userKey,
    createdAt: new Date().toISOString(),
  };

  logger.info('Published shared artifact', {
    userId,
    userKey,
    sourcePath: src,
    targetPath: dst,
    size: artifact.size,
    root: SHARED_OUTPUT_ROOT,
    bindHost: config.BIND_HOST,
    port: config.PORT,
  });

  return artifact;
}
