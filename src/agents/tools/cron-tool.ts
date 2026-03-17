import { BaseTool, ToolResult } from './base-tool.js';
import { CronEngine, parseCronExpression } from '../../core/cron-engine.js';
import type { CronTask } from '../../core/cron-engine.js';

let cronEngineRef: CronEngine | null = null;

export function setCronToolEngine(engine: CronEngine) {
  cronEngineRef = engine;
}

export class CronTool extends BaseTool {
  name = 'cron';
  description = 'Manage scheduled/cron tasks: create, list, remove, enable, disable recurring tasks.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    if (!cronEngineRef) {
      return { success: false, output: '', error: 'Cron engine not initialized' };
    }

    const action = String(input.action ?? '');

    switch (action) {
      case 'list': {
        const userId = input.userId ? String(input.userId) : undefined;
        const tasks = cronEngineRef.listTasks(userId);
        if (tasks.length === 0) {
          return { success: true, output: 'No scheduled tasks.' };
        }
        const list = tasks.map(t =>
          `- [${t.id}] "${t.name}" — ${t.expression} — ${t.enabled ? 'active' : 'paused'} — action: ${t.action}${t.lastRun ? ` — last run: ${t.lastRun}` : ''}`
        ).join('\n');
        return { success: true, output: `Scheduled tasks (${tasks.length}):\n${list}` };
      }

      case 'add': {
        const scheduleInput = String(input.schedule ?? input.expression ?? '');
        const expression = parseCronExpression(scheduleInput) ?? scheduleInput;

        if (!expression) {
          return { success: false, output: '', error: 'Could not parse schedule expression. Use cron format or natural language like "every 5 min", "every morning".' };
        }

        const task: CronTask = {
          id: `cron_${Date.now()}`,
          userId: String(input.userId ?? 'admin'),
          name: String(input.name ?? 'Scheduled task'),
          expression,
          action: String(input.taskAction ?? 'send_message'),
          actionData: {
            message: input.message ?? input.name ?? 'Scheduled reminder',
            ...(typeof input.actionData === 'object' && input.actionData ? input.actionData as Record<string, unknown> : {}),
          },
          platform: String(input.platform ?? 'telegram'),
          enabled: true,
          createdAt: new Date().toISOString(),
        };

        await cronEngineRef.addTask(task);
        this.log('Task created', { id: task.id, name: task.name, expression });
        return { success: true, output: `Scheduled task created:\n- ID: ${task.id}\n- Name: ${task.name}\n- Cron: ${expression}\n- Action: ${task.action}` };
      }

      case 'remove': {
        const taskId = String(input.taskId ?? '');
        if (!taskId) return { success: false, output: '', error: 'taskId is required for remove' };
        const removed = await cronEngineRef.removeTask(taskId);
        return removed
          ? { success: true, output: `Task ${taskId} removed.` }
          : { success: false, output: '', error: `Task ${taskId} not found.` };
      }

      case 'enable': {
        const taskId = String(input.taskId ?? '');
        if (!taskId) return { success: false, output: '', error: 'taskId is required for enable' };
        await cronEngineRef.enableTask(taskId);
        return { success: true, output: `Task ${taskId} enabled.` };
      }

      case 'disable': {
        const taskId = String(input.taskId ?? '');
        if (!taskId) return { success: false, output: '', error: 'taskId is required for disable' };
        await cronEngineRef.disableTask(taskId);
        return { success: true, output: `Task ${taskId} disabled.` };
      }

      default:
        return { success: false, output: '', error: `Unknown cron action: ${action}. Use: list, add, remove, enable, disable.` };
    }
  }
}
