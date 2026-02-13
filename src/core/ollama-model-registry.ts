import logger from '../utils/logger.js';

/** Definition of an Ollama model with capabilities */
export interface OllamaModelDef {
  id: string;               // Internal ID used in agent assignments
  ollamaTag: string;         // Exact tag for Ollama API (e.g. 'glm5')
  displayName: string;
  strengths: string[];
  supportsTools: boolean;    // Does this model handle OpenAI-format tool_calls?
  supportsVision: boolean;
  supportsThinking: boolean; // Supports chain-of-thought / thinking modes?
  contextSize: number;
  speedTier: 'fast' | 'medium' | 'slow';
}

// ═══════════════════════════════════════════════════════════════════
// AGI 2026 Ollama Models — per-agent optimal assignment
// ═══════════════════════════════════════════════════════════════════

export const OLLAMA_MODELS: OllamaModelDef[] = [
  // ── Master Control & Strategy ──
  {
    id: 'glm5', ollamaTag: 'glm5',
    displayName: 'GLM-5 (744B/40B active)',
    strengths: ['strategy', 'planning', 'management', 'orchestration', 'complex-systems'],
    supportsTools: true, supportsVision: false, supportsThinking: true,
    contextSize: 128000, speedTier: 'medium',
  },
  // ── Deep Research & Analysis ──
  {
    id: 'deepseek-v3.1', ollamaTag: 'deepseek-v3.1',
    displayName: 'DeepSeek V3.1 (671B)',
    strengths: ['research', 'analysis', 'coding', 'reasoning', 'risk-assessment'],
    supportsTools: true, supportsVision: false, supportsThinking: true,
    contextSize: 64000, speedTier: 'medium',
  },
  // ── Trading & Quantitative ──
  {
    id: 'qwen3-next', ollamaTag: 'qwen3-next',
    displayName: 'Qwen3-Next (80B)',
    strengths: ['trading', 'fast-inference', 'math', 'quantitative', 'real-time'],
    supportsTools: true, supportsVision: false, supportsThinking: false,
    contextSize: 32000, speedTier: 'fast',
  },
  // ── Agentic Coding ──
  {
    id: 'qwen3-coder-next', ollamaTag: 'qwen3-coder-next',
    displayName: 'Qwen3-Coder-Next',
    strengths: ['coding', 'automation', 'tool-creation', 'debugging', 'agentic-workflows'],
    supportsTools: true, supportsVision: false, supportsThinking: true,
    contextSize: 64000, speedTier: 'medium',
  },
  // ── Evolution & Self-Improvement ──
  {
    id: 'devstral-small-2', ollamaTag: 'devstral-small-2',
    displayName: 'Devstral Small 2 (24B)',
    strengths: ['evolution', 'updates', 'refactoring', 'codebase-exploration', 'multi-file-edit'],
    supportsTools: true, supportsVision: false, supportsThinking: false,
    contextSize: 32000, speedTier: 'fast',
  },
  // ── Multimodal Research & OSINT ──
  {
    id: 'kimi-k2.5', ollamaTag: 'kimi-k2.5',
    displayName: 'Kimi K2.5',
    strengths: ['research', 'osint', 'security', 'multimodal', 'vision', 'document-analysis'],
    supportsTools: true, supportsVision: true, supportsThinking: true,
    contextSize: 128000, speedTier: 'medium',
  },
  // ── Document Intelligence ──
  {
    id: 'glm-ocr', ollamaTag: 'glm-ocr',
    displayName: 'GLM-OCR',
    strengths: ['ocr', 'document-processing', 'vision', 'extraction', 'compliance'],
    supportsTools: false, supportsVision: true, supportsThinking: false,
    contextSize: 16000, speedTier: 'fast',
  },
  // ── Personal Assistant & Communication ──
  {
    id: 'minimax-m2.5', ollamaTag: 'minimax-m2.5',
    displayName: 'MiniMax M2.5',
    strengths: ['personal-assistant', 'conversation', 'scheduling', 'productivity', 'hebrew'],
    supportsTools: true, supportsVision: false, supportsThinking: false,
    contextSize: 64000, speedTier: 'fast',
  },
  // ── Enterprise ──
  {
    id: 'granite4', ollamaTag: 'granite4',
    displayName: 'Granite 4',
    strengths: ['enterprise', 'compliance', 'structured-data', 'business', 'rag'],
    supportsTools: true, supportsVision: false, supportsThinking: false,
    contextSize: 32000, speedTier: 'medium',
  },
  // ── Fast Trading Backup ──
  {
    id: 'nemotron-3-nano', ollamaTag: 'nemotron-3-nano',
    displayName: 'Nemotron 3 Nano',
    strengths: ['trading-backup', 'fast-inference', 'lightweight', 'low-latency'],
    supportsTools: false, supportsVision: false, supportsThinking: false,
    contextSize: 8000, speedTier: 'fast',
  },
];

// ═══════════════════════════════════════════════════════════════════
// Agent → Ollama Model mapping
// Based on AGI research: match model strengths to agent responsibilities
// ═══════════════════════════════════════════════════════════════════

export const AGENT_OLLAMA_MAP: Record<string, string> = {
  // Master control / orchestration → GLM-5 (complex systems engineering)
  'orchestrator':       'glm5',
  'strategy-lab':       'glm5',

  // Research / analysis → DeepSeek V3.1 (thinking + non-thinking modes)
  'researcher':         'deepseek-v3.1',
  'server-manager':     'deepseek-v3.1',

  // Trading → Qwen3-Next (speed + efficiency for real-time)
  'crypto-trader':      'qwen3-next',
  'crypto-analyst':     'qwen3-next',
  'market-maker':       'qwen3-next',

  // Code / automation → Qwen3-Coder-Next (agentic coding workflows)
  'code-assistant':     'qwen3-coder-next',
  'project-builder':    'qwen3-coder-next',

  // Multimodal / investigation → Kimi K2.5 (native multimodal agentic)
  'content-creator':    'kimi-k2.5',
  'web-agent':          'kimi-k2.5',
  'security-guard':     'kimi-k2.5',

  // Personal assistant / communication → MiniMax M2.5 (productivity)
  'general':            'minimax-m2.5',
  'task-planner':       'minimax-m2.5',
  'device-controller':  'minimax-m2.5',
  'desktop-controller': 'minimax-m2.5',
};

/** Resolve which Ollama model to use for a given agent */
export function resolveOllamaModel(agentId: string, overrideModelId?: string): OllamaModelDef | undefined {
  const modelId = overrideModelId ?? AGENT_OLLAMA_MAP[agentId];
  if (!modelId) return undefined;
  return OLLAMA_MODELS.find(m => m.id === modelId);
}

/** Get all registered Ollama model tags */
export function getOllamaModelTags(): string[] {
  return OLLAMA_MODELS.map(m => m.ollamaTag);
}

/** Check which models are actually pulled/available on Ollama */
export async function checkOllamaModels(baseUrl: string): Promise<{
  available: string[];
  missing: string[];
}> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { available: [], missing: getOllamaModelTags() };
    const data = await res.json() as { models?: Array<{ name?: string }> };
    const pulled = new Set((data.models ?? []).map((m) => m.name?.split(':')[0]));
    const available = OLLAMA_MODELS.filter(m => pulled.has(m.ollamaTag)).map(m => m.id);
    const missing = OLLAMA_MODELS.filter(m => !pulled.has(m.ollamaTag)).map(m => m.id);
    logger.info('Ollama model check', { available: available.length, missing: missing.length });
    return { available, missing };
  } catch {
    return { available: [], missing: getOllamaModelTags() };
  }
}

/** Get model info for display */
export function getOllamaModelInfo(modelId: string): OllamaModelDef | undefined {
  return OLLAMA_MODELS.find(m => m.id === modelId);
}

/** Get full agent→model mapping for dashboard */
export function getAgentModelMapping(): Array<{ agentId: string; modelId: string; displayName: string }> {
  return Object.entries(AGENT_OLLAMA_MAP).map(([agentId, modelId]) => {
    const model = OLLAMA_MODELS.find(m => m.id === modelId);
    return { agentId, modelId, displayName: model?.displayName ?? modelId };
  });
}
