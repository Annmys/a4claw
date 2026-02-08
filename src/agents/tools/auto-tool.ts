import { BaseTool, ToolResult } from './base-tool.js';
import { executeTool } from '../../core/tool-executor.js';
import logger from '../../utils/logger.js';

interface AutonomousTask {
  id: string;
  goal: string;
  steps: string[];
  currentStep: number;
  status: 'running' | 'paused' | 'completed' | 'failed';
  results: string[];
  createdAt: string;
}

// Shared AI chat function — set from index.ts
let aiChatFn: ((system: string, message: string) => Promise<string>) | null = null;
let alertFn: ((msg: string) => Promise<void>) | null = null;

export function setAutoToolDeps(deps: {
  aiChat: (system: string, message: string) => Promise<string>;
  alert: (msg: string) => Promise<void>;
}) {
  aiChatFn = deps.aiChat;
  alertFn = deps.alert;
}

const activeTasks: Map<string, AutonomousTask> = new Map();

/**
 * Autonomous Agent Tool — multi-step goal execution.
 * AI plans steps, then executes them sequentially using available tools.
 */
export class AutoTool extends BaseTool {
  name = 'auto';
  description = 'Autonomous multi-step task execution. Plan and execute complex goals.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = String(input.action ?? '');

    switch (action) {
      case 'start':
        return this.startTask(input);
      case 'resume':
        return this.resumeTask(String(input.taskId ?? ''));
      case 'stop':
        return this.stopTask(String(input.taskId ?? ''));
      case 'list':
        return this.listTasks();
      case 'status':
        return this.getTaskStatus(String(input.taskId ?? ''));
      default:
        return { success: false, output: '', error: `Unknown action: ${action}. Use: start, resume, stop, list, status` };
    }
  }

  private async startTask(input: Record<string, unknown>): Promise<ToolResult> {
    if (!aiChatFn) {
      return { success: false, output: '', error: 'AI chat function not configured' };
    }

    const goal = String(input.goal ?? '');
    if (!goal) {
      return { success: false, output: '', error: 'goal is required' };
    }

    // AI plans the steps
    const planResponse = await aiChatFn(
      `You break goals into concrete executable steps. Each step = one tool call.
Available tools: bash, search, browser, kie, social, openclaw, file, cron, memory, db.
Respond ONLY with JSON: { "steps": ["step description", ...] }
Max 8 steps. Be specific and actionable.`,
      `Goal: ${goal}\n\nPlan (JSON only):`,
    );

    let steps: string[];
    try {
      const cleaned = planResponse.replace(/```json|```/g, '').trim();
      steps = JSON.parse(cleaned).steps || [];
    } catch {
      return { success: false, output: '', error: `Could not plan steps for: ${goal}` };
    }

    if (steps.length === 0) {
      return { success: false, output: '', error: 'No steps planned' };
    }

    const task: AutonomousTask = {
      id: `auto_${Date.now()}`,
      goal,
      steps,
      currentStep: 0,
      status: 'running',
      results: [],
      createdAt: new Date().toISOString(),
    };
    activeTasks.set(task.id, task);

    this.log('Autonomous task started', { id: task.id, goal, steps: steps.length });

    // Execute steps in background (don't block the response)
    this.executeSteps(task.id).catch(err =>
      logger.error('Autonomous execution failed', { taskId: task.id, error: err.message })
    );

    const stepList = steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
    return {
      success: true,
      output: `Autonomous task started: ${task.id}\nGoal: ${goal}\n\nPlanned steps:\n${stepList}\n\nExecuting in background...`,
    };
  }

  private async executeSteps(taskId: string): Promise<void> {
    const task = activeTasks.get(taskId);
    if (!task || !aiChatFn) return;

    while (task.currentStep < task.steps.length && task.status === 'running') {
      const step = task.steps[task.currentStep];

      try {
        // AI converts step description to tool call
        const execution = await aiChatFn(
          `Convert this step into a single tool call.
Available tools: bash, search, browser, kie, social, openclaw, file, cron, memory, db.
Respond ONLY with JSON: { "tool": "toolName", "input": { ... } }
Use the exact input format each tool expects.`,
          `Goal: ${task.goal}\nCurrent step: ${step}\nPrevious results: ${task.results.slice(-2).join(' | ') || 'none'}\n\nTool call (JSON only):`,
        );

        const cleaned = execution.replace(/```json|```/g, '').trim();
        const { tool, input: toolInput } = JSON.parse(cleaned);
        const result = await executeTool(tool, toolInput);

        const summary = result.success
          ? `Step ${task.currentStep + 1}: ${result.output.slice(0, 200)}`
          : `Step ${task.currentStep + 1} failed: ${result.error || 'unknown error'}`;

        task.results.push(summary);
        task.currentStep++;

        // Pace between steps
        await new Promise(r => setTimeout(r, 2000));
      } catch (err: any) {
        task.results.push(`Step ${task.currentStep + 1} error: ${err.message}`);
        task.currentStep++; // Skip failed step, continue
        logger.warn('Autonomous step failed', { taskId, step, error: err.message });
      }
    }

    task.status = task.currentStep >= task.steps.length ? 'completed' : 'failed';

    // Alert owner of completion
    if (alertFn) {
      const emoji = task.status === 'completed' ? '✅' : '❌';
      await alertFn(
        `${emoji} משימה אוטונומית ${task.status === 'completed' ? 'הושלמה' : 'נכשלה'}:\n` +
        `🎯 ${task.goal}\n\n` +
        task.results.join('\n')
      ).catch(() => {});
    }
  }

  private async resumeTask(taskId: string): Promise<ToolResult> {
    const task = activeTasks.get(taskId);
    if (!task) return { success: false, output: '', error: `Task ${taskId} not found` };
    task.status = 'running';
    this.executeSteps(taskId).catch(() => {});
    return { success: true, output: `Resumed: ${task.goal} (step ${task.currentStep + 1}/${task.steps.length})` };
  }

  private async stopTask(taskId: string): Promise<ToolResult> {
    const task = activeTasks.get(taskId);
    if (!task) return { success: false, output: '', error: `Task ${taskId} not found` };
    task.status = 'paused';
    return { success: true, output: `Stopped: ${task.goal} at step ${task.currentStep}/${task.steps.length}` };
  }

  private listTasks(): ToolResult {
    if (activeTasks.size === 0) {
      return { success: true, output: 'No autonomous tasks.' };
    }
    const list = Array.from(activeTasks.values())
      .map(t => {
        const emoji = t.status === 'running' ? '▶️' : t.status === 'completed' ? '✅' : t.status === 'paused' ? '⏸️' : '❌';
        return `${emoji} ${t.id}: ${t.goal} (${t.currentStep}/${t.steps.length} steps)`;
      })
      .join('\n');
    return { success: true, output: list };
  }

  private getTaskStatus(taskId: string): ToolResult {
    const task = activeTasks.get(taskId);
    if (!task) return { success: false, output: '', error: `Task ${taskId} not found` };
    return {
      success: true,
      output: `Task: ${task.goal}\nStatus: ${task.status}\nProgress: ${task.currentStep}/${task.steps.length}\n\nResults:\n${task.results.join('\n') || 'No results yet'}`,
    };
  }
}
