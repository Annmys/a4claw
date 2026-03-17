import { aiChat } from '../../core/ai-client.js';
import logger from '../../utils/logger.js';

export interface AgentCapability {
  agentId: string;
  agentName: string;
  capabilities: string[];
  tools: string[];
  costProfile: 'low' | 'medium' | 'high';
  successRate: number; // 0-1
  avgResponseTime: number; // seconds
  currentLoad: number; // 0-1
}

export interface CollaborationTask {
  taskId: string;
  title: string;
  description: string;
  requiredCapabilities: string[];
  estimatedComplexity: 'simple' | 'medium' | 'complex';
  priority: 'low' | 'medium' | 'high' | 'critical';
  deadline?: Date;
}

export interface CollaborationPlan {
  strategy: 'single' | 'parallel' | 'sequential' | 'hierarchical';
  primaryAgent: string;
  supportingAgents: Array<{
    agentId: string;
    role: string;
    responsibilities: string[];
  }>;
  executionOrder: string[];
  handoffPoints: Array<{
    from: string;
    to: string;
    condition: string;
  }>;
  confidence: number;
}

export interface MultiAgentExecution {
  taskId: string;
  collaborationId: string;
  participants: Array<{
    agentId: string;
    role: 'lead' | 'contributor' | 'reviewer';
    status: 'pending' | 'working' | 'completed' | 'failed';
    output?: string;
  }>;
  currentPhase: number;
  phases: Array<{
    name: string;
    agentId: string;
    input: string;
    expectedOutput: string;
    status: 'pending' | 'in_progress' | 'completed';
  }>;
}

const COLLABORATION_SYSTEM_PROMPT = `You are a multi-agent collaboration planner. Your job is to analyze tasks and design optimal collaboration strategies among available agents.

Given:
- Task details (title, description, required capabilities, complexity, priority)
- Available agents (with capabilities, tools, cost, success rate, current load)

Design a collaboration plan:
1. Strategy: single (one agent), parallel (simultaneous), sequential (stages), or hierarchical (lead + contributors)
2. Primary agent selection
3. Supporting agents and their roles
4. Execution order
5. Handoff points between agents

Respond in JSON format:
{
  "strategy": "single|parallel|sequential|hierarchical",
  "primaryAgent": "agentId",
  "supportingAgents": [
    { "agentId": "string", "role": "string", "responsibilities": ["string"] }
  ],
  "executionOrder": ["agentId"],
  "handoffPoints": [
    { "from": "agentId", "to": "agentId", "condition": "string" }
  ],
  "confidence": number
}

Rules:
- For simple tasks: use single agent
- For complex tasks with independent subtasks: use parallel
- For multi-stage tasks: use sequential
- For tasks requiring oversight: use hierarchical
- Consider agent load balancing
- Match agent capabilities to task requirements`;

export async function planMultiAgentCollaboration(
  task: CollaborationTask,
  availableAgents: AgentCapability[]
): Promise<CollaborationPlan> {
  try {
    const prompt = buildCollaborationPrompt(task, availableAgents);

    const response = await aiChat({
      systemPrompt: COLLABORATION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [prompt] }],
      maxTokens: 1500,
      temperature: 0.2,
      responseFormat: { type: 'json_object' },
    });

    const content = response.content.trim();
    let plan: CollaborationPlan;

    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) ||
                        content.match(/```\s*([\s\S]*?)```/) ||
                        [null, content];
      const jsonStr = jsonMatch[1] || content;
      plan = JSON.parse(jsonStr);
    } catch (parseError) {
      logger.warn('Failed to parse collaboration plan JSON', { content, error: parseError });
      return createDefaultPlan(task, availableAgents);
    }

    // Validate plan
    if (!['single', 'parallel', 'sequential', 'hierarchical'].includes(plan.strategy)) {
      plan.strategy = 'single';
    }
    if (typeof plan.confidence !== 'number') {
      plan.confidence = 0.5;
    }

    return plan;
  } catch (error) {
    logger.error('Collaboration planning failed', { error, taskId: task.taskId });
    return createDefaultPlan(task, availableAgents);
  }
}

function buildCollaborationPrompt(task: CollaborationTask, agents: AgentCapability[]): string {
  const lines = [
    '## Task',
    `ID: ${task.taskId}`,
    `Title: ${task.title}`,
    `Description: ${task.description}`,
    `Complexity: ${task.estimatedComplexity}`,
    `Priority: ${task.priority}`,
    `Required Capabilities: ${task.requiredCapabilities.join(', ')}`,
    task.deadline ? `Deadline: ${task.deadline.toISOString()}` : '',
    '',
    '## Available Agents',
    ...agents.map(a => 
      `- ${a.agentId}: ${a.agentName}\n` +
      `  Capabilities: ${a.capabilities.join(', ')}\n` +
      `  Tools: ${a.tools.join(', ')}\n` +
      `  Cost: ${a.costProfile}, Success Rate: ${(a.successRate * 100).toFixed(0)}%, ` +
      `Avg Response: ${a.avgResponseTime}s, Load: ${(a.currentLoad * 100).toFixed(0)}%`
    ),
    '',
    'Please design an optimal collaboration plan.',
  ];

  return lines.filter(Boolean).join('\n');
}

function createDefaultPlan(task: CollaborationTask, agents: AgentCapability[]): CollaborationPlan {
  // Select agent with best capability match and lowest load
  const scoredAgents = agents.map(agent => {
    const capabilityMatches = task.requiredCapabilities.filter(cap =>
      agent.capabilities.some(c => c.toLowerCase().includes(cap.toLowerCase()))
    ).length;
    
    const score = (capabilityMatches / Math.max(task.requiredCapabilities.length, 1)) * 0.6 +
                  agent.successRate * 0.3 +
                  (1 - agent.currentLoad) * 0.1;
    
    return { agent, score };
  });

  scoredAgents.sort((a, b) => b.score - a.score);
  const bestAgent = scoredAgents[0]?.agent;

  return {
    strategy: 'single',
    primaryAgent: bestAgent?.agentId || agents[0]?.agentId || 'default',
    supportingAgents: [],
    executionOrder: [bestAgent?.agentId || agents[0]?.agentId || 'default'],
    handoffPoints: [],
    confidence: 0.5,
  };
}

// ============================================================================
// Execution Coordination
// ============================================================================

export class MultiAgentCoordinator {
  private executions = new Map<string, MultiAgentExecution>();

  async startCollaboration(
    taskId: string,
    plan: CollaborationPlan,
    context: Record<string, unknown>
  ): Promise<MultiAgentExecution> {
    const collaborationId = `collab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const execution: MultiAgentExecution = {
      taskId,
      collaborationId,
      participants: [
        { agentId: plan.primaryAgent, role: 'lead', status: 'pending' },
        ...plan.supportingAgents.map(sa => ({
          agentId: sa.agentId,
          role: sa.role === 'lead' ? 'contributor' : 'contributor' as const,
          status: 'pending' as const,
        })),
      ],
      currentPhase: 0,
      phases: this.buildPhases(plan, context),
    };

    this.executions.set(collaborationId, execution);
    
    logger.info('Multi-agent collaboration started', {
      collaborationId,
      taskId,
      strategy: plan.strategy,
      participantCount: execution.participants.length,
    });

    return execution;
  }

  private buildPhases(
    plan: CollaborationPlan,
    context: Record<string, unknown>
  ): MultiAgentExecution['phases'] {
    const phases: MultiAgentExecution['phases'] = [];

    switch (plan.strategy) {
      case 'single':
        phases.push({
          name: 'execution',
          agentId: plan.primaryAgent,
          input: JSON.stringify(context),
          expectedOutput: 'Task completion',
          status: 'pending',
        });
        break;

      case 'sequential':
        for (let i = 0; i < plan.executionOrder.length; i++) {
          const agentId = plan.executionOrder[i];
          phases.push({
            name: `stage-${i + 1}`,
            agentId,
            input: i === 0 ? JSON.stringify(context) : `Output from ${plan.executionOrder[i - 1]}`,
            expectedOutput: `Stage ${i + 1} completion`,
            status: 'pending',
          });
        }
        break;

      case 'parallel':
        for (const agentId of plan.executionOrder) {
          phases.push({
            name: `parallel-${agentId}`,
            agentId,
            input: JSON.stringify(context),
            expectedOutput: 'Partial result',
            status: 'pending',
          });
        }
        break;

      case 'hierarchical':
        // Lead plans, contributors execute
        phases.push({
          name: 'planning',
          agentId: plan.primaryAgent,
          input: JSON.stringify(context),
          expectedOutput: 'Execution plan',
          status: 'pending',
        });
        for (const supporter of plan.supportingAgents) {
          phases.push({
            name: `execute-${supporter.agentId}`,
            agentId: supporter.agentId,
            input: 'From planning phase',
            expectedOutput: supporter.responsibilities[0] || 'Task completion',
            status: 'pending',
          });
        }
        phases.push({
          name: 'integration',
          agentId: plan.primaryAgent,
          input: 'All execution results',
          expectedOutput: 'Final result',
          status: 'pending',
        });
        break;
    }

    return phases;
  }

  async executePhase(
    collaborationId: string,
    phaseIndex: number,
    executor: (agentId: string, input: string) => Promise<{ output: string; success: boolean }>
  ): Promise<{ success: boolean; output: string; nextPhase?: number }> {
    const execution = this.executions.get(collaborationId);
    if (!execution) {
      throw new Error('Collaboration not found');
    }

    const phase = execution.phases[phaseIndex];
    if (!phase) {
      return { success: true, output: 'All phases completed' };
    }

    // Update status
    phase.status = 'in_progress';
    const participant = execution.participants.find(p => p.agentId === phase.agentId);
    if (participant) participant.status = 'working';

    try {
      const result = await executor(phase.agentId, phase.input);
      
      phase.status = 'completed';
      if (participant) {
        participant.status = 'completed';
        participant.output = result.output;
      }

      // Update input for next phases
      for (let i = phaseIndex + 1; i < execution.phases.length; i++) {
        if (execution.phases[i].input.includes(phase.name)) {
          execution.phases[i].input = result.output;
        }
      }

      execution.currentPhase = phaseIndex + 1;

      const hasMorePhases = execution.currentPhase < execution.phases.length;
      
      return {
        success: true,
        output: result.output,
        nextPhase: hasMorePhases ? execution.currentPhase : undefined,
      };
    } catch (error) {
      phase.status = 'completed'; // Mark as completed (with failure)
      if (participant) participant.status = 'failed';
      
      return {
        success: false,
        output: error instanceof Error ? error.message : 'Execution failed',
      };
    }
  }

  getExecution(collaborationId: string): MultiAgentExecution | undefined {
    return this.executions.get(collaborationId);
  }

  async completeCollaboration(collaborationId: string): Promise<void> {
    const execution = this.executions.get(collaborationId);
    if (execution) {
      logger.info('Multi-agent collaboration completed', {
        collaborationId,
        taskId: execution.taskId,
        phasesCompleted: execution.currentPhase,
      });
      this.executions.delete(collaborationId);
    }
  }
}

// Singleton instance
export const multiAgentCoordinator = new MultiAgentCoordinator();
