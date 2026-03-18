import { Router, Request, Response } from 'express';
import { audit } from '../../../security/audit-log.js';
import { findOrCreateUser } from '../../../memory/repositories/users.js';
import {
  createApprovalGate,
  updateApprovalGate,
  deleteApprovalGate,
  listApprovalGates,
  checkNeedsApproval,
  createApprovalRequest,
  makeApprovalDecision,
  getPendingApprovals,
  getApprovalRequest,
  type ApprovalGateConfig,
} from '../../../security/approval-gate.js';
import {
  appendCommandCenterTaskEvent,
  COMMAND_CENTER_TASK_PRIORITIES,
  COMMAND_CENTER_TASK_RUN_STATUSES,
  COMMAND_CENTER_SKILL_SCOPE_TYPES,
  COMMAND_CENTER_TASK_STATUSES,
  createCommandCenterCenter,
  createCommandCenterDepartment,
  createCommandCenterMember,
  createCommandCenterTask,
  createCommandCenterTaskRun,
  ensureCommandCenterSchema,
  getCommandCenterActorContext,
  getCommandCenterTaskById,
  getCommandCenterTaskDetail,
  listCommandCenterOverview,
  planCommandCenterTaskDispatch,
  removeCommandCenterSkillAssignment,
  type CommandCenterSkillScopeType,
  updateCommandCenterTaskStatus,
  updateCommandCenterTaskRunStatus,
  upsertCommandCenterSkillAssignment,
  type CommandCenterTaskPriority,
  type CommandCenterTaskRunStatus,
  type CommandCenterTaskStatus,
} from '../../../memory/repositories/command-center.js';
import { findWebCredentialByUsername } from '../../../memory/repositories/web-credentials.js';
import { executeTaskRun } from '../../../memory/repositories/task-executor.js';
import { getEngine } from '../../../core/engine-lifecycle.js';
import logger from '../../../utils/logger.js';

async function resolveOwnerUserId(jwtUserId: string): Promise<string> {
  const user = await findOrCreateUser(jwtUserId, 'web', jwtUserId);
  return user.masterUserId ?? user.id;
}

function badRequest(res: Response, error: string): Response {
  return res.status(400).json({ error });
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function parseDueAt(input: unknown): Date | null | undefined {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input !== 'string') return undefined;
  const value = new Date(input);
  return Number.isNaN(value.getTime()) ? undefined : value;
}

export function setupCommandCenterRoutes(): Router {
  const router = Router();
  let readyPromise: Promise<void> | null = null;

  router.use(async (_req, res, next) => {
    try {
      readyPromise ??= ensureCommandCenterSchema();
      await readyPromise;
      next();
    } catch (err: any) {
      logger.error('Failed to initialize command center schema', { error: err.message });
      res.status(500).json({ error: 'Command center database initialization failed' });
    }
  });

  router.get('/overview', async (req: Request, res: Response) => {
    try {
      const actor = (req as any).user as { userId: string };
      const ownerUserId = await resolveOwnerUserId(actor.userId);
      const credential = await findWebCredentialByUsername(actor.userId);
      const overview = await listCommandCenterOverview(ownerUserId, credential?.id);
      res.json(overview);
    } catch (err: any) {
      logger.error('Failed to load command center overview', { error: err.message });
      res.status(500).json({ error: 'Failed to load command center overview' });
    }
  });

  router.post('/centers', async (req: Request, res: Response) => {
    try {
      const actor = (req as any).user as { userId: string };
      const ownerUserId = await resolveOwnerUserId(actor.userId);
      const name = optionalString(req.body?.name, 120);
      if (!name) return badRequest(res, 'Center name required');

      const center = await createCommandCenterCenter(ownerUserId, {
        name,
        code: optionalString(req.body?.code, 60),
        description: optionalString(req.body?.description, 1000),
      });

      await audit(actor.userId, 'command_center.center_created', { centerId: center.id, name: center.name }, 'web');
      res.status(201).json({ center });
    } catch (err: any) {
      logger.error('Failed to create command center center', { error: err.message });
      res.status(500).json({ error: 'Failed to create center' });
    }
  });

  router.post('/departments', async (req: Request, res: Response) => {
    try {
      const actor = (req as any).user as { userId: string };
      const ownerUserId = await resolveOwnerUserId(actor.userId);
      const centerId = optionalString(req.body?.centerId, 80);
      const name = optionalString(req.body?.name, 120);
      if (!centerId) return badRequest(res, 'centerId required');
      if (!name) return badRequest(res, 'Department name required');

      const department = await createCommandCenterDepartment(ownerUserId, {
        centerId,
        name,
        code: optionalString(req.body?.code, 60),
        description: optionalString(req.body?.description, 1000),
      });

      await audit(actor.userId, 'command_center.department_created', { departmentId: department.id, centerId, name }, 'web');
      res.status(201).json({ department });
    } catch (err: any) {
      logger.error('Failed to create department', { error: err.message });
      res.status(500).json({ error: 'Failed to create department' });
    }
  });

  router.post('/members', async (req: Request, res: Response) => {
    try {
      const actor = (req as any).user as { userId: string };
      const ownerUserId = await resolveOwnerUserId(actor.userId);
      const centerId = optionalString(req.body?.centerId, 80);
      const displayName = optionalString(req.body?.displayName, 120);
      if (!centerId) return badRequest(res, 'centerId required');
      if (!displayName) return badRequest(res, 'displayName required');

      const member = await createCommandCenterMember(ownerUserId, {
        centerId,
        departmentId: optionalString(req.body?.departmentId, 80) ?? null,
        displayName,
        employeeCode: optionalString(req.body?.employeeCode, 60),
        roleTitle: optionalString(req.body?.roleTitle, 120),
      });

      await audit(actor.userId, 'command_center.member_created', { memberId: member.id, centerId, displayName }, 'web');
      res.status(201).json({ member });
    } catch (err: any) {
      logger.error('Failed to create member', { error: err.message });
      res.status(500).json({ error: 'Failed to create member' });
    }
  });

  router.post('/skill-assignments', async (req: Request, res: Response) => {
    try {
      const actor = (req as any).user as { userId: string };
      const ownerUserId = await resolveOwnerUserId(actor.userId);
      const skillId = optionalString(req.body?.skillId, 160);
      const scopeType = optionalString(req.body?.scopeType, 30) as CommandCenterSkillScopeType | undefined;
      const scopeId = optionalString(req.body?.scopeId, 80);
      if (!skillId) return badRequest(res, 'skillId required');
      if (!scopeType || !COMMAND_CENTER_SKILL_SCOPE_TYPES.includes(scopeType)) return badRequest(res, 'Invalid scopeType');
      if (!scopeId) return badRequest(res, 'scopeId required');

      const proficiency = Number.isFinite(Number(req.body?.proficiency)) ? Number(req.body.proficiency) : undefined;
      const priority = Number.isFinite(Number(req.body?.priority)) ? Number(req.body.priority) : undefined;

      const assignment = await upsertCommandCenterSkillAssignment(ownerUserId, {
        skillId,
        scopeType,
        scopeId,
        proficiency,
        priority,
        isPrimary: Boolean(req.body?.isPrimary),
        metadata: { assignedBy: actor.userId },
      });

      await audit(actor.userId, 'command_center.skill_assignment_upserted', {
        assignmentId: assignment.id,
        skillId,
        scopeType,
        scopeId,
      }, 'web');
      res.status(201).json({ assignment });
    } catch (err: any) {
      logger.error('Failed to upsert skill assignment', { error: err.message });
      res.status(500).json({ error: err.message ?? 'Failed to save skill assignment' });
    }
  });

  router.delete('/skill-assignments/:id', async (req: Request, res: Response) => {
    try {
      const actor = (req as any).user as { userId: string };
      const ownerUserId = await resolveOwnerUserId(actor.userId);
      const assignmentId = optionalString(req.params.id, 80);
      if (!assignmentId) return badRequest(res, 'Invalid assignment id');

      const assignment = await removeCommandCenterSkillAssignment(ownerUserId, assignmentId);
      if (!assignment) {
        res.status(404).json({ error: 'Skill assignment not found' });
        return;
      }

      await audit(actor.userId, 'command_center.skill_assignment_deleted', {
        assignmentId,
        skillId: assignment.skillId,
      }, 'web');
      res.json({ success: true });
    } catch (err: any) {
      logger.error('Failed to delete skill assignment', { error: err.message });
      res.status(500).json({ error: 'Failed to delete skill assignment' });
    }
  });

  router.get('/tasks/:id', async (req: Request, res: Response) => {
    try {
      const actor = (req as any).user as { userId: string };
      const ownerUserId = await resolveOwnerUserId(actor.userId);
      const taskId = optionalString(req.params.id, 80);
      if (!taskId) return badRequest(res, 'Invalid task id');
      const detail = await getCommandCenterTaskDetail(ownerUserId, taskId);
      if (!detail) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }
      res.json(detail);
    } catch (err: any) {
      logger.error('Failed to load command center task detail', { error: err.message });
      res.status(500).json({ error: 'Failed to load task detail' });
    }
  });

  router.post('/tasks', async (req: Request, res: Response) => {
    try {
      const actor = (req as any).user as { userId: string };
      const ownerUserId = await resolveOwnerUserId(actor.userId);
      const credential = await findWebCredentialByUsername(actor.userId);
      const actorContext = credential ? await getCommandCenterActorContext(ownerUserId, credential.id) : { binding: null, skillAssignments: [] };
      const centerId = optionalString(req.body?.centerId, 80) ?? actorContext.binding?.centerId ?? undefined;
      const title = optionalString(req.body?.title, 200);
      if (!centerId) return badRequest(res, 'centerId required');
      if (!title) return badRequest(res, 'Task title required');

      const statusInput = optionalString(req.body?.status, 30) as CommandCenterTaskStatus | undefined;
      if (statusInput && !COMMAND_CENTER_TASK_STATUSES.includes(statusInput)) {
        return badRequest(res, 'Invalid status');
      }

      const priorityInput = optionalString(req.body?.priority, 20) as CommandCenterTaskPriority | undefined;
      if (priorityInput && !COMMAND_CENTER_TASK_PRIORITIES.includes(priorityInput)) {
        return badRequest(res, 'Invalid priority');
      }

      const dueAt = parseDueAt(req.body?.dueAt);
      if (dueAt === undefined) return badRequest(res, 'Invalid dueAt');

      const tags = Array.isArray(req.body?.tags)
        ? req.body.tags.filter((item: unknown): item is string => typeof item === 'string').map((item: string) => item.trim()).filter(Boolean).slice(0, 20)
        : [];

      const task = await createCommandCenterTask(ownerUserId, actor.userId, {
        centerId,
        departmentId: optionalString(req.body?.departmentId, 80) ?? actorContext.binding?.departmentId ?? null,
        assigneeMemberId: optionalString(req.body?.assigneeMemberId, 80) ?? actorContext.binding?.memberId ?? null,
        title,
        description: optionalString(req.body?.description, 4000),
        status: statusInput,
        priority: priorityInput,
        source: optionalString(req.body?.source, 40) ?? 'manual',
        requestedBy: optionalString(req.body?.requestedBy, 120) ?? actorContext.binding?.memberName ?? actor.userId,
        dueAt,
        tags,
        metadata: {
          actorWebUser: actor.userId,
          actorMemberId: actorContext.binding?.memberId ?? null,
          actorCenterId: actorContext.binding?.centerId ?? null,
          actorDepartmentId: actorContext.binding?.departmentId ?? null,
        },
      });

      await audit(actor.userId, 'command_center.task_created', { taskId: task.id, title: task.title, centerId }, 'web');
      res.status(201).json({ task });
    } catch (err: any) {
      logger.error('Failed to create command center task', { error: err.message });
      res.status(500).json({ error: 'Failed to create task' });
    }
  });

  router.post('/tasks/:id/status', async (req: Request, res: Response) => {
    try {
      const actor = (req as any).user as { userId: string };
      const ownerUserId = await resolveOwnerUserId(actor.userId);
      const taskId = optionalString(req.params.id, 80);
      if (!taskId) return badRequest(res, 'Invalid task id');
      const statusInput = optionalString(req.body?.status, 30) as CommandCenterTaskStatus | undefined;
      if (!statusInput || !COMMAND_CENTER_TASK_STATUSES.includes(statusInput)) {
        return badRequest(res, 'Invalid status');
      }

      const task = await updateCommandCenterTaskStatus(ownerUserId, taskId, {
        status: statusInput,
        actorId: actor.userId,
        note: optionalString(req.body?.note, 1000),
      });

      if (!task) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }

      await audit(actor.userId, 'command_center.task_status_updated', { taskId: task.id, status: task.status }, 'web');
      res.json({ task });
    } catch (err: any) {
      logger.error('Failed to update command center task status', { error: err.message });
      res.status(500).json({ error: 'Failed to update task status' });
    }
  });

  router.post('/tasks/:id/events', async (req: Request, res: Response) => {
    try {
      const actor = (req as any).user as { userId: string };
      const ownerUserId = await resolveOwnerUserId(actor.userId);
      const taskId = optionalString(req.params.id, 80);
      if (!taskId) return badRequest(res, 'Invalid task id');
      const task = await getCommandCenterTaskById(ownerUserId, taskId);
      if (!task) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }

      const content = optionalString(req.body?.content, 4000);
      if (!content) return badRequest(res, 'Event content required');

      const event = await appendCommandCenterTaskEvent(ownerUserId, {
        taskId: task.id,
        eventType: optionalString(req.body?.eventType, 40) ?? 'note',
        content,
        actorType: optionalString(req.body?.actorType, 30) ?? 'user',
        actorId: actor.userId,
      });

      await audit(actor.userId, 'command_center.task_event_created', { taskId: task.id, eventId: event.id }, 'web');
      res.status(201).json({ event });
    } catch (err: any) {
      logger.error('Failed to append command center task event', { error: err.message });
      res.status(500).json({ error: 'Failed to add task event' });
    }
  });

  router.post('/tasks/:id/runs', async (req: Request, res: Response) => {
    try {
      const actor = (req as any).user as { userId: string };
      const ownerUserId = await resolveOwnerUserId(actor.userId);
      const credential = await findWebCredentialByUsername(actor.userId);
      const actorContext = credential ? await getCommandCenterActorContext(ownerUserId, credential.id) : { binding: null, skillAssignments: [] };
      const taskId = optionalString(req.params.id, 80);
      if (!taskId) return badRequest(res, 'Invalid task id');

      const run = await createCommandCenterTaskRun(ownerUserId, actor.userId, {
        taskId,
        skillId: optionalString(req.body?.skillId, 160) ?? actorContext.skillAssignments[0]?.skillId ?? null,
        executorType: optionalString(req.body?.executorType, 30) ?? 'member',
        executorMemberId: optionalString(req.body?.executorMemberId, 80) ?? actorContext.binding?.memberId ?? null,
        inputSummary: optionalString(req.body?.inputSummary, 4000),
        metadata: {
          source: optionalString(req.body?.source, 60) ?? 'dashboard',
          actorWebUser: actor.userId,
          actorMemberId: actorContext.binding?.memberId ?? null,
        },
      });

      if (!run) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }

      await audit(actor.userId, 'command_center.task_run_created', {
        taskId,
        runId: run.id,
        skillId: run.skillId,
      }, 'web');
      res.status(201).json({ run });
    } catch (err: any) {
      logger.error('Failed to create task run', { error: err.message });
      res.status(500).json({ error: err.message ?? 'Failed to create task run' });
    }
  });

  router.post('/tasks/:id/auto-dispatch', async (req: Request, res: Response) => {
    try {
      const actor = (req as any).user as { userId: string };
      const ownerUserId = await resolveOwnerUserId(actor.userId);
      const credential = await findWebCredentialByUsername(actor.userId);
      const actorContext = credential ? await getCommandCenterActorContext(ownerUserId, credential.id) : { binding: null, skillAssignments: [] };
      const taskId = optionalString(req.params.id, 80);
      if (!taskId) return badRequest(res, 'Invalid task id');

      const plan = await planCommandCenterTaskDispatch(ownerUserId, taskId, {
        preferredMemberId: actorContext.binding?.memberId ?? null,
      });
      if (!plan) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }

      const run = await createCommandCenterTaskRun(ownerUserId, actor.userId, {
        taskId,
        skillId: plan.skillAssignment?.skillId ?? null,
        executorType: 'auto-dispatch',
        executorMemberId: plan.executorMember?.id ?? null,
        inputSummary: `自动分派执行：${plan.reason}`,
        metadata: {
          source: 'auto-dispatch',
          actorWebUser: actor.userId,
          actorMemberId: actorContext.binding?.memberId ?? null,
          autoDispatchReason: plan.reason,
        },
      });

      if (!run) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }

      await audit(actor.userId, 'command_center.task_auto_dispatched', {
        taskId,
        runId: run.id,
        executorMemberId: run.executorMemberId,
        skillId: run.skillId,
        reason: plan.reason,
      }, 'web');

      // Trigger actual execution asynchronously
      const engine = getEngine();
      executeTaskRun(ownerUserId, run.id, engine).catch((execErr) => {
        logger.error('Auto-dispatched task execution failed', {
          taskId,
          runId: run.id,
          error: execErr instanceof Error ? execErr.message : String(execErr),
        });
      });

      res.status(201).json({
        run,
        executionTriggered: true,
        recommendation: {
          reason: plan.reason,
          executorMember: plan.executorMember ? {
            id: plan.executorMember.id,
            displayName: plan.executorMember.displayName,
          } : null,
          skillAssignment: plan.skillAssignment ? {
            skillId: plan.skillAssignment.skillId,
            skillName: plan.skillAssignment.skillName,
            scopeType: plan.skillAssignment.scopeType,
          } : null,
        },
      });
    } catch (err: any) {
      logger.error('Failed to auto-dispatch task', { error: err.message });
      res.status(500).json({ error: err.message ?? 'Failed to auto-dispatch task' });
    }
  });

  router.post('/task-runs/:id/status', async (req: Request, res: Response) => {
    try {
      const actor = (req as any).user as { userId: string };
      const ownerUserId = await resolveOwnerUserId(actor.userId);
      const runId = optionalString(req.params.id, 80);
      const status = optionalString(req.body?.status, 30) as CommandCenterTaskRunStatus | undefined;
      if (!runId) return badRequest(res, 'Invalid run id');
      if (!status || !COMMAND_CENTER_TASK_RUN_STATUSES.includes(status)) return badRequest(res, 'Invalid run status');

      const artifacts = Array.isArray(req.body?.artifacts)
        ? req.body.artifacts.filter((item: unknown): item is Record<string, unknown> => Boolean(item && typeof item === 'object')).slice(0, 20)
        : undefined;

      const run = await updateCommandCenterTaskRunStatus(ownerUserId, runId, {
        status,
        actorId: actor.userId,
        outputSummary: optionalString(req.body?.outputSummary, 4000),
        artifacts,
        metadata: {
          updatedFrom: 'dashboard',
        },
      });

      if (!run) {
        res.status(404).json({ error: 'Task run not found' });
        return;
      }

      await audit(actor.userId, 'command_center.task_run_status_updated', {
        runId,
        status,
      }, 'web');
      res.json({ run });
    } catch (err: any) {
      logger.error('Failed to update task run status', { error: err.message });
      res.status(500).json({ error: err.message ?? 'Failed to update task run status' });
    }
  });

  // ============================================================================
  // Approval Gate APIs (Phase 2)
  // ============================================================================

  // List approval gates
  router.get('/approval-gates', async (req: Request, res: Response) => {
    try {
      const actor = (req as any).user as { userId: string };
      const centerId = optionalString(req.query.centerId, 80);
      const gates = await listApprovalGates(centerId);
      res.json({ gates });
    } catch (err: any) {
      logger.error('Failed to list approval gates', { error: err.message });
      res.status(500).json({ error: err.message ?? 'Failed to list approval gates' });
    }
  });

  // Create approval gate
  router.post('/approval-gates', async (req: Request, res: Response) => {
    try {
      const actor = (req as any).user as { userId: string };
      const config: ApprovalGateConfig = {
        name: req.body.name,
        gateType: req.body.gateType,
        description: req.body.description,
        approverMemberIds: req.body.approverMemberIds || [],
        autoApproveConditions: req.body.autoApproveConditions,
        requireAllApprovers: req.body.requireAllApprovers ?? false,
        timeoutHours: req.body.timeoutHours ?? 24,
        enabled: req.body.enabled ?? true,
        centerId: req.body.centerId,
      };

      if (!config.name || !config.gateType) {
        return badRequest(res, 'Missing required fields: name, gateType');
      }

      const gateId = await createApprovalGate(config);
      await audit(actor.userId, 'command_center.approval_gate_created', { gateId }, 'web');
      res.status(201).json({ id: gateId, ...config });
    } catch (err: any) {
      logger.error('Failed to create approval gate', { error: err.message });
      res.status(500).json({ error: err.message ?? 'Failed to create approval gate' });
    }
  });

  // Update approval gate
  router.patch('/approval-gates/:id', async (req: Request, res: Response) => {
    try {
      const actor = (req as any).user as { userId: string };
      const gateId = optionalString(req.params.id, 80);
      if (!gateId) return badRequest(res, 'Invalid gate id');

      const updates: Partial<ApprovalGateConfig> = {};
      if (req.body.name !== undefined) updates.name = req.body.name;
      if (req.body.description !== undefined) updates.description = req.body.description;
      if (req.body.approverMemberIds !== undefined) updates.approverMemberIds = req.body.approverMemberIds;
      if (req.body.autoApproveConditions !== undefined) updates.autoApproveConditions = req.body.autoApproveConditions;
      if (req.body.requireAllApprovers !== undefined) updates.requireAllApprovers = req.body.requireAllApprovers;
      if (req.body.timeoutHours !== undefined) updates.timeoutHours = req.body.timeoutHours;
      if (req.body.enabled !== undefined) updates.enabled = req.body.enabled;

      await updateApprovalGate(gateId, updates);
      await audit(actor.userId, 'command_center.approval_gate_updated', { gateId }, 'web');
      res.json({ success: true });
    } catch (err: any) {
      logger.error('Failed to update approval gate', { error: err.message });
      res.status(500).json({ error: err.message ?? 'Failed to update approval gate' });
    }
  });

  // Delete approval gate
  router.delete('/approval-gates/:id', async (req: Request, res: Response) => {
    try {
      const actor = (req as any).user as { userId: string };
      const gateId = optionalString(req.params.id, 80);
      if (!gateId) return badRequest(res, 'Invalid gate id');

      await deleteApprovalGate(gateId);
      await audit(actor.userId, 'command_center.approval_gate_deleted', { gateId }, 'web');
      res.status(204).send();
    } catch (err: any) {
      logger.error('Failed to delete approval gate', { error: err.message });
      res.status(500).json({ error: err.message ?? 'Failed to delete approval gate' });
    }
  });

  // Check if action needs approval
  router.post('/approval-gates/check', async (req: Request, res: Response) => {
    try {
      const gateType = req.body.gateType;
      const payload = req.body.payload;
      const centerId = req.body.centerId;

      if (!gateType) return badRequest(res, 'Missing gateType');

      const result = await checkNeedsApproval(gateType, payload, centerId);
      res.json(result);
    } catch (err: any) {
      logger.error('Failed to check approval requirement', { error: err.message });
      res.status(500).json({ error: err.message ?? 'Failed to check approval requirement' });
    }
  });

  // Get pending approvals for current user
  router.get('/approvals/pending', async (req: Request, res: Response) => {
    try {
      const actor = (req as any).user as { userId: string };
      const ownerUserId = await resolveOwnerUserId(actor.userId);
      const credential = await findWebCredentialByUsername(actor.userId);
      
      if (!credential) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Get user's member binding
      const { getCommandCenterActorContext } = await import('../../../memory/repositories/command-center.js');
      const context = await getCommandCenterActorContext(ownerUserId, credential.id);
      
      if (!context.binding) {
        return res.json({ requests: [] });
      }

      const requests = await getPendingApprovals(context.binding.memberId);
      res.json({ requests });
    } catch (err: any) {
      logger.error('Failed to get pending approvals', { error: err.message });
      res.status(500).json({ error: err.message ?? 'Failed to get pending approvals' });
    }
  });

  // Get approval request details
  router.get('/approvals/:id', async (req: Request, res: Response) => {
    try {
      const requestId = optionalString(req.params.id, 80);
      if (!requestId) return badRequest(res, 'Invalid request id');

      const request = await getApprovalRequest(requestId);
      if (!request) {
        return res.status(404).json({ error: 'Approval request not found' });
      }

      res.json({ request });
    } catch (err: any) {
      logger.error('Failed to get approval request', { error: err.message });
      res.status(500).json({ error: err.message ?? 'Failed to get approval request' });
    }
  });

  // Make approval decision
  router.post('/approvals/:id/decide', async (req: Request, res: Response) => {
    try {
      const actor = (req as any).user as { userId: string };
      const ownerUserId = await resolveOwnerUserId(actor.userId);
      const credential = await findWebCredentialByUsername(actor.userId);
      const requestId = optionalString(req.params.id, 80);
      
      if (!requestId) return badRequest(res, 'Invalid request id');
      if (!credential) return res.status(404).json({ error: 'User not found' });

      const { decision, comment } = req.body;
      if (!decision || !['approved', 'rejected'].includes(decision)) {
        return badRequest(res, 'Invalid decision (must be approved or rejected)');
      }

      // Get user's member binding
      const { getCommandCenterActorContext } = await import('../../../memory/repositories/command-center.js');
      const context = await getCommandCenterActorContext(ownerUserId, credential.id);
      
      if (!context.binding) {
        return res.status(403).json({ error: 'User not bound to any member' });
      }

      await makeApprovalDecision(requestId, context.binding.memberId, decision, comment);
      await audit(actor.userId, 'command_center.approval_decision', { requestId, decision }, 'web');
      
      res.json({ success: true });
    } catch (err: any) {
      logger.error('Failed to make approval decision', { error: err.message });
      res.status(500).json({ error: err.message ?? 'Failed to make approval decision' });
    }
  });

  return router;
}
