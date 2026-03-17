import { aiChat } from '../core/ai-client.js';
import logger from '../utils/logger.js';

export interface SkillOrchestrationRequest {
  taskTitle: string;
  taskDescription: string;
  taskPriority: string;
  taskTags: string[];
  availableSkills: Array<{
    id: string;
    name: string;
    description: string;
    trigger: string;
  }>;
  candidateMembers: Array<{
    id: string;
    name: string;
    skills: Array<{
      skillId: string;
      skillName: string;
      proficiency: number;
    }>;
    workload: number; // 当前任务数量
  }>;
}

export interface SkillOrchestrationResult {
  recommendedSkillId: string | null;
  recommendedSkillName: string | null;
  recommendedMemberId: string | null;
  recommendedMemberName: string | null;
  confidence: number;
  reasoning: string;
  executionPlan: Array<{
    step: number;
    action: string;
    skillId?: string;
    estimatedDuration: number; // minutes
  }>;
  fallbackOptions: Array<{
    skillId: string;
    memberId: string;
    reason: string;
  }>;
}

const ORCHESTRATION_SYSTEM_PROMPT = `You are an AI skill orchestration assistant. Your job is to analyze tasks and recommend the best skill and executor from available options.

Given:
- Task details (title, description, priority, tags)
- Available skills (with descriptions and triggers)
- Candidate members (with their skills, proficiency levels, current workload)

Recommend:
1. Best matching skill (if any)
2. Best executor member (considering skill match, proficiency, workload)
3. Confidence score (0.0-1.0)
4. Reasoning explanation
5. Execution plan with steps
6. Fallback options

Respond in JSON format:
{
  "recommendedSkillId": "string | null",
  "recommendedSkillName": "string | null",
  "recommendedMemberId": "string | null",
  "recommendedMemberName": "string | null",
  "confidence": number,
  "reasoning": "string",
  "executionPlan": [
    { "step": 1, "action": "string", "skillId": "string", "estimatedDuration": number }
  ],
  "fallbackOptions": [
    { "skillId": "string", "memberId": "string", "reason": "string" }
  ]
}

Rules:
- If no skill matches well, return null for skill fields
- Consider workload balance - don't always pick the same person
- Proficiency matters more than workload for complex tasks
- For urgent tasks, prefer availability over perfect skill match
- Execution plan should be realistic and actionable`;export async function orchestrateSkillSelection(
  request: SkillOrchestrationRequest
): Promise<SkillOrchestrationResult> {
  try {
    const prompt = buildOrchestrationPrompt(request);

    const response = await aiChat({
      systemPrompt: ORCHESTRATION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [prompt] }],
      maxTokens: 1500,
      temperature: 0.2,
      responseFormat: { type: 'json_object' },
    });

    const content = response.content.trim();
    let result: SkillOrchestrationResult;

    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) ||
                        content.match(/```\s*([\s\S]*?)```/) ||
                        [null, content];
      const jsonStr = jsonMatch[1] || content;
      result = JSON.parse(jsonStr);
    } catch (parseError) {
      logger.warn('Failed to parse skill orchestration JSON', { content, error: parseError });
      return createFallbackResult(request, 'JSON parse error');
    }

    // Validate and normalize
    if (typeof result.confidence !== 'number') {
      result.confidence = 0.5;
    }
    if (!Array.isArray(result.executionPlan)) {
      result.executionPlan = [];
    }
    if (!Array.isArray(result.fallbackOptions)) {
      result.fallbackOptions = [];
    }

    return result;
  } catch (error) {
    logger.error('Skill orchestration failed', { error, request: request.taskTitle });
    return createFallbackResult(request, 'Orchestration service error');
  }
}

function buildOrchestrationPrompt(request: SkillOrchestrationRequest): string {
  const lines = [
    '## Task',
    `Title: ${request.taskTitle}`,
    `Description: ${request.taskDescription}`,
    `Priority: ${request.taskPriority}`,
    `Tags: ${request.taskTags.join(', ') || 'none'}`,
    '',
    '## Available Skills',
    ...request.availableSkills.map(s => `- ${s.id}: ${s.name}\n  Description: ${s.description}\n  Trigger: ${s.trigger}`),
    '',
    '## Candidate Members',
    ...request.candidateMembers.map(m => {
      const skillStr = m.skills.map(s => `${s.skillName}(proficiency:${s.proficiency})`).join(', ');
      return `- ${m.id}: ${m.name}\n  Skills: ${skillStr || 'none'}\n  Current Workload: ${m.workload} tasks`;
    }),
    '',
    'Please recommend the best skill and executor for this task.',
  ];

  return lines.join('\n');
}

function createFallbackResult(
  request: SkillOrchestrationRequest,
  reason: string
): SkillOrchestrationResult {
  // Simple fallback: pick member with lowest workload
  const sortedByWorkload = [...request.candidateMembers].sort((a, b) => a.workload - b.workload);
  const fallbackMember = sortedByWorkload[0];

  return {
    recommendedSkillId: null,
    recommendedSkillName: null,
    recommendedMemberId: fallbackMember?.id || null,
    recommendedMemberName: fallbackMember?.name || null,
    confidence: 0.3,
    reasoning: `Fallback selection due to: ${reason}. Selected member with lowest workload.`,
    executionPlan: [],
    fallbackOptions: fallbackMember ? [{
      skillId: request.availableSkills[0]?.id || '',
      memberId: fallbackMember.id,
      reason: 'Lowest workload fallback',
    }] : [],
  };
}

// Helper to calculate workload score (lower is better)
export function calculateWorkloadScore(workload: number, maxWorkload: number): number {
  if (maxWorkload === 0) return 0;
  const ratio = workload / maxWorkload;
  // Exponential decay - heavily penalize overloaded members
  return Math.exp(ratio * 2) - 1;
}

// Helper to calculate skill match score
export function calculateSkillMatchScore(
  taskTags: string[],
  memberSkills: Array<{ skillName: string; proficiency: number }>
): number {
  if (taskTags.length === 0 || memberSkills.length === 0) return 0;

  let totalScore = 0;
  let matches = 0;

  for (const tag of taskTags) {
    const tagLower = tag.toLowerCase();
    for (const skill of memberSkills) {
      const skillLower = skill.skillName.toLowerCase();
      if (skillLower.includes(tagLower) || tagLower.includes(skillLower)) {
        totalScore += (skill.proficiency / 100);
        matches++;
      }
    }
  }

  if (matches === 0) return 0;
  return totalScore / matches;
}
