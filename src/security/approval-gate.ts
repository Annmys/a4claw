import { and, eq, sql, desc } from 'drizzle-orm';
import { getDb } from '../memory/database.js';
import { approvalGates, approvalRequests, type ApprovalGateType, type ApprovalRequestStatus } from '../memory/schema.js';
import { audit } from './audit-log.js';
import logger from '../utils/logger.js';

export interface ApprovalGateConfig {
  id?: string;
  name: string;
  gateType: ApprovalGateType;
  description: string;
  approverMemberIds: string[];  // 有权审批的员工ID列表
  autoApproveConditions?: {
    maxCost?: number;           // 低于此金额自动通过
    trustedSkills?: string[];   // 信任的技能白名单
    maxDuration?: number;       // 预计执行时间低于此自动通过
  };
  requireAllApprovers: boolean; // true=需要所有人审批, false=任一审批即可
  timeoutHours: number;         // 审批超时时间
  enabled: boolean;
  centerId?: string;            // 所属中心（为空则全局生效）
}

export interface ApprovalRequest {
  id?: string;
  gateId: string;
  taskId: string;
  requesterId: string;
  requesterMemberId?: string;
  payload: {
    action: string;
    details: Record<string, unknown>;
    estimatedCost?: number;
    estimatedDuration?: number;
    skills?: string[];
  };
  status: ApprovalRequestStatus;
  decisions: Array<{
    approverId: string;
    decision: 'approved' | 'rejected';
    comment?: string;
    decidedAt: string;
  }>;
  requestedAt: string;
  decidedAt?: string;
  expiresAt: string;
}

// 创建审批闸门
export async function createApprovalGate(config: ApprovalGateConfig): Promise<string> {
  const db = getDb();
  const id = crypto.randomUUID();
  
  await db.insert(approvalGates).values({
    id,
    name: config.name,
    gateType: config.gateType,
    description: config.description,
    approverMemberIds: JSON.stringify(config.approverMemberIds),
    autoApproveConditions: config.autoApproveConditions ? JSON.stringify(config.autoApproveConditions) : null,
    requireAllApprovers: config.requireAllApprovers ? 1 : 0,
    timeoutHours: config.timeoutHours,
    enabled: config.enabled ? 1 : 0,
    centerId: config.centerId || null,
    createdAt: sql`CURRENT_TIMESTAMP`,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  });

  await audit(null, 'approval_gate.created', { gateId: id, name: config.name });
  logger.info('Approval gate created', { id, name: config.name });
  
  return id;
}

// 更新审批闸门
export async function updateApprovalGate(gateId: string, updates: Partial<ApprovalGateConfig>): Promise<void> {
  const db = getDb();
  
  await db.update(approvalGates).set({
    ...(updates.name && { name: updates.name }),
    ...(updates.description && { description: updates.description }),
    ...(updates.approverMemberIds && { approverMemberIds: JSON.stringify(updates.approverMemberIds) }),
    ...(updates.autoApproveConditions && { autoApproveConditions: JSON.stringify(updates.autoApproveConditions) }),
    ...(typeof updates.requireAllApprovers === 'boolean' && { requireAllApprovers: updates.requireAllApprovers ? 1 : 0 }),
    ...(updates.timeoutHours && { timeoutHours: updates.timeoutHours }),
    ...(typeof updates.enabled === 'boolean' && { enabled: updates.enabled ? 1 : 0 }),
    updatedAt: sql`CURRENT_TIMESTAMP`,
  }).where(eq(approvalGates.id, gateId));

  await audit(null, 'approval_gate.updated', { gateId, updates });
}

// 删除审批闸门
export async function deleteApprovalGate(gateId: string): Promise<void> {
  const db = getDb();
  await db.delete(approvalGates).where(eq(approvalGates.id, gateId));
  await audit(null, 'approval_gate.deleted', { gateId });
}

// 获取闸门列表
export async function listApprovalGates(centerId?: string): Promise<ApprovalGateConfig[]> {
  const db = getDb();
  
  const query = centerId 
    ? db.select().from(approvalGates).where(eq(approvalGates.centerId, centerId))
    : db.select().from(approvalGates);
  
  const rows = await query.orderBy(desc(approvalGates.createdAt));
  
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    gateType: row.gateType as ApprovalGateType,
    description: row.description || '',
    approverMemberIds: JSON.parse(row.approverMemberIds as string),
    autoApproveConditions: row.autoApproveConditions ? JSON.parse(row.autoApproveConditions as string) : undefined,
    requireAllApprovers: row.requireAllApprovers === 1,
    timeoutHours: row.timeoutHours,
    enabled: row.enabled === 1,
    centerId: row.centerId || undefined,
  }));
}

// 检查是否需要审批
export async function checkNeedsApproval(
  gateType: ApprovalGateType,
  payload: ApprovalRequest['payload'],
  centerId?: string
): Promise<{ needsApproval: boolean; matchingGates: ApprovalGateConfig[] }> {
  const db = getDb();
  
  // 查找匹配的闸门
  let query = db.select().from(approvalGates)
    .where(and(
      eq(approvalGates.gateType, gateType),
      eq(approvalGates.enabled, 1)
    ));
  
  if (centerId) {
    query = db.select().from(approvalGates)
      .where(and(
        eq(approvalGates.gateType, gateType),
        eq(approvalGates.enabled, 1),
        eq(approvalGates.centerId, centerId)
      ));
  }
  
  const gates = await query;
  
  if (gates.length === 0) {
    return { needsApproval: false, matchingGates: [] };
  }

  // 转换为配置对象
  const matchingGates: ApprovalGateConfig[] = gates.map(row => ({
    id: row.id,
    name: row.name,
    gateType: row.gateType as ApprovalGateType,
    description: row.description || '',
    approverMemberIds: JSON.parse(row.approverMemberIds as string),
    autoApproveConditions: row.autoApproveConditions ? JSON.parse(row.autoApproveConditions as string) : undefined,
    requireAllApprovers: row.requireAllApprovers === 1,
    timeoutHours: row.timeoutHours,
    enabled: row.enabled === 1,
    centerId: row.centerId || undefined,
  }));

  // 检查自动审批条件
  for (const gate of matchingGates) {
    if (gate.autoApproveConditions && checkAutoApprove(gate.autoApproveConditions, payload)) {
      return { needsApproval: false, matchingGates: [gate] };
    }
  }

  return { needsApproval: true, matchingGates };
}

// 检查自动审批条件
function checkAutoApprove(
  conditions: NonNullable<ApprovalGateConfig['autoApproveConditions']>,
  payload: ApprovalRequest['payload']
): boolean {
  // 成本检查
  if (conditions.maxCost !== undefined && payload.estimatedCost !== undefined) {
    if (payload.estimatedCost > conditions.maxCost) return false;
  }

  // 时长检查
  if (conditions.maxDuration !== undefined && payload.estimatedDuration !== undefined) {
    if (payload.estimatedDuration > conditions.maxDuration) return false;
  }

  // 技能白名单检查
  if (conditions.trustedSkills && payload.skills) {
    const hasUntrustedSkill = payload.skills.some(skill => 
      !conditions.trustedSkills!.includes(skill)
    );
    if (hasUntrustedSkill) return false;
  }

  return true;
}

// 创建审批请求
export async function createApprovalRequest(
  request: Omit<ApprovalRequest, 'id' | 'status' | 'requestedAt' | 'expiresAt' | 'timeoutHours'>,
  timeoutHours: number = 24
): Promise<string> {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + timeoutHours * 60 * 60 * 1000);
  
  await db.insert(approvalRequests).values({
    id,
    gateId: request.gateId,
    taskId: request.taskId,
    requesterId: request.requesterId,
    requesterMemberId: request.requesterMemberId || null,
    payload: request.payload,
    status: 'pending',
    decisions: [],
    requestedAt: now,
    expiresAt: expiresAt,
  });

  await audit(request.requesterId, 'approval_request.created', { 
    requestId: id, 
    gateId: request.gateId,
    taskId: request.taskId 
  });

  logger.info('Approval request created', { id, gateId: request.gateId, taskId: request.taskId });
  
  return id;
}

// 审批决策
export async function makeApprovalDecision(
  requestId: string,
  approverId: string,
  decision: 'approved' | 'rejected',
  comment?: string
): Promise<void> {
  const db = getDb();
  
  // 获取请求
  const [request] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId));
  if (!request) {
    throw new Error('Approval request not found');
  }

  if (request.status !== 'pending') {
    throw new Error(`Request already ${request.status}`);
  }

  // 检查是否已过期
  if (new Date() > new Date(request.expiresAt)) {
    await db.update(approvalRequests)
      .set({ status: 'expired' })
      .where(eq(approvalRequests.id, requestId));
    throw new Error('Request has expired');
  }

  // 获取闸门配置
  const [gate] = await db.select().from(approvalGates).where(eq(approvalGates.id, request.gateId));
  if (!gate) {
    throw new Error('Approval gate not found');
  }

  // 检查审批人权限
  const approverIds: string[] = JSON.parse(gate.approverMemberIds as string);
  if (!approverIds.includes(approverId)) {
    throw new Error('Approver not authorized for this gate');
  }

  // 更新决策
  const decisions: ApprovalRequest['decisions'] = JSON.parse(request.decisions as string);
  decisions.push({
    approverId,
    decision,
    comment,
    decidedAt: new Date().toISOString(),
  });

  // 检查是否满足审批条件
  let newStatus: ApprovalRequestStatus = 'pending';
  
  if (decision === 'rejected') {
    newStatus = 'rejected';
  } else {
    const requireAll = gate.requireAllApprovers === 1;
    if (requireAll) {
      // 需要所有人审批
      const approvedCount = decisions.filter(d => d.decision === 'approved').length;
      if (approvedCount >= approverIds.length) {
        newStatus = 'approved';
      }
    } else {
      // 任一审批人通过即可
      newStatus = 'approved';
    }
  }

  await db.update(approvalRequests).set({
    decisions,
    status: newStatus,
    decidedAt: newStatus !== 'pending' ? new Date() : null,
  }).where(eq(approvalRequests.id, requestId));

  await audit(approverId, 'approval_request.decided', { 
    requestId, 
    decision,
    newStatus 
  });

  logger.info('Approval decision recorded', { requestId, approverId, decision, newStatus });
}

// 获取待审批列表
export async function getPendingApprovals(approverId: string): Promise<ApprovalRequest[]> {
  const db = getDb();
  
  const rows = await db.select().from(approvalRequests)
    .where(eq(approvalRequests.status, 'pending'))
    .orderBy(desc(approvalRequests.requestedAt));

  return rows.map(row => ({
    id: row.id,
    gateId: row.gateId,
    taskId: row.taskId,
    requesterId: row.requesterId,
    requesterMemberId: row.requesterMemberId || undefined,
    payload: JSON.parse(row.payload as string),
    status: row.status as ApprovalRequestStatus,
    decisions: JSON.parse(row.decisions as string),
    requestedAt: new Date(row.requestedAt).toISOString(),
    decidedAt: row.decidedAt ? new Date(row.decidedAt).toISOString() : undefined,
    expiresAt: new Date(row.expiresAt).toISOString(),
  }));
}

// 获取审批请求详情
export async function getApprovalRequest(requestId: string): Promise<ApprovalRequest | null> {
  const db = getDb();
  
  const [row] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId));
  if (!row) return null;

  return {
    id: row.id,
    gateId: row.gateId,
    taskId: row.taskId,
    requesterId: row.requesterId,
    requesterMemberId: row.requesterMemberId || undefined,
    payload: JSON.parse(row.payload as string),
    status: row.status as ApprovalRequestStatus,
    decisions: JSON.parse(row.decisions as string),
    requestedAt: new Date(row.requestedAt).toISOString(),
    decidedAt: row.decidedAt ? new Date(row.decidedAt).toISOString() : undefined,
    expiresAt: new Date(row.expiresAt).toISOString(),
  };
}
