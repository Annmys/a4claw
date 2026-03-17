import { eq, desc, sql } from 'drizzle-orm';
import { getDb } from '../database.js';
import { auditLog } from '../schema.js';

export async function logAction(userId: string | null, action: string, resource?: string, details?: Record<string, unknown>, platform?: string) {
  const db = getDb();
  await db.insert(auditLog).values({ userId, action, resource, details, platform });
}

export async function getAuditLog(userId: string, limit = 50) {
  const db = getDb();
  return db.select().from(auditLog).where(eq(auditLog.userId, userId)).orderBy(desc(auditLog.createdAt)).limit(limit);
}

export async function getTaskExecutorAuditTrailForPrincipal(principal: string, limit = 50) {
  const db = getDb();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(principal);

  const result = isUuid
    ? await db.execute(sql`
        SELECT id, user_id, action, resource, details, ip, platform, created_at
        FROM audit_log
        WHERE action LIKE 'task_executor.%'
          AND (user_id = ${principal}::uuid OR details->>'originalUserId' = ${principal})
        ORDER BY created_at DESC
        LIMIT ${limit}
      `)
    : await db.execute(sql`
        SELECT id, user_id, action, resource, details, ip, platform, created_at
        FROM audit_log
        WHERE action LIKE 'task_executor.%'
          AND details->>'originalUserId' = ${principal}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `);

  return (result.rows as any[]).map((row) => ({
    id: row.id as string,
    userId: row.user_id as string | null,
    action: row.action as string,
    resource: row.resource as string | null,
    details: (row.details ?? {}) as Record<string, unknown>,
    ip: row.ip as string | null,
    platform: row.platform as string | null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }));
}
