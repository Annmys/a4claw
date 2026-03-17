import { appendCommandCenterTaskEvent, updateCommandCenterTaskStatus, updateCommandCenterTaskRunStatus, createCommandCenterTaskRun } from '../../memory/repositories/command-center.js';
import { audit } from '../../security/audit-log.js';
import logger from '../../utils/logger.js';

export interface TaskExecutionResult {
  success: boolean;
  taskId: string;
  runId?: string;
  outputSummary?: string;
  artifacts?: Array<{
    type: string;
    name: string;
    path?: string;
    url?: string;
    size?: number;
    mimeType?: string;
  }>;
  metrics?: {
    duration: number; // seconds
    tokensUsed?: { input: number; output: number };
    cost?: number;
    steps?: number;
  };
  error?: {
    message: string;
    code?: string;
    stack?: string;
  };
}

/**
 * Write execution result back to task center
 * This connects agent execution to the command center audit trail
 */
export async function writebackExecutionResult(
  ownerUserId: string,
  result: TaskExecutionResult,
  actorId: string
): Promise<void> {
  try {
    const { taskId, runId, success, outputSummary, artifacts, metrics, error } = result;

    // 1. Update task run status if runId exists
    if (runId) {
      const status = success ? 'succeeded' : 'failed';
      await updateCommandCenterTaskRunStatus(ownerUserId, runId, {
        status,
        actorId,
        outputSummary: outputSummary || (error ? `Error: ${error.message}` : 'No output'),
        artifacts: artifacts || [],
        metadata: {
          writebackAt: new Date().toISOString(),
          metrics,
          error: error ? { message: error.message, code: error.code } : undefined,
        },
      });
    }

    // 2. Create task event for audit trail
    const eventContent = buildEventContent(result);
    await appendCommandCenterTaskEvent(ownerUserId, {
      taskId,
      eventType: success ? 'execution_completed' : 'execution_failed',
      content: eventContent,
      actorType: 'system',
      actorId,
      metadata: {
        runId,
        success,
        duration: metrics?.duration,
        cost: metrics?.cost,
        artifactCount: artifacts?.length || 0,
        errorCode: error?.code,
      },
    });

    // 3. If successful and has artifacts, create artifact events
    if (success && artifacts && artifacts.length > 0) {
      for (const artifact of artifacts) {
        await appendCommandCenterTaskEvent(ownerUserId, {
          taskId,
          eventType: 'artifact_created',
          content: `生成产物：${artifact.name}${artifact.type ? ` (${artifact.type})` : ''}`,
          actorType: 'system',
          actorId,
          metadata: {
            artifactName: artifact.name,
            artifactType: artifact.type,
            artifactPath: artifact.path,
            artifactUrl: artifact.url,
            artifactSize: artifact.size,
          },
        });
      }
    }

    // 4. If failed with error, create error event
    if (!success && error) {
      await appendCommandCenterTaskEvent(ownerUserId, {
        taskId,
        eventType: 'execution_error',
        content: `执行错误：${error.message}${error.code ? ` [${error.code}]` : ''}`,
        actorType: 'system',
        actorId,
        metadata: {
          errorMessage: error.message,
          errorCode: error.code,
          errorStack: error.stack,
        },
      });
    }

    // 5. Audit log
    await audit(actorId, success ? 'task.execution.completed' : 'task.execution.failed', {
      taskId,
      runId,
      duration: metrics?.duration,
      cost: metrics?.cost,
      artifactCount: artifacts?.length || 0,
    }, 'system');

    logger.info('Execution result written back to task center', {
      taskId,
      runId,
      success,
      ownerUserId,
    });
  } catch (writebackError) {
    logger.error('Failed to writeback execution result', {
      error: writebackError,
      taskId: result.taskId,
      runId: result.runId,
    });
    // Don't throw - writeback failure should not break the execution flow
  }
}

function buildEventContent(result: TaskExecutionResult): string {
  const lines: string[] = [];

  if (result.success) {
    lines.push('✅ 任务执行完成');
  } else {
    lines.push('❌ 任务执行失败');
  }

  if (result.outputSummary) {
    lines.push(`\n输出摘要：${result.outputSummary.slice(0, 200)}${result.outputSummary.length > 200 ? '...' : ''}`);
  }

  if (result.metrics) {
    const { duration, tokensUsed, cost, steps } = result.metrics;
    lines.push('\n执行指标：');
    if (duration) lines.push(`- 耗时：${formatDuration(duration)}`);
    if (tokensUsed) lines.push(`- Token 使用：${tokensUsed.input} in / ${tokensUsed.output} out`);
    if (cost) lines.push(`- 成本：$${cost.toFixed(4)}`);
    if (steps) lines.push(`- 执行步骤：${steps}`);
  }

  if (result.artifacts && result.artifacts.length > 0) {
    lines.push(`\n生成产物：${result.artifacts.length} 个`);
    for (const artifact of result.artifacts.slice(0, 5)) {
      lines.push(`- ${artifact.name}${artifact.size ? ` (${formatSize(artifact.size)})` : ''}`);
    }
    if (result.artifacts.length > 5) {
      lines.push(`- ... 还有 ${result.artifacts.length - 5} 个`);
    }
  }

  if (result.error) {
    lines.push(`\n错误信息：${result.error.message}`);
  }

  return lines.join('\n');
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}小时${mins}分`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

/**
 * Hook into engine processing to automatically writeback results
 * This wraps the engine.process() call to capture results
 */
export async function processWithWriteback(
  ownerUserId: string,
  taskId: string,
  runId: string | undefined,
  processor: () => Promise<{
    text: string;
    tokensUsed?: { input: number; output: number };
    provider?: string;
    modelUsed?: string;
    agentUsed?: string;
    skillUsed?: string;
    elapsed?: number;
  }>,
  actorId: string
): Promise<ReturnType<typeof processor>> {
  const startTime = Date.now();

  try {
    const result = await processor();
    const duration = (Date.now() - startTime) / 1000;

    // Writeback successful execution
    await writebackExecutionResult(ownerUserId, {
      success: true,
      taskId,
      runId,
      outputSummary: result.text.slice(0, 500),
      metrics: {
        duration,
        tokensUsed: result.tokensUsed,
        cost: estimateCost(result.tokensUsed, result.provider, result.modelUsed),
      },
    }, actorId);

    return result;
  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;

    // Writeback failed execution
    await writebackExecutionResult(ownerUserId, {
      success: false,
      taskId,
      runId,
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        code: (error as any)?.code,
        stack: error instanceof Error ? error.stack : undefined,
      },
      metrics: { duration },
    }, actorId);

    throw error;
  }
}

// Rough cost estimation (can be replaced with actual pricing)
function estimateCost(
  tokensUsed?: { input: number; output: number },
  provider?: string,
  model?: string
): number {
  if (!tokensUsed) return 0;

  // Default pricing per 1K tokens
  const inputPrice = 0.003;  // $0.003 per 1K input tokens
  const outputPrice = 0.015; // $0.015 per 1K output tokens

  return (tokensUsed.input / 1000 * inputPrice) + (tokensUsed.output / 1000 * outputPrice);
}
