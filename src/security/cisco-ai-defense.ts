/**
 * Cisco AI Defense — Optional Enterprise AI Content Filtering
 *
 * Integrates with Cisco's Chat Inspection API for supplementary
 * AI content safety checks. Only active when CISCO_AI_DEFENSE_API_KEY
 * is set in environment.
 *
 * This is a supplementary layer — if the API is unreachable,
 * the system continues with its built-in defenses.
 */

import logger from '../utils/logger.js';

const CISCO_API_URL = process.env.CISCO_AI_DEFENSE_URL || 'https://api.cisco-ai-defense.com/api/v1/inspect/chat';
const CISCO_API_KEY = process.env.CISCO_AI_DEFENSE_API_KEY || '';
const TIMEOUT_MS = 5000; // 5 second timeout — don't slow down responses

export interface CiscoInspectResult {
  safe: boolean;
  violations: string[];
  risk: 'none' | 'low' | 'medium' | 'high';
  available: boolean;
}

/**
 * Check if Cisco AI Defense integration is configured.
 */
export function isCiscoDefenseEnabled(): boolean {
  return CISCO_API_KEY.length > 0;
}

/**
 * Inspect user input before sending to AI.
 */
export async function inspectInput(messages: Array<{ role: string; content: string }>): Promise<CiscoInspectResult> {
  if (!CISCO_API_KEY) {
    return { safe: true, violations: [], risk: 'none', available: false };
  }

  try {
    const res = await fetch(CISCO_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cisco-AI-Defense-API-Key': CISCO_API_KEY,
      },
      body: JSON.stringify({
        type: 'input',
        messages: messages.map(m => ({ role: m.role, content: m.content.slice(0, 5000) })),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      logger.debug('Cisco AI Defense API error', { status: res.status });
      return { safe: true, violations: [], risk: 'none', available: false };
    }

    const data = await res.json() as { safe?: boolean; violations?: string[]; risk?: string };
    return {
      safe: data.safe !== false,
      violations: data.violations ?? [],
      risk: (data.risk as CiscoInspectResult['risk']) ?? 'none',
      available: true,
    };
  } catch (err: any) {
    logger.debug('Cisco AI Defense unreachable', { error: err.message });
    return { safe: true, violations: [], risk: 'none', available: false };
  }
}

/**
 * Inspect AI output before returning to user.
 */
export async function inspectOutput(
  messages: Array<{ role: string; content: string }>,
  response: string,
): Promise<CiscoInspectResult> {
  if (!CISCO_API_KEY) {
    return { safe: true, violations: [], risk: 'none', available: false };
  }

  try {
    const res = await fetch(CISCO_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cisco-AI-Defense-API-Key': CISCO_API_KEY,
      },
      body: JSON.stringify({
        type: 'output',
        messages: [
          ...messages.map(m => ({ role: m.role, content: m.content.slice(0, 2000) })),
          { role: 'assistant', content: response.slice(0, 5000) },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      logger.debug('Cisco AI Defense API error (output)', { status: res.status });
      return { safe: true, violations: [], risk: 'none', available: false };
    }

    const data = await res.json() as { safe?: boolean; violations?: string[]; risk?: string };
    return {
      safe: data.safe !== false,
      violations: data.violations ?? [],
      risk: (data.risk as CiscoInspectResult['risk']) ?? 'none',
      available: true,
    };
  } catch (err: any) {
    logger.debug('Cisco AI Defense unreachable (output)', { error: err.message });
    return { safe: true, violations: [], risk: 'none', available: false };
  }
}
