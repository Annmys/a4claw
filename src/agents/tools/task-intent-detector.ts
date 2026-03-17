import { aiChat } from '../core/ai-client.js';
import logger from '../utils/logger.js';

export interface TaskIntent {
  hasTaskIntent: boolean;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  suggestedSkills: string[];
  confidence: number; // 0-1
  extractedData?: Record<string, unknown>;
}

const INTENT_SYSTEM_PROMPT = `You are an AI task extraction assistant. Your job is to analyze user messages and determine if they contain a task or work request that should be tracked.

Analyze the user's message and extract the following information in JSON format:
{
  "hasTaskIntent": boolean,  // true if this is clearly a task/request, false if it's just chat
  "title": string,           // concise task title (max 50 chars)
  "description": string,     // detailed description of what needs to be done
  "priority": "low" | "medium" | "high" | "critical",  // inferred priority
  "suggestedSkills": string[], // relevant skills that might be needed
  "confidence": number,      // 0.0-1.0 confidence that this is a task
  "extractedData": {}        // any structured data extracted (deadlines, contacts, etc.)
}

Guidelines:
- hasTaskIntent: true for requests, commands, questions that require work, todo items, reminders
- hasTaskIntent: false for casual chat, greetings, simple questions, status updates
- Priority: critical = urgent + important, high = important, medium = normal work, low = nice-to-have
- Suggested skills: based on the domain (coding, writing, research, design, data, etc.)
- Be conservative - when in doubt, set hasTaskIntent to false

Respond ONLY with valid JSON, no markdown, no explanation.`;

export async function detectTaskIntent(
  message: string,
  context?: {
    previousMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
    userRole?: string;
    platform?: string;
  }
): Promise<TaskIntent> {
  try {
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'assistant', content: INTENT_SYSTEM_PROMPT },
    ];

    // Add context if available
    if (context?.previousMessages && context.previousMessages.length > 0) {
      // Include last 3 messages for context
      const recentMessages = context.previousMessages.slice(-3);
      messages.push(...recentMessages);
    }

    messages.push({ role: 'user', content: message });

    const response = await aiChat({
      systemPrompt: INTENT_SYSTEM_PROMPT,
      messages: messages.map(m => ({ ...m, content: [m.content] })),
      maxTokens: 500,
      temperature: 0.1,
      responseFormat: { type: 'json_object' },
    });

    const content = response.content.trim();
    let result: TaskIntent;

    try {
      // Try to extract JSON from potential markdown code block
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || 
                        content.match(/```\s*([\s\S]*?)```/) ||
                        [null, content];
      const jsonStr = jsonMatch[1] || content;
      result = JSON.parse(jsonStr);
    } catch (parseError) {
      logger.warn('Failed to parse task intent JSON', { content, error: parseError });
      return {
        hasTaskIntent: false,
        title: '',
        description: '',
        priority: 'medium',
        suggestedSkills: [],
        confidence: 0,
      };
    }

    // Validate and normalize
    if (typeof result.hasTaskIntent !== 'boolean') {
      result.hasTaskIntent = false;
    }
    if (!['low', 'medium', 'high', 'critical'].includes(result.priority)) {
      result.priority = 'medium';
    }
    if (!Array.isArray(result.suggestedSkills)) {
      result.suggestedSkills = [];
    }
    if (typeof result.confidence !== 'number') {
      result.confidence = 0;
    }

    return result;
  } catch (error) {
    logger.error('Task intent detection failed', { error, message: message.slice(0, 100) });
    return {
      hasTaskIntent: false,
      title: '',
      description: '',
      priority: 'medium',
      suggestedSkills: [],
      confidence: 0,
    };
  }
}

// Quick check without AI call for obvious cases
export function quickTaskIntentCheck(message: string): { isLikelyTask: boolean; confidence: number } {
  const taskKeywords = [
    '请帮我', '帮我', '需要', '想要', '能不能', '可以', '麻烦',
    '做一个', '创建一个', '生成', '写', '修改', '更新', '删除',
    '调查', '研究', '分析一下', '查一下',
    '记得', '提醒', '别忘了', '注意',
    '任务', 'todo', '待办',
  ];

  const nonTaskPatterns = [
    /^你好|^hi|^hello/i,
    /^(谢谢|感谢|thx|thanks)/i,
    /^(拜拜|再见|bye)/i,
    /^好的|^ok|^收到/,
    /^\?+$/, // Just question marks
    /^[\d\s]+$/, // Just numbers
  ];

  // Check non-task patterns first
  for (const pattern of nonTaskPatterns) {
    if (pattern.test(message.trim())) {
      return { isLikelyTask: false, confidence: 0.9 };
    }
  }

  // Check for task keywords
  const lowerMessage = message.toLowerCase();
  let keywordMatches = 0;
  for (const keyword of taskKeywords) {
    if (lowerMessage.includes(keyword.toLowerCase())) {
      keywordMatches++;
    }
  }

  if (keywordMatches >= 2) {
    return { isLikelyTask: true, confidence: 0.7 };
  }

  return { isLikelyTask: false, confidence: 0.5 };
}

// Batch process multiple messages
export async function batchDetectTaskIntents(
  messages: Array<{ id: string; content: string; timestamp: Date }>,
  options?: {
    confidenceThreshold?: number;
    batchSize?: number;
  }
): Promise<Array<{ messageId: string; intent: TaskIntent }>> {
  const results: Array<{ messageId: string; intent: TaskIntent }> = [];
  const threshold = options?.confidenceThreshold ?? 0.7;

  for (const message of messages) {
    // Quick check first
    const quickCheck = quickTaskIntentCheck(message.content);
    
    if (!quickCheck.isLikelyTask && quickCheck.confidence > 0.8) {
      results.push({
        messageId: message.id,
        intent: {
          hasTaskIntent: false,
          title: '',
          description: '',
          priority: 'medium',
          suggestedSkills: [],
          confidence: quickCheck.confidence,
        },
      });
      continue;
    }

    // Full AI detection
    const intent = await detectTaskIntent(message.content);
    
    if (intent.hasTaskIntent && intent.confidence >= threshold) {
      results.push({ messageId: message.id, intent });
    } else {
      results.push({
        messageId: message.id,
        intent: { ...intent, hasTaskIntent: false },
      });
    }
  }

  return results;
}
