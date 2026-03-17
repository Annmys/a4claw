import { EventEmitter } from 'events';
import logger from '../utils/logger.js';
import { checkTaskDependenciesSatisfied, unlockDependentTasks } from '../memory/repositories/task-dependencies.js';
import { multiAgentCoordinator, planMultiAgentCollaboration } from './multi-agent-collaboration.js';
import { orchestrateSkillSelection } from '../agents/tools/skill-orchestrator.js';
import { writebackExecutionResult } from '../agents/tools/task-execution-writeback.js';

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  trigger: {
    type: 'manual' | 'scheduled' | 'event' | 'webhook';
    config: Record<string, unknown>;
  };
  variables: Array<{
    name: string;
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    default?: unknown;
    required: boolean;
  }>;
  steps: WorkflowStep[];
}

export interface WorkflowStep {
  id: string;
  name: string;
  type: 'task' | 'condition' | 'parallel' | 'loop' | 'wait' | 'notification';
  config: Record<string, unknown>;
  next?: string;           // Next step ID
  onError?: string;        // Error handler step ID
  timeout?: number;        // Timeout in seconds
}

export interface WorkflowInstance {
  id: string;
  workflowId: string;
  ownerUserId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  variables: Record<string, unknown>;
  currentStep: string | null;
  stepResults: Map<string, unknown>;
  startedAt: Date;
  completedAt?: Date;
}

export interface WorkflowEvent {
  instanceId: string;
  stepId: string;
  eventType: 'step_started' | 'step_completed' | 'step_failed' | 'variable_changed';
  data: Record<string, unknown>;
  timestamp: Date;
}

export class WorkflowEngine extends EventEmitter {
  private workflows = new Map<string, WorkflowDefinition>();
  private instances = new Map<string, WorkflowInstance>();

  // Register a workflow definition
  registerWorkflow(definition: WorkflowDefinition): void {
    this.workflows.set(definition.id, definition);
    logger.info('Workflow registered', { workflowId: definition.id, name: definition.name });
  }

  // Start a workflow instance
  async startWorkflow(
    workflowId: string,
    ownerUserId: string,
    initialVariables: Record<string, unknown> = {}
  ): Promise<WorkflowInstance> {
    const definition = this.workflows.get(workflowId);
    if (!definition) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const instanceId = `wf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Initialize variables with defaults
    const variables: Record<string, unknown> = {};
    for (const variable of definition.variables) {
      if (initialVariables[variable.name] !== undefined) {
        variables[variable.name] = initialVariables[variable.name];
      } else if (variable.default !== undefined) {
        variables[variable.name] = variable.default;
      } else if (variable.required) {
        throw new Error(`Required variable ${variable.name} not provided`);
      }
    }

    const instance: WorkflowInstance = {
      id: instanceId,
      workflowId,
      ownerUserId,
      status: 'running',
      variables,
      currentStep: definition.steps[0]?.id || null,
      stepResults: new Map(),
      startedAt: new Date(),
    };

    this.instances.set(instanceId, instance);

    logger.info('Workflow started', { instanceId, workflowId, ownerUserId });
    this.emit('workflow:started', instance);

    // Start execution
    this.executeWorkflow(instanceId).catch(error => {
      logger.error('Workflow execution failed', { instanceId, error });
      this.failWorkflow(instanceId, error);
    });

    return instance;
  }

  private async executeWorkflow(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    const definition = this.workflows.get(instance.workflowId)!;

    while (instance.currentStep && instance.status === 'running') {
      const step = definition.steps.find(s => s.id === instance.currentStep);
      if (!step) {
        throw new Error(`Step ${instance.currentStep} not found`);
      }

      try {
        this.emit('step:started', { instanceId, stepId: step.id });
        
        const result = await this.executeStep(instance, step);
        instance.stepResults.set(step.id, result);
        
        this.emit('step:completed', { instanceId, stepId: step.id, result });

        // Move to next step
        instance.currentStep = step.next || null;
      } catch (error) {
        this.emit('step:failed', { instanceId, stepId: step.id, error });
        
        if (step.onError) {
          instance.currentStep = step.onError;
        } else {
          throw error;
        }
      }
    }

    // Workflow completed
    if (instance.status === 'running') {
      instance.status = 'completed';
      instance.completedAt = new Date();
      this.emit('workflow:completed', instance);
      logger.info('Workflow completed', { instanceId });
    }
  }

  private async executeStep(
    instance: WorkflowInstance,
    step: WorkflowStep
  ): Promise<unknown> {
    logger.debug('Executing workflow step', { 
      instanceId: instance.id, 
      stepId: step.id, 
      stepType: step.type 
    });

    switch (step.type) {
      case 'task':
        return this.executeTaskStep(instance, step);
      
      case 'condition':
        return this.executeConditionStep(instance, step);
      
      case 'parallel':
        return this.executeParallelStep(instance, step);
      
      case 'loop':
        return this.executeLoopStep(instance, step);
      
      case 'wait':
        return this.executeWaitStep(instance, step);
      
      case 'notification':
        return this.executeNotificationStep(instance, step);
      
      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }

  private async executeTaskStep(
    instance: WorkflowInstance,
    step: WorkflowStep
  ): Promise<unknown> {
    const { taskId, skillId, useOrchestration = true } = step.config;
    
    if (!taskId) {
      throw new Error('Task step requires taskId');
    }

    // Check dependencies first
    const { satisfied, pendingDependencies } = await checkTaskDependenciesSatisfied(
      instance.ownerUserId,
      taskId as string
    );

    if (!satisfied) {
      throw new Error(`Dependencies not satisfied: ${pendingDependencies.map(d => d.title).join(', ')}`);
    }

    // Use skill orchestration if enabled
    if (useOrchestration) {
      const { getCommandCenterTaskById } = await import('../memory/repositories/command-center.js');
      const task = await getCommandCenterTaskById(instance.ownerUserId, taskId as string);
      
      if (task) {
        // Get available skills and members
        const { listCommandCenterSkillAssignments } = await import('../memory/repositories/command-center.js');
        const assignments = await listCommandCenterSkillAssignments(instance.ownerUserId);
        
        const orchestrationResult = await orchestrateSkillSelection({
          taskTitle: task.title,
          taskDescription: task.description || '',
          taskPriority: task.priority,
          taskTags: task.tags || [],
          availableSkills: assignments.map(a => ({
            id: a.skillId,
            name: a.skillName,
            description: `Scope: ${a.scopeType}`,
            trigger: a.skillId,
          })),
          candidateMembers: [], // TODO: Get actual members
        });

        logger.info('Task orchestration result', {
          taskId,
          recommendedSkill: orchestrationResult.recommendedSkillName,
          confidence: orchestrationResult.confidence,
        });
      }
    }

    // Execute task (placeholder - actual execution would call engine)
    return { success: true, taskId };
  }

  private async executeConditionStep(
    instance: WorkflowInstance,
    step: WorkflowStep
  ): Promise<unknown> {
    const { condition, trueNext, falseNext } = step.config;
    
    // Evaluate condition
    const result = this.evaluateCondition(condition as string, instance.variables);
    
    // Update next step based on condition
    step.next = result ? (trueNext as string) : (falseNext as string);
    
    return { condition, result, next: step.next };
  }

  private async executeParallelStep(
    instance: WorkflowInstance,
    step: WorkflowStep
  ): Promise<unknown> {
    const { branches } = step.config as { branches: string[] };
    
    // Execute all branches in parallel
    const promises = branches.map(branchId => {
      const branchStep = this.workflows.get(instance.workflowId)?.steps.find(s => s.id === branchId);
      if (!branchStep) {
        throw new Error(`Branch step ${branchId} not found`);
      }
      return this.executeStep(instance, branchStep);
    });

    const results = await Promise.all(promises);
    return { branches, results };
  }

  private async executeLoopStep(
    instance: WorkflowInstance,
    step: WorkflowStep
  ): Promise<unknown> {
    const { loopVariable, items, bodyStepId } = step.config;
    const loopItems = instance.variables[items as string] as unknown[] || [];
    const results = [];

    for (const item of loopItems) {
      instance.variables[loopVariable as string] = item;
      const bodyStep = this.workflows.get(instance.workflowId)?.steps.find(s => s.id === bodyStepId);
      if (bodyStep) {
        const result = await this.executeStep(instance, bodyStep);
        results.push(result);
      }
    }

    return { items: loopItems.length, results };
  }

  private async executeWaitStep(
    instance: WorkflowInstance,
    step: WorkflowStep
  ): Promise<unknown> {
    const { duration, until } = step.config;
    
    if (duration) {
      await new Promise(resolve => setTimeout(resolve, (duration as number) * 1000));
      return { waited: duration };
    }
    
    if (until) {
      // Wait for condition
      const maxWait = 300000; // 5 minutes max
      const startTime = Date.now();
      
      while (Date.now() - startTime < maxWait) {
        if (this.evaluateCondition(until as string, instance.variables)) {
          return { waited: (Date.now() - startTime) / 1000 };
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      throw new Error('Wait condition timeout');
    }

    return { waited: 0 };
  }

  private async executeNotificationStep(
    instance: WorkflowInstance,
    step: WorkflowStep
  ): Promise<unknown> {
    const { message, channels } = step.config;
    
    // Send notification to specified channels
    for (const channel of (channels as string[] || [])) {
      this.emit('notification', {
        instanceId: instance.id,
        channel,
        message: this.interpolateTemplate(message as string, instance.variables),
      });
    }

    return { notified: channels };
  }

  private evaluateCondition(condition: string, variables: Record<string, unknown>): boolean {
    try {
      // Simple expression evaluation
      // Replace variable references
      let expr = condition;
      for (const [key, value] of Object.entries(variables)) {
        expr = expr.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), JSON.stringify(value));
      }
      
      // Evaluate (with basic safety)
      return Function('"use strict"; return (' + expr + ')')();
    } catch {
      return false;
    }
  }

  private interpolateTemplate(template: string, variables: Record<string, unknown>): string {
    return template.replace(/\$\{(\w+)\}/g, (match, key) => {
      const value = variables[key];
      return value !== undefined ? String(value) : match;
    });
  }

  private failWorkflow(instanceId: string, error: unknown): void {
    const instance = this.instances.get(instanceId);
    if (instance) {
      instance.status = 'failed';
      instance.completedAt = new Date();
      this.emit('workflow:failed', { instance, error });
      logger.error('Workflow failed', { instanceId, error });
    }
  }

  // Public API
  getInstance(instanceId: string): WorkflowInstance | undefined {
    return this.instances.get(instanceId);
  }

  cancelWorkflow(instanceId: string): boolean {
    const instance = this.instances.get(instanceId);
    if (instance && instance.status === 'running') {
      instance.status = 'cancelled';
      instance.completedAt = new Date();
      this.emit('workflow:cancelled', instance);
      return true;
    }
    return false;
  }

  getWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  getInstances(workflowId?: string): WorkflowInstance[] {
    const instances = Array.from(this.instances.values());
    if (workflowId) {
      return instances.filter(i => i.workflowId === workflowId);
    }
    return instances;
  }
}

// Singleton instance
export const workflowEngine = new WorkflowEngine();
