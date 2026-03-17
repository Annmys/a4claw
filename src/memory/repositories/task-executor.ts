import { Engine } from '../core/engine.js';
import { executeTool } from '../core/tool-executor.js';
import { getDb } from './database.js';
import { commandCenterTasks, commandCenterTaskRuns, commandCenterMembers, commandCenterTaskEvents } from './schema.js';
import { eq, and } from 'drizzle-orm';
import { 
  updateCommandCenterTaskRunStatus, 
  updateCommandCenterTaskStatus,
  appendCommandCenterTaskEvent 
} from './repositories/command-center.js';
import { 
  checkNeedsApproval, 
  createApprovalRequest 
} from '../../security/approval-gate.js';
import { writebackExecutionResult } from '../../agents/tools/task-execution-writeback.js';
import { multiAgentCoordinator, planMultiAgentCollaboration } from '../../core/multi-agent-collaboration.js';
import { workflowEngine } from '../../core/workflow-engine.js';
import logger from '../../utils/logger.js';

export interface TaskExecutionContext {
  taskId: string;
  runId: string;
  ownerUserId: string;
  userId: string;
  taskTitle: string;
  taskDescription: string;
  skillId?: string;
  skillName?: string;
  executorMemberId?: string;
}

/**
 * Execute a task run after it's created
 * This bridges the gap between task creation and actual execution
 */
export async function executeTaskRun(
  ownerUserId: string,
  runId: string,
  engine: Engine
): Promise<void> {
  const db = getDb();

  try {
    // 1. Get task run details
    const [run] = await db.select().from(commandCenterTaskRuns).where(and(
      eq(commandCenterTaskRuns.id, runId),
      eq(commandCenterTaskRuns.ownerUserId, ownerUserId)
    )).limit(1);

    if (!run) {
      throw new Error(`Task run not found: ${runId}`);
    }

    if (run.status !== 'pending') {
      logger.info('Task run already processed', { runId, status: run.status });
      return;
    }

    // 2. Get task details
    const [task] = await db.select().from(commandCenterTasks).where(and(
      eq(commandCenterTasks.id, run.taskId),
      eq(commandCenterTasks.ownerUserId, ownerUserId)
    )).limit(1);

    if (!task) {
      throw new Error(`Task not found: ${run.taskId}`);
    }

    // 3. Check approval gates
    const approvalCheck = await checkNeedsApproval(
      'skill_execution',
      {
        action: 'execute_task',
        details: {
          taskId: task.id,
          taskTitle: task.title,
          skillId: run.skillId,
          skillName: run.skillName,
        },
        estimatedCost: 0.01, // TODO: Calculate based on skill
        estimatedDuration: 300, // 5 minutes default
        skills: run.skillId ? [run.skillId] : [],
      },
      task.centerId || undefined
    );

    if (approvalCheck.needsApproval && approvalCheck.matchingGates.length > 0) {
      // Create approval request
      const gate = approvalCheck.matchingGates[0];
      const requestId = await createApprovalRequest({
        gateId: gate.id,
        taskId: task.id,
        requesterId: run.executorMemberId || 'system',
        payload: {
          action: 'execute_task',
          details: {
            runId: run.id,
            taskTitle: task.title,
          },
        },
        timeoutHours: gate.timeoutHours,
      });

      // Update run status
      await updateCommandCenterTaskRunStatus(ownerUserId, runId, {
        status: 'pending',
        actorId: 'system',
        outputSummary: `等待审批: ${gate.name}`,
        metadata: {
          approvalRequestId: requestId,
          gateId: gate.id,
        },
      });

      logger.info('Task execution pending approval', {
        taskId: task.id,
        runId,
        requestId,
        gateId: gate.id,
      });

      return;
    }

    // 4. Update status to running
    await updateCommandCenterTaskRunStatus(ownerUserId, runId, {
      status: 'running',
      actorId: run.executorMemberId || 'system',
    });

    await updateCommandCenterTaskStatus(ownerUserId, task.id, {
      status: 'in_progress',
      actorId: run.executorMemberId || 'system',
    });

    // 5. Execute based on executor type
    let executionResult: {
      success: boolean;
      output: string;
      artifacts?: any[];
      cost?: number;
    };

    try {
      if (run.skillId) {
        // Execute via skill
        executionResult = await executeViaSkill(run, task, engine);
      } else if (run.executorType === 'auto-dispatch') {
        // Auto-dispatch via engine
        executionResult = await executeViaEngine(run, task, engine);
      } else {
        // Default execution
        executionResult = await executeViaEngine(run, task, engine);
      }

      // 6. Writeback results
      await writebackExecutionResult(
        ownerUserId,
        {
          success: executionResult.success,
          taskId: task.id,
          runId: run.id,
          outputSummary: executionResult.output.slice(0, 500),
          artifacts: executionResult.artifacts || [],
          metrics: {
            duration: 0, // TODO: Track actual duration
            cost: executionResult.cost || 0,
          },
        },
        run.executorMemberId || 'system'
      );

      // 7. Update final status
      await updateCommandCenterTaskRunStatus(ownerUserId, runId, {
        status: executionResult.success ? 'succeeded' : 'failed',
        actorId: run.executorMemberId || 'system',
        outputSummary: executionResult.output.slice(0, 2000),
        artifacts: executionResult.artifacts || [],
      });

      // 8. Unlock dependent tasks if successful
      if (executionResult.success) {
        const { unlockDependentTasks } = await import('./task-dependencies.js');
        await unlockDependentTasks(ownerUserId, task.id);
      }

      logger.info('Task execution completed', {
        taskId: task.id,
        runId,
        success: executionResult.success,
      });

    } catch (execError) {
      // Handle execution error
      const errorMessage = execError instanceof Error ? execError.message : 'Execution failed';
      
      await updateCommandCenterTaskRunStatus(ownerUserId, runId, {
        status: 'failed',
        actorId: run.executorMemberId || 'system',
        outputSummary: errorMessage,
      });

      await writebackExecutionResult(
        ownerUserId,
        {
          success: false,
          taskId: task.id,
          runId: run.id,
          error: {
            message: errorMessage,
          },
        },
        run.executorMemberId || 'system'
      );

      throw execError;
    }

  } catch (error) {
    logger.error('Task execution failed', { runId, error });
    throw error;
  }
}

async function executeViaSkill(
  run: typeof commandCenterTaskRuns.$inferSelect,
  task: typeof commandCenterTasks.$inferSelect,
  engine: Engine
): Promise<{ success: boolean; output: string; artifacts?: any[] }> {
  // Execute using the specified skill
  if (!run.skillId) {
    return { success: false, output: 'No skill specified' };
  }

  try {
    // Build task description
    const taskPrompt = buildTaskPrompt(task);

    // Process through engine
    const response = await engine.process({
      platform: 'web',
      userId: task.requestedBy || 'system',
      userName: 'TaskExecutor',
      chatId: `task-${task.id}`,
      text: taskPrompt,
      metadata: {
        source: 'task-execution',
        taskId: task.id,
        runId: run.id,
        skillId: run.skillId,
      },
    });

    return {
      success: true,
      output: response.text,
      artifacts: response.artifacts || [],
    };

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Skill execution failed';
    return { success: false, output: message };
  }
}

async function executeViaEngine(
  run: typeof commandCenterTaskRuns.$inferSelect,
  task: typeof commandCenterTasks.$inferSelect,
  engine: Engine
): Promise<{ success: boolean; output: string; artifacts?: any[] }> {
  try {
    // Build comprehensive task prompt
    const taskPrompt = buildTaskPrompt(task);

    // Process through engine with task context
    const response = await engine.process({
      platform: 'web',
      userId: task.requestedBy || 'system',
      userName: 'TaskExecutor',
      chatId: `task-${task.id}`,
      text: taskPrompt,
      metadata: {
        source: 'task-execution',
        taskId: task.id,
        runId: run.id,
        executorType: run.executorType,
      },
    });

    return {
      success: true,
      output: response.text,
      artifacts: response.artifacts || [],
    };

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Engine execution failed';
    return { success: false, output: message };
  }
}

function buildTaskPrompt(task: typeof commandCenterTasks.$inferSelect): string {
  const parts: string[] = [];

  parts.push(`# 任务执行`);
  parts.push(`## 标题`);
  parts.push(task.title);

  if (task.description) {
    parts.push(`## 描述`);
    parts.push(task.description);
  }

  if (task.tags && task.tags.length > 0) {
    parts.push(`## 标签`);
    parts.push(task.tags.join(', '));
  }

  parts.push(`## 优先级`);
  parts.push(task.priority);

  parts.push(`## 要求`);
  parts.push(`请完成上述任务，并提供：`);
  parts.push(`1. 执行结果`);
  parts.push(`2. 关键产出物（如有）`);
  parts.push(`3. 简要总结`);

  return parts.join('\n\n');
}

/**
 * Resume task execution after approval
 */
export async function resumeTaskExecutionAfterApproval(
  ownerUserId: string,
  requestId: string,
  engine: Engine
): Promise<void> {
  const { getApprovalRequest } = await import('../../security/approval-gate.js');
  
  const request = await getApprovalRequest(requestId);
  if (!request || request.status !== 'approved') {
    throw new Error('Approval request not found or not approved');
  }

  // Find the associated task run
  const db = getDb();
  const [run] = await db.select().from(commandCenterTaskRuns).where(and(
    eq(commandCenterTaskRuns.taskId, request.taskId),
    eq(commandCenterTaskRuns.ownerUserId, ownerUserId)
  )).orderBy(commandCenterTaskRuns.createdAt).limit(1);

  if (!run) {
    throw new Error('Task run not found');
  }

  // Execute the task
  await executeTaskRun(ownerUserId, run.id, engine);
}
