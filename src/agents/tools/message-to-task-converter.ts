import { detectTaskIntent, quickTaskIntentCheck } from './task-intent-detector.js';
import {
  createCommandCenterTask,
  getCommandCenterActorContext,
  planCommandCenterTaskDispatch,
} from '../../memory/repositories/command-center.js';
import { findWebCredentialByUsername } from '../../memory/repositories/web-credentials.js';
import { findOrCreateUser } from '../../memory/repositories/users.js';
import { audit } from '../../security/audit-log.js';
import logger from '../../utils/logger.js';

export interface MessageToTaskOptions {
  autoDispatch?: boolean;
  confidenceThreshold?: number;
  defaultCenterId?: string;
  defaultDepartmentId?: string;
}

export interface MessageToTaskResult {
  success: boolean;
  taskId?: string;
  runId?: string;
  message: string;
  intent: {
    hasTaskIntent: boolean;
    title: string;
    priority: string;
    confidence: number;
  };
}

/**
 * Convert a user message to a command center task
 */
export async function convertMessageToTask(
  message: string,
  userId: string,
  platform: 'web' | 'telegram' | 'discord' | 'whatsapp' | 'openclaw' = 'web',
  options: MessageToTaskOptions = {}
): Promise<MessageToTaskResult> {
  try {
    // Quick check first to avoid unnecessary AI calls
    const quickCheck = quickTaskIntentCheck(message);
    
    if (!quickCheck.isLikelyTask && quickCheck.confidence > 0.8) {
      return {
        success: false,
        message: '消息不包含明确的任务意图',
        intent: {
          hasTaskIntent: false,
          title: '',
          priority: 'medium',
          confidence: quickCheck.confidence,
        },
      };
    }

    // Full AI intent detection
    const intent = await detectTaskIntent(message, {
      userRole: 'user',
      platform,
    });

    const threshold = options.confidenceThreshold ?? 0.7;

    if (!intent.hasTaskIntent || intent.confidence < threshold) {
      return {
        success: false,
        message: `任务意图置信度不足 (${(intent.confidence * 100).toFixed(0)}%)`,
        intent: {
          hasTaskIntent: intent.hasTaskIntent,
          title: intent.title,
          priority: intent.priority,
          confidence: intent.confidence,
        },
      };
    }

    // Get or create user
    const user = await findOrCreateUser(userId, platform, userId);
    const ownerUserId = user.masterUserId ?? user.id;

    // Get user's web credential and binding
    let centerId = options.defaultCenterId;
    let departmentId = options.defaultDepartmentId;
    let assigneeMemberId: string | undefined;

    if (platform === 'web') {
      const credential = await findWebCredentialByUsername(userId);
      if (credential) {
        const context = await getCommandCenterActorContext(ownerUserId, credential.id);
        if (context.currentMember) {
          centerId = context.currentMember.centerId;
          departmentId = context.currentMember.departmentId || undefined;
          assigneeMemberId = context.currentMember.id;
        }
      }
    }

    if (!centerId) {
      return {
        success: false,
        message: '用户未绑定到任何中心，无法创建任务',
        intent: {
          hasTaskIntent: true,
          title: intent.title,
          priority: intent.priority,
          confidence: intent.confidence,
        },
      };
    }

    // Create the task
    const task = await createCommandCenterTask(ownerUserId, userId, {
      centerId,
      departmentId,
      assigneeMemberId,
      title: intent.title,
      description: intent.description || message,
      priority: intent.priority,
      source: platform,
      requestedBy: userId,
      tags: intent.suggestedSkills,
      metadata: {
        extractedFromMessage: true,
        originalMessage: message.slice(0, 500),
        intentConfidence: intent.confidence,
        detectedSkills: intent.suggestedSkills,
        platform,
        extractedData: intent.extractedData || {},
      },
    });

    await audit(userId, 'command_center.task_created_from_message', {
      taskId: task.id,
      platform,
      intentConfidence: intent.confidence,
    }, platform);

    logger.info('Task created from message', {
      taskId: task.id,
      userId,
      platform,
      title: intent.title,
    });

    let runId: string | undefined;

    // Auto-dispatch if enabled
    if (options.autoDispatch) {
      try {
        const plan = await planCommandCenterTaskDispatch(ownerUserId, task.id, {
          preferredMemberId: assigneeMemberId,
        });

        if (plan && plan.skillAssignment) {
          const { createCommandCenterTaskRun } = await import('../../memory/repositories/command-center.js');
          const run = await createCommandCenterTaskRun(ownerUserId, userId, {
            taskId: task.id,
            skillId: plan.skillAssignment.skillId,
            executorType: 'auto-dispatch',
            executorMemberId: plan.executorMember?.id || assigneeMemberId,
            inputSummary: `自动分派：${plan.reason}`,
            metadata: {
              source: 'message-auto-convert',
              platform,
              autoDispatchReason: plan.reason,
            },
          });
          runId = run.id;
        }
      } catch (dispatchError) {
        logger.warn('Auto-dispatch failed', { taskId: task.id, error: dispatchError });
      }
    }

    return {
      success: true,
      taskId: task.id,
      runId,
      message: `任务已创建：${intent.title}`,
      intent: {
        hasTaskIntent: true,
        title: intent.title,
        priority: intent.priority,
        confidence: intent.confidence,
      },
    };
  } catch (error) {
    logger.error('Failed to convert message to task', { error, userId, platform });
    return {
      success: false,
      message: '任务创建失败：' + (error instanceof Error ? error.message : '未知错误'),
      intent: {
        hasTaskIntent: false,
        title: '',
        priority: 'medium',
        confidence: 0,
      },
    };
  }
}

/**
 * Process a batch of messages and convert them to tasks
 */
export async function batchConvertMessagesToTasks(
  messages: Array<{
    id: string;
    content: string;
    userId: string;
    platform: 'web' | 'telegram' | 'discord' | 'whatsapp' | 'openclaw';
    timestamp: Date;
  }>,
  options: MessageToTaskOptions = {}
): Promise<Array<{ messageId: string; result: MessageToTaskResult }>> {
  const results: Array<{ messageId: string; result: MessageToTaskResult }> = [];

  for (const message of messages) {
    const result = await convertMessageToTask(
      message.content,
      message.userId,
      message.platform,
      options
    );
    results.push({ messageId: message.id, result });
  }

  return results;
}

/**
 * Setup message listener for automatic task conversion
 * This should be called during platform initialization
 */
export function setupAutoTaskConversion(
  options: {
    platforms: Array<'web' | 'telegram' | 'discord' | 'whatsapp' | 'openclaw'>;
    confidenceThreshold?: number;
    autoDispatch?: boolean;
  }
): void {
  logger.info('Auto task conversion setup', {
    platforms: options.platforms,
    confidenceThreshold: options.confidenceThreshold ?? 0.7,
    autoDispatch: options.autoDispatch ?? false,
  });

  // The actual message interception should be implemented
  // in each platform's message handler
  // This function just logs the configuration
}
