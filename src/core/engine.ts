import { AIClient, Message } from './ai-client.js';
import { pushActivity } from '../interfaces/web/routes/dashboard.js';
import { IntentRouter } from './router.js';
import { buildSystemPromptWithContext, FullContext, trimHistoryToFit } from './context-builder.js';
import { SkillsEngine } from './skills-engine.js';
import { getAgent } from '../agents/registry.js';
import { MetaAgent } from './meta-agent.js';
import { GoalEngine } from './goals.js';
import { GoalPlanner } from './goal-planner.js';
import { AutoLearn } from './auto-learn.js';
import { DesktopController } from '../actions/desktop/controller.js';
import { AIDesktopVision } from '../actions/desktop/ai-vision.js';
import { ProjectBuilder } from '../actions/project-builder/builder.js';
import { Intent } from './router.js';
import { CronEngine, parseCronExpression } from './cron-engine.js';
import type { CronTask } from './cron-engine.js';
import { scheduleReminder } from '../queue/scheduler.js';
import { UsageTracker } from './usage-tracker.js';
import { RAGEngine } from '../actions/rag/rag-engine.js';
import { initTools, getToolDefinitions, executeTool, setExecutionContext } from './tool-executor.js';
import { classifyComplexity, selectModel, classifyEffort, mapEffortToThinking, withVariant, findModel } from './model-router.js';
import { resolveOllamaModel } from './ollama-model-registry.js';
import type { CrewOrchestrator } from './crew-orchestrator.js';
import { onMessageProcessed, onError, getIntelligenceContext, isBridgeReady } from './intelligence-bridge.js';
import { getApprovalGate } from './approval-gate.js';
import type { EvolutionEngine } from './evolution-engine.js';
import { audit } from '../security/audit-log.js';
import config from '../config.js';
import { extractJSON } from '../utils/helpers.js';
import logger from '../utils/logger.js';

import { detectSocialEngineering } from '../security/content-guard.js';
import { scanMessage as guardScanMessage } from '../security/message-guard.js';
import type { ChatArtifact } from './shared-artifacts.js';

// ─── Output Secret Filter ──────────────────────────────────────────
// Prevents LLM from leaking API keys, tokens, or secrets in responses.
const SECRET_PATTERNS = [
  /\b(sk-[a-zA-Z0-9]{20,})\b/g,                          // OpenAI/Anthropic keys
  /\b(ghp_[a-zA-Z0-9]{36,})\b/g,                          // GitHub PAT
  /\b(xox[bpoas]-[a-zA-Z0-9-]{10,})\b/g,                  // Slack tokens
  /\b(AKIA[A-Z0-9]{16})\b/g,                              // AWS access key
  /\b(eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,})\b/g,    // JWT tokens
  /\b(BSA_[a-zA-Z0-9]{20,})\b/g,                          // Brave API key
  /\b([a-f0-9]{64})\b/g,                                  // 64-char hex (likely API secret)
];

function redactSecrets(text: unknown): string {
  // Guard: ensure text is always a string (prevents "input.replace is not a function" crash)
  let redacted = typeof text === 'string' ? text : String(text ?? '');
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]');
  }
  return redacted;
}

export interface ProgressEvent {
  type: 'status' | 'agent' | 'tool' | 'thinking' | 'error';
  message: string;
  agent?: string;
  tool?: string;
}

export interface IncomingMessage {
  platform: 'telegram' | 'discord' | 'whatsapp' | 'web';
  userId: string;
  userName: string;
  chatId: string;
  text: string;
  userRole?: string;
  replyTo?: string;
  conversationId?: string;
  attachments?: Array<{ type: string; url: string }>;
  metadata?: Record<string, unknown>;
  onProgress?: (event: ProgressEvent) => void;
  /** Streaming callback — text tokens as they arrive from the AI */
  onTextChunk?: (text: string) => void;
  /** Called when streaming resets (e.g. new tool iteration) — clear partial text */
  onStreamReset?: () => void;
  responseMode?: ResponseMode;
  model?: string;
}

export interface OutgoingMessage {
  text: string;
  thinking?: string;
  format?: 'text' | 'markdown' | 'html';
  attachments?: Array<{ type: string; data: Buffer; name: string }>;
  artifacts?: ChatArtifact[];
  agentUsed?: string;
  tokensUsed?: { input: number; output: number };
  provider?: string;
  modelUsed?: string;
  modelDisplay?: string; // Human-readable model name for display
  skillUsed?: string;
  elapsed?: number;
}

// ─── Response Mode System ──────────────────────────────────────────────────
// Controls how much processing each message gets. Saves time on simple queries.
export type ResponseMode = 'quick' | 'auto' | 'deep';

// Per-user mode overrides (in-memory, reset on restart)
const userModeOverrides = new Map<string, ResponseMode>();

/**
 * Detect if message is a mode-switch command.
 * Returns the new mode, or null if not a mode command.
 */
function detectModeCommand(text: string): ResponseMode | null {
  const t = text.trim().toLowerCase();
  if (/^(מצב מהיר|quick|fast|מהיר)$/i.test(t)) return 'quick';
  if (/^(מצב אוטומטי|auto|אוטומטי|רגיל)$/i.test(t)) return 'auto';
  if (/^(מצב מעמיק|deep|מעמיק|עמוק)$/i.test(t)) return 'deep';
  return null;
}

/**
 * Auto-detect response mode from message content.
 * Quick: short messages, greetings, simple questions
 * Deep:  long multi-domain tasks, orchestration
 * Auto:  everything else (default)
 */
function autoDetectMode(text: string): ResponseMode {
  const len = text.length;

  // BUILD / CREATE / GAME requests should NEVER be quick — they need tools and high token limits
  // This catches short messages like "בנה לי משחק", "build a game", or even "Platformer" that would otherwise be quick
  if (/\b(build|create|scaffold|deploy|generate|בנה|בנה לי|תבנה|צור|תיצור)\b.*\b(game|app|project|site|website|page|api|dashboard|משחק|אפליקציה|פרויקט|אתר|דף)\b/i.test(text)) {
    return 'auto';
  }
  // Game-genre keywords — even without "build" these imply tool-heavy game creation
  if (/\b(game|games|משחק|משחקים|platformer|shooter|arcade|runner|snake|tetris|pong|breakout|phaser|mario|pacman|puzzle.?game|space.?invader|galaxy|destroyer|flappy|racing|rpg|tower.?defense)\b|קפיצות.*מטבעות|מפלצות.*שלבים|סגנון\s+mario/i.test(text)) {
    return 'auto';
  }

  // Very short messages → always quick
  if (len < 60) return 'quick';

  // Simple greeting / question patterns — only for short-ish messages
  // Long messages starting with "היי" may contain complex requests after the greeting
  if (len < 150 && /^(היי|שלום|הי|hello|hi|hey|yo|בוקר טוב|ערב טוב|מה נשמע|מה קורה|thanks|תודה|ok|אוקי|כן|לא|good|טוב|בסדר)/i.test(text.trim())) {
    return 'quick';
  }

  // Simple short questions (Hebrew + English)
  if (len < 200 && /^(מה|איך|למה|כמה|האם|יש|what|how|why|when|who|where|is there|can you|do you|tell me|show me)/i.test(text.trim())) {
    return 'quick';
  }

  // Multi-domain / complex → deep
  if (len > 500) {
    const domains = [
      /research|חקור|analyze|נתח/i,
      /build|בנה|create|צור|implement/i,
      /trade|signal|מסחר|סיגנל|crypto/i,
      /secur|audit|אבטח|penetr/i,
      /review|בדוק|test|בדיקה/i,
    ];
    const matchCount = domains.filter(d => d.test(text)).length;
    if (matchCount >= 2) return 'deep';
  }

  return 'auto';
}

function isFileDeliveryRequest(text: string): boolean {
  return /save.*file|export.*file|download.*file|attach.*file|send.*file|write.*to.*(path|folder|directory)|保存|另存|导出|下载|附件|发送文件|保存到|路径|目录|文件夹|共享|gongxiang|\/data\/gongxiang|\\\\192\.168\.1\.99\\gongxiang/i.test(text);
}

function isAskingForSavePath(text: string): boolean {
  return /save\s*location|save\s*path|file\s*path|where\s*to\s*save|provide\s*(?:a|the)\s*path|告诉我.*路径|提供.*路径|保存位置|保存路径/i.test(text);
}

function isDeliveryAckOnly(text: string): boolean {
  return /^(?:done|saved|exported|attached|已完成|已保存|保存成功|已导出|已发送)(?:[\s,.:;!，。；：!?-].*)?$/i.test(text.trim());
}

function isLikelyFakeFileDeliveryResponse(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return true;
  if (/sandbox:\/tmp|\/tmp\/a4claw-|下载文件|请直接下载|download\s+file|file\s+is\s+ready|已生成并保存好文件|已保存好文件/i.test(normalized)) {
    return true;
  }
  const withoutLinks = normalized.replace(/\[[^\]]+\]\([^)]+\)/g, '').replace(/[*_`>#-]/g, '').trim();
  return withoutLinks.length < 80 && /(?:下载|保存|附件|file|download|saved|generated)/i.test(withoutLinks);
}

function extractExplicitFileContent(text: string): string | null {
  const labeled = text.match(/(?:content|text|内容|正文)\s*[:：]\s*([\s\S]+)$/i);
  if (labeled?.[1]?.trim()) return labeled[1].trim();

  const wantsLiteralInput = /以下内容|下面内容|exact\s+(?:text|content)|verbatim|原文|原样|一字不改|按原样|不改动|save\s+(?:this|exact)\s+text/i.test(text);
  if (!wantsLiteralInput) return null;

  const idx = Math.max(text.lastIndexOf(':'), text.lastIndexOf('：'));
  if (idx >= 0 && idx < text.length - 1) {
    const tail = text.slice(idx + 1).trim();
    if (tail) return tail;
  }

  return null;
}

export class Engine {
  private ai: AIClient;
  private router: IntentRouter;
  private skills: SkillsEngine;
  private meta: MetaAgent;
  private goals: GoalEngine;
  private planner: GoalPlanner;
  private autoLearn: AutoLearn;
  private desktop: DesktopController;
  private desktopVision: AIDesktopVision | null = null;
  private projectBuilder: ProjectBuilder;
  private cronEngine: CronEngine | null = null;
  private usageTracker: UsageTracker | null = null;
  private ragEngine: RAGEngine | null = null;
  private evolution: EvolutionEngine | null = null;
  private crewOrchestrator: CrewOrchestrator | null = null;

  private getHistory?: (userId: string, platform: string, limit: number, conversationId?: string) => Promise<Message[]>;
  private saveMessage?: (userId: string, platform: string, role: string, content: string, metadata?: any) => Promise<void>;
  private getUserKnowledge?: (userId: string) => Promise<string>;
  private getUserTasks?: (userId: string) => Promise<string>;
  private getUserServers?: (userId: string) => Promise<string>;
  private learnFromConversation?: (userId: string, userMessage: string, agentResponse: string) => Promise<void>;
  private getKnowledgeCount?: (userId: string) => Promise<number>;
  private getCrossPlatformSummary?: (userId: string, platform: string) => Promise<string>;

  constructor() {
    this.ai = new AIClient();
    this.router = new IntentRouter(this.ai);
    this.skills = new SkillsEngine();
    this.meta = new MetaAgent(this.ai);
    this.goals = new GoalEngine();
    this.planner = new GoalPlanner(this.ai);
    this.autoLearn = new AutoLearn(this.ai);
    this.desktop = new DesktopController();
    if (this.desktop.isEnabled()) {
      this.desktopVision = new AIDesktopVision(this.ai, this.desktop);
      logger.info('Desktop control + AI vision enabled');
    }
    this.projectBuilder = new ProjectBuilder();
    initTools();
    logger.info('Project Builder initialized');
  }

  async initSkills() {
    await this.skills.init();
  }

  getSkillsEngine(): SkillsEngine { return this.skills; }
  getAIClient(): AIClient { return this.ai; }
  getMetaAgent(): MetaAgent { return this.meta; }
  getGoalEngine(): GoalEngine { return this.goals; }
  getGoalPlanner(): GoalPlanner { return this.planner; }
  getDesktopController(): DesktopController { return this.desktop; }
  getProjectBuilder(): ProjectBuilder { return this.projectBuilder; }
  setCronEngine(cron: CronEngine) { this.cronEngine = cron; }
  setUsageTracker(tracker: UsageTracker) { this.usageTracker = tracker; }
  setRAGEngine(rag: RAGEngine) { this.ragEngine = rag; }
  getCronEngine(): CronEngine | null { return this.cronEngine; }
  getUsageTracker(): UsageTracker | null { return this.usageTracker; }
  getRAGEngine(): RAGEngine | null { return this.ragEngine; }
  setEvolutionEngine(evo: EvolutionEngine) { this.evolution = evo; }
  getEvolutionEngine(): EvolutionEngine | null { return this.evolution; }
  setCrewOrchestrator(crew: CrewOrchestrator) { this.crewOrchestrator = crew; }
  getCrewOrchestrator(): CrewOrchestrator | null { return this.crewOrchestrator; }

  /**
   * Smart crew detection — decides if multiple agents are needed and WHY.
   * Rules:
   *   1. Short messages (<200 chars) → NEVER crew (single agent handles it)
   *   2. Simple questions/greetings → NEVER crew
   *   3. Only crew when multiple DISTINCT domains are detected
   *   4. Log the reason so user understands why agents were activated
   */
  private shouldUseCrew(intent: string, text: string, _agentId: string): {
    id: string; name: string; mode: 'sequential' | 'hierarchical' | 'ensemble';
    members: Array<{ agentId: string; role?: string }>; task: string;
    reason: string;
  } | null {
    if (!this.crewOrchestrator) return null;

    // Rule 1: Short messages → single agent always
    if (text.length < 200) return null;

    // Rule 2: Simple patterns → single agent
    const isQuestion = /^(מה|יש|תבדוק|איך|למה|כמה|what|is there|check|status|how|why|when|who|where|tell me|show me|explain)/i.test(text.trim());
    if (isQuestion && text.length < 400) return null;

    const lowerText = text.toLowerCase();

    // Rule 3: Detect distinct task domains
    const domains = {
      research: /research|חקור|analyze|analys|נתח|investigate|survey|compare/i.test(lowerText),
      build: /build|בנה|create|צור|implement|develop|write code|תכתוב|תבנה/i.test(lowerText),
      trade: /trade|signal|מסחר|סיגנל|portfolio|crypto|bitcoin|שוק/i.test(lowerText),
      security: /secur|audit|vulnerab|אבטח|penetr|pentest/i.test(lowerText),
      review: /review|בדוק|check|סקור|test|בדיקה/i.test(lowerText),
      content: /write article|כתוב מאמר|blog|presentation|מצגת|document/i.test(lowerText),
    };

    const activeDomains = Object.entries(domains).filter(([, active]) => active);

    // Need at least 2 distinct domains for crew
    if (activeDomains.length < 2) {
      // Special case: explicit orchestrate intent with complex multi-step task
      if ((intent === 'orchestrate' || intent === 'autonomous_task') && text.length > 120) {
        const hasMultipleSteps = /\d+\.\s|then\s|ואז\s|אחר כך|step\s?\d|first.*then|קודם.*אחר/i.test(text);
        const looksLikeExecutionRequest = /继续处理|继续执行|直接执行|直接处理|自动处理|自动执行|帮我完成|帮我处理|请直接执行任务|task mode|run.*autonomously|execute.*task|do this yourself/i.test(lowerText);
        if (hasMultipleSteps || looksLikeExecutionRequest) {
          const reason = intent === 'autonomous_task'
            ? 'Autonomous execution task detected'
            : 'Multi-step orchestration task detected';
          logger.info('Crew activated', { reason, textLength: text.length });
          return {
            id: `crew_${Date.now()}`, name: intent === 'autonomous_task' ? 'Task Execution Crew' : 'Orchestration Crew', mode: 'hierarchical',
            members: [
              { agentId: intent === 'autonomous_task' ? 'task-executor' : 'orchestrator', role: 'leader' },
              { agentId: 'researcher', role: 'research' },
              { agentId: 'code-assistant', role: 'implementation' },
            ],
            task: text, reason,
          };
        }
      }
      return null;
    }

    // Build crew based on detected domains
    const domainNames = activeDomains.map(([name]) => name);
    const reason = `Multi-domain task: ${domainNames.join(' + ')}`;
    logger.info('Crew activated', { reason, domains: domainNames, textLength: text.length });

    // Research + Build → sequential
    if (domains.research && domains.build) {
      return {
        id: `crew_${Date.now()}`, name: 'Research & Build', mode: 'sequential',
        members: [
          { agentId: 'researcher', role: 'research' },
          { agentId: 'code-assistant', role: 'build' },
        ],
        task: text, reason,
      };
    }

    // Research + Trade → sequential
    if (domains.research && domains.trade) {
      return {
        id: `crew_${Date.now()}`, name: 'Research & Trade', mode: 'sequential',
        members: [
          { agentId: 'researcher', role: 'research' },
          { agentId: 'crypto-analyst', role: 'analysis' },
        ],
        task: text, reason,
      };
    }

    // Review + Security → ensemble
    if (domains.review && domains.security) {
      return {
        id: `crew_${Date.now()}`, name: 'Security Review', mode: 'ensemble',
        members: [
          { agentId: 'code-assistant', role: 'code-review' },
          { agentId: 'security-guard', role: 'security-review' },
        ],
        task: text, reason,
      };
    }

    // Generic multi-domain → hierarchical with orchestrator
    return {
      id: `crew_${Date.now()}`, name: `Multi-Domain (${domainNames.join('+')})`, mode: 'hierarchical',
      members: [
        { agentId: 'orchestrator', role: 'leader' },
        ...activeDomains.slice(0, 3).map(([domain]) => ({
          agentId: domain === 'trade' ? 'crypto-analyst'
            : domain === 'security' ? 'security-guard'
            : domain === 'research' ? 'researcher'
            : 'code-assistant',
          role: domain,
        })),
      ],
      task: text, reason,
    };
  }

  /**
   * Quick mode — minimal processing for fast responses.
   * Skips: intent classification (AI call), meta-agent think, crew detection, full context loading.
   * Only loads: recent history + sends directly to AI.
   */
  private async processQuick(incoming: IncomingMessage, startTime: number): Promise<OutgoingMessage | null> {
    const _origSave = this.saveMessage;
    if (_origSave && incoming.conversationId) {
      this.saveMessage = async (userId, platform, role, content, metadata?) => {
        await _origSave(userId, platform, role, content, { ...metadata, _conversationId: incoming.conversationId });
      };
    }

    try {
      // Quick mode also gets message guard protection
      const quickGuard = guardScanMessage(incoming.text, incoming.userId);
      if (quickGuard.blocked) {
        logger.error('Quick message BLOCKED by guard', { userId: incoming.userId, score: quickGuard.score });
        return { text: '⛔ ההודעה נחסמה על ידי מערכת האבטחה.', format: 'text', agentUsed: 'message-guard', provider: 'local' };
      }

      incoming.onProgress?.({ type: 'status', message: '⚡ Quick mode — fast response' });

      // File save/export/attachment requests require tool execution.
      // Quick mode cannot execute tools, so force upgrade to full mode.
      const lowerText = incoming.text.toLowerCase();
      const fileActionHints = [
        'save', 'export', 'download', 'attachment', 'attach', 'send file', 'write to', 'file path', 'directory', 'folder',
        '/data/gongxiang', '\\\\192.168.1.99\\gongxiang', 'gongxiang',
        '保存', '另存', '导出', '下载', '附件', '发送文件', '保存到', '路径', '目录', '文件夹', '共享',
      ];
      const requiresFileTool = fileActionHints.some(hint => incoming.text.includes(hint) || lowerText.includes(hint));
      if (requiresFileTool) {
        logger.info('Quick mode upgrade → auto (file action request)', { userId: incoming.userId });
        incoming.onProgress?.({ type: 'status', message: '📎 File request detected — switching to full mode' });
        return null;
      }

      // Load history (enough for conversation continuity)
      const rawHistory = this.getHistory ? await this.getHistory(incoming.userId, incoming.platform, 20, incoming.conversationId) : [];
      const history = rawHistory.filter(m => {
        if (typeof m.content === 'string') return m.content.trim().length > 0;
        if (Array.isArray(m.content)) return m.content.length > 0;
        return false;
      });

      // Use keyword classification (instant, no AI call)
      const keywordRouting = (this.router as any).keywordClassify?.(incoming.text);
      const agentId = keywordRouting?.agentId ?? 'general';
      const agent = getAgent(agentId) ?? getAgent('general')!;
      if (agent.id === 'task-executor') {
        await audit(incoming.userId, 'task_executor.dispatched', {
          intent: keywordRouting?.intent ?? Intent.AUTONOMOUS_TASK,
          agentId: agent.id,
          responseMode: 'quick',
          textPreview: incoming.text.slice(0, 300),
        }, incoming.platform);
      }

      // Guard: tool-heavy agents (project-builder, code-assistant, server-manager, etc.)
      // should NEVER run in quick mode — they need tool execution. Upgrade to auto.
      const TOOL_HEAVY_AGENTS = ['project-builder', 'code-assistant', 'server-manager', 'web-agent', 'ai-app-builder', 'desktop-controller', 'device-controller', 'content-creator'];
      if (TOOL_HEAVY_AGENTS.includes(agent.id)) {
        logger.info('Quick mode upgrade → auto (tool-heavy agent)', { agent: agent.id });
        return null; // Signal caller to re-process in auto mode
      }

      // Minimal system prompt — no full context loading
      const lastMsgStr = incoming.text;
      const hasHebrew = /[\u0590-\u05FF]/.test(lastMsgStr);
      const minimalPrompt = `${agent.systemPrompt}\n\nUser: ${incoming.userName} | Platform: ${incoming.platform}${hasHebrew ? '\nThe user speaks Hebrew — respond in Hebrew.' : ''}`;

      // Build messages
      const trimmedHistory = trimHistoryToFit(history, 8000);
      const messages: Message[] = [...trimmedHistory, { role: 'user', content: incoming.text }];

      // Select provider — for quick mode, prefer fast API providers over CLI
      const { resolved: resolvedMode } = this.ai.getProviderMode();
      const claudeCodeActive = this.ai.getAvailableProviders().includes('claude-code');
      const hasOpenRouter = this.ai.getAvailableProviders().includes('openrouter');
      const hasAnthropic = this.ai.getAvailableProviders().includes('anthropic');
      const hasOpenAI = this.ai.getAvailableProviders().includes('openai');
      logger.info('Quick mode provider selection', { resolvedMode, claudeCodeActive, hasOpenRouter, hasAnthropic, hasOpenAI, providers: this.ai.getAvailableProviders() });
      let selectedProvider: 'anthropic' | 'openrouter' | 'openai' | 'claude-code' | 'ollama' | undefined;
      let selectedModelId: string | undefined;

      // User model override from UI selector
      const userModelOverride = incoming.model && incoming.model !== 'auto'
        ? findModel(incoming.model) : null;

      if (incoming.model === 'claude-code-cli') {
        selectedProvider = 'claude-code';
        selectedModelId = undefined;
      } else if (userModelOverride) {
        selectedProvider = userModelOverride.provider as typeof selectedProvider;
        selectedModelId = userModelOverride.id;
        logger.info('Model override from UI (quick)', { model: userModelOverride.name });
      } else if (resolvedMode === 'local' && config.OLLAMA_ENABLED) {
        selectedProvider = 'ollama';
        selectedModelId = config.OLLAMA_DEFAULT_MODEL;
      } else if (resolvedMode === 'max' && claudeCodeActive) {
        // MAX mode: Claude Code CLI for ALL requests (FREE — Max subscription)
        selectedProvider = 'claude-code';
        selectedModelId = undefined;
        incoming.onProgress?.({ type: 'status', message: '⚡ Claude Code CLI (FREE)' });
      } else if (hasAnthropic) {
        selectedProvider = 'anthropic';
        selectedModelId = 'claude-haiku-4-5-20251001';
        incoming.onProgress?.({ type: 'status', message: '⚡ Fast API — Haiku' });
      } else if (hasOpenRouter) {
        // Economy/fallback: use OpenRouter when no better provider available
        const isSimpleTask = incoming.text.length < 200 && !incoming.text.toLowerCase().includes('code') && !incoming.text.toLowerCase().includes('build');
        if (isSimpleTask && config.PREFER_FREE_MODELS) {
          const { QUICK_MODE_CHEAP_MODELS } = await import('./model-router.js');
          selectedProvider = 'openrouter';
          selectedModelId = QUICK_MODE_CHEAP_MODELS[0] ?? 'meta-llama/llama-3.1-8b-instruct';
          incoming.onProgress?.({ type: 'status', message: `⚡ Free/Cheap — ${selectedModelId}` });
        } else {
          selectedProvider = 'openrouter';
          selectedModelId = config.OPENROUTER_DEFAULT_MODEL ?? 'anthropic/claude-sonnet-4.6';
          incoming.onProgress?.({ type: 'status', message: `⚡ Fast API — ${selectedModelId}` });
        }
      } else if (hasOpenAI) {
        selectedProvider = 'openai';
        selectedModelId = (config.MODEL_OVERRIDE || config.AI_MODEL || 'gpt-4o-mini').replace(/^openai\//, '');
        incoming.onProgress?.({ type: 'status', message: `⚡ Fast API — ${selectedModelId}` });
      } else if (claudeCodeActive) {
        // Fallback to Claude Code CLI if nothing else available
        selectedProvider = 'claude-code';
        selectedModelId = undefined;
      } else {
        selectedProvider = 'anthropic';
        selectedModelId = config.AI_MODEL;
      }

      // Direct AI call — no tools, no thinking mode, just fast response
      const response = await this.ai.chat({
        systemPrompt: minimalPrompt,
        messages,
        maxTokens: agent.maxTokens,
        temperature: agent.temperature,
        ...(selectedModelId ? { model: selectedModelId } : {}),
        ...(selectedProvider ? { provider: selectedProvider } : {}),
      });

      // Empty response fallback
      if (!response.content || response.content.trim().length === 0) {
        response.content = 'קיבלתי את ההודעה שלך אבל לא הצלחתי לעבד אותה. נסה שוב 🔄';
      }

      // Safety net: strip raw <tool_call> blocks that leaked into text output
      // This happens when the LLM tries to use tools but quick mode doesn't execute them
      if (response.content.includes('<tool_call>') || response.content.includes('"name":') && response.content.includes('"arguments":')) {
        response.content = response.content
          .replace(/<tool_call>\s*\n?\{[\s\S]*?\}\s*\n?<\/tool_call>/g, '')
          .replace(/<tool_result>[\s\S]*?<\/tool_result>/g, '')
          .trim();
        if (response.content.length < 20) {
          response.content = 'מעבד את הבקשה שלך... הבקשה הזו דורשת כלים מיוחדים. שולח שוב במצב מלא. 🔧';
        }
      }

      // Save messages
      if (this.saveMessage) {
        if (incoming.text) {
          await this.saveMessage(incoming.userId, incoming.platform, 'user', incoming.text, { mode: 'quick' });
        }
        if (response.content) {
          await this.saveMessage(incoming.userId, incoming.platform, 'assistant', response.content, {
            agent: agent.id, provider: response.provider, mode: 'quick',
          });
        }
      }

      // Background learning (non-blocking)
      if (this.learnFromConversation) {
        this.learnFromConversation(incoming.userId, incoming.text, response.content).catch(() => {});
      }

      const duration = Date.now() - startTime;
      logger.info('Quick mode response', { agent: agent.id, provider: response.provider, duration });
      pushActivity('response', `[quick:${agent.id}] ${response.content.slice(0, 80)}...`, { agent: agent.id, platform: incoming.platform });

      // ── Social Engineering Detection (Gemini recommendation) ──
      // High severity = block response entirely (Claude's feedback: warn-only is not enough)
      const seCheck = detectSocialEngineering(response.content);
      if (seCheck.detected && seCheck.severity === 'high') {
        logger.error('HIGH social engineering BLOCKED in quick response', { agent: agent.id, patterns: seCheck.patterns });
        return {
          text: '⛔ Response blocked — high-severity social engineering detected. The agent attempted to manipulate you into bypassing security controls.',
          format: 'text',
          agentUsed: `quick:${agent.id}:BLOCKED`,
          provider: response.provider,
        };
      }
      if (seCheck.detected) {
        logger.warn('Social engineering detected in quick response', { agent: agent.id, severity: seCheck.severity, patterns: seCheck.patterns });
      }

      // Format model name for display
      const modelDisplay = response.modelUsed ?? selectedModelId ?? 'default';
      const modelName = modelDisplay
        .replace(/^anthropic\//, '')
        .replace(/^openai\//, '')
        .replace(/^meta-llama\//, 'Llama ')
        .replace(/^google\//, '')
        .replace(/^qwen\//, 'Qwen ')
        .replace(/^deepseek\//, 'DeepSeek ')
        .replace(/^z-ai\//, 'GLM ')
        .replace(/:free$/, ' (Free)')
        .split('/')
        .pop() || modelDisplay;

      return {
        text: redactSecrets(response.content),
        format: 'markdown',
        agentUsed: `quick:${agent.id}`,
        tokensUsed: response.usage ? { input: response.usage.inputTokens, output: response.usage.outputTokens } : undefined,
        provider: response.provider,
        modelUsed: response.modelUsed ?? selectedModelId,
        modelDisplay: modelName, // Human-readable model name
        elapsed: Math.round((Date.now() - startTime) / 1000),
      };
    } catch (error: any) {
      logger.error('Quick mode error', { error: error.message });
      const msg = error.message ?? '';
      // User-friendly error messages in Hebrew
      if (msg.includes('timed out') || msg.includes('timeout')) {
        return { text: '⏰ Claude Code CLI עמוס מדי (timeout). נסה שוב בעוד רגע, או הגדר ANTHROPIC_API_KEY ב-.env לגישה ישירה.', format: 'text' };
      }
      if (msg.includes('402') || msg.includes('Insufficient credits')) {
        return { text: '💳 אין קרדיטים ב-OpenRouter ו-Claude Code CLI לא זמין. הגדר ANTHROPIC_API_KEY ב-.env.', format: 'text' };
      }
      if (msg.includes('No providers available')) {
        return { text: '🔌 אין providers זמינים. הגדר ANTHROPIC_API_KEY ב-.env או טען קרדיטים ב-OpenRouter.', format: 'text' };
      }
      return { text: `❌ שגיאה: ${msg.slice(0, 150)}`, format: 'text' };
    } finally {
      if (_origSave) this.saveMessage = _origSave;
    }
  }

  setMemoryFunctions(fns: {
    getHistory: Engine['getHistory'];
    saveMessage: Engine['saveMessage'];
    getUserKnowledge: Engine['getUserKnowledge'];
    getUserTasks?: Engine['getUserTasks'];
    getUserServers?: Engine['getUserServers'];
    learnFromConversation?: Engine['learnFromConversation'];
    getKnowledgeCount?: Engine['getKnowledgeCount'];
    getCrossPlatformSummary?: Engine['getCrossPlatformSummary'];
  }) {
    this.getHistory = fns.getHistory;
    this.saveMessage = fns.saveMessage;
    this.getUserKnowledge = fns.getUserKnowledge;
    this.getUserTasks = fns.getUserTasks;
    this.getUserServers = fns.getUserServers;
    this.learnFromConversation = fns.learnFromConversation;
    this.getKnowledgeCount = fns.getKnowledgeCount;
    this.getCrossPlatformSummary = fns.getCrossPlatformSummary;
  }

  async process(incoming: IncomingMessage): Promise<OutgoingMessage> {
    const startTime = Date.now();
    logger.info('Processing message', { platform: incoming.platform, userId: incoming.userId, textLength: incoming.text.length });
    pushActivity('message', `${incoming.userName}: ${incoming.text.slice(0, 80)}${incoming.text.length > 80 ? '...' : ''}`, { platform: incoming.platform });

    // ── 0. Mode-switch command detection ──
    const modeCmd = detectModeCommand(incoming.text);
    if (modeCmd) {
      userModeOverrides.set(incoming.userId, modeCmd);
      const modeNames: Record<ResponseMode, string> = { quick: 'מהיר (Quick)', auto: 'אוטומטי (Auto)', deep: 'מעמיק (Deep)' };
      const responseText = `מצב ${modeNames[modeCmd]} הופעל.\n\n• **מהיר** — תגובה מהירה בלי סוכנים, מתאים לשיחה רגילה\n• **אוטומטי** — המערכת מחליטה מתי להפעיל סוכנים\n• **מעמיק** — כל הסוכנים פעילים, ניתוח מלא`;
      if (this.saveMessage) {
        await this.saveMessage(incoming.userId, incoming.platform, 'user', incoming.text);
        await this.saveMessage(incoming.userId, incoming.platform, 'assistant', responseText);
      }
      return { text: responseText, format: 'markdown', agentUsed: 'system', provider: 'local' };
    }

    // ── 0a. Message Guard — pre-AI security scan ──
    const guardResult = guardScanMessage(incoming.text, incoming.userId);
    if (guardResult.blocked) {
      logger.error('Message BLOCKED by message guard', {
        userId: incoming.userId,
        score: guardResult.score,
        flags: guardResult.flags.slice(0, 5),
      });
      return {
        text: '⛔ ההודעה נחסמה על ידי מערכת האבטחה. זוהו דפוסים חשודים בתוכן.',
        format: 'text',
        agentUsed: 'message-guard',
        provider: 'local',
      };
    }
    if (!guardResult.safe) {
      logger.warn('Message flagged by message guard', {
        userId: incoming.userId,
        score: guardResult.score,
        flags: guardResult.flags.slice(0, 5),
      });
    }

    // ── 0b. Determine response mode ──
    const userMode = incoming.responseMode ?? userModeOverrides.get(incoming.userId) ?? 'auto';
    const effectiveMode = userMode === 'auto' ? autoDetectMode(incoming.text) : userMode;
    logger.info('Response mode', { userMode, effectiveMode, textLength: incoming.text.length });

    // Wrap saveMessage to auto-inject conversationId from the incoming message
    const _origSave = this.saveMessage;
    if (_origSave && incoming.conversationId) {
      this.saveMessage = async (userId, platform, role, content, metadata?) => {
        await _origSave(userId, platform, role, content, { ...metadata, _conversationId: incoming.conversationId });
      };
    }

    try {
      // ── QUICK MODE: Minimal processing — skip intent classification, meta-agent, crew ──
      // processQuick returns null if the agent needs tools → fall through to auto mode
      if (effectiveMode === 'quick') {
        const quickResult = await this.processQuick(incoming, startTime);
        if (quickResult !== null) return quickResult;
        logger.info('Quick mode escalated to auto — agent requires tool execution');
        // Fall through to full auto processing below
      }

      // 1. Load conversation history (filter out empty messages that would cause API errors)
      const rawHistory = this.getHistory ? await this.getHistory(incoming.userId, incoming.platform, 20, incoming.conversationId) : [];
      const history = rawHistory.filter(m => {
        if (typeof m.content === 'string') return m.content.trim().length > 0;
        if (Array.isArray(m.content)) return m.content.length > 0;
        return false;
      });

      // 2. Classify intent (using history for context)
      incoming.onProgress?.({ type: 'status', message: '🔀 Router — classifying intent...' });
      const contextSummary = history.slice(-6).map(m => `${m.role}: ${m.content.slice(0, 200)}`).join('\n');
      const routing = await this.router.classify(incoming.text, contextSummary);
      logger.info('Intent classified', { intent: routing.intent, confidence: routing.confidence, agent: routing.agentId });
      incoming.onProgress?.({ type: 'status', message: `🔀 Router → ${routing.agentId} (${Math.round(routing.confidence * 100)}%)` });

      // 2a. Desktop control — intercept before normal AI flow
      if (
        (routing.intent === Intent.DESKTOP_CONTROL || routing.intent === Intent.DESKTOP_SCREENSHOT) &&
        this.desktopVision
      ) {
        // Approval gate — desktop control is high-risk
        // Auto-approve for authenticated users on any platform (they explicitly typed the command)
        let approved = ['web', 'whatsapp', 'telegram', 'discord'].includes(incoming.platform);
        if (approved) {
          incoming.onProgress?.({ type: 'status', message: `Auto-approved desktop control (${incoming.platform} user)` });
          logger.info('Approval auto-granted for authenticated user', { userId: incoming.userId, action: `desktop:${routing.intent}` });
        } else {
          const gate = getApprovalGate();
          approved = await gate.requestApproval({
            agentId: routing.agentId ?? 'desktop-controller',
            action: `desktop:${routing.intent}`,
            description: `Desktop control: ${incoming.text.slice(0, 200)}`,
            riskCategory: 'desktop_control',
            riskScore: 0.8,
            timeoutMs: 60_000,
          });
        }
        if (!approved) {
          return {
            text: 'Desktop control action was not approved. The request timed out or was denied.',
            format: 'text',
            agentUsed: 'approval-gate',
          };
        }

        const result = await this.desktopVision.executeTask(incoming.text, incoming.userId);
        const responseText = result.success
          ? `${result.summary}\n\n(${result.steps} step${result.steps !== 1 ? 's' : ''} executed)`
          : `Desktop task failed: ${result.summary}`;

        if (this.saveMessage) {
          await this.saveMessage(incoming.userId, incoming.platform, 'user', incoming.text, { intent: routing.intent });
          await this.saveMessage(incoming.userId, incoming.platform, 'assistant', responseText, { agent: 'desktop-controller' });
        }

        return {
          text: responseText,
          format: 'markdown',
          agentUsed: 'desktop-controller',
          provider: 'local',
        };
      }

      // 2b. Project Builder — intercept build_project intent
      if (routing.intent === Intent.BUILD_PROJECT) {
        // Approval gate — building projects creates files/directories
        // Auto-approve for authenticated users on any platform (they explicitly typed the command)
        let approved = ['web', 'whatsapp', 'telegram', 'discord'].includes(incoming.platform);
        if (approved) {
          incoming.onProgress?.({ type: 'status', message: `Auto-approved project build (${incoming.platform} user)` });
          logger.info('Approval auto-granted for authenticated user', { userId: incoming.userId, action: 'build_project' });
        } else {
          const gate = getApprovalGate();
          approved = await gate.requestApproval({
            agentId: routing.agentId ?? 'project-builder',
            action: 'build_project',
            description: `Build project: ${incoming.text.slice(0, 200)}`,
            riskCategory: 'filesystem_write',
            riskScore: 0.6,
            timeoutMs: 120_000,
          });
        }
        if (!approved) {
          return {
            text: 'Project build was not approved. The request timed out or was denied.',
            format: 'text',
            agentUsed: 'approval-gate',
          };
        }

        // Game requests → skip template system, go straight to agentic flow with tools
        // The project-builder agent has file + bash tools and game-building instructions in its prompt
        const isGameRequest = /\b(game|games|משחק|משחקים|phaser|arcade|shooter|platformer|puzzle|snake|tetris|pong|breakout|runner)\b/i.test(incoming.text);
        if (!isGameRequest) {
          const templates = this.projectBuilder.getTemplateList();
          const templateList = templates.map(t => `- **${t.id}**: ${t.name} — ${t.description} (${t.stack})`).join('\n');
          const projects = await this.projectBuilder.listProjects();
          const projectList = projects.length > 0 ? `\n\nExisting projects: ${projects.join(', ')}` : '';

          // Use AI to decide what to build based on user request
          const planResponse = await this.ai.chat({
            systemPrompt: `You are ClawdAgent's Project Builder. The user wants to build something. Analyze their request and respond with a JSON plan.

Available templates:
${templateList}
${projectList}

Respond with ONLY valid JSON:
{"action":"scaffold"|"list"|"status"|"logs","templateId":"<id>","projectName":"<name>","description":"<desc>","port":3001}

If the user just wants to see templates or projects, use action "list".
If they want to check a running project, use "status" with projectName.`,
            messages: [{ role: 'user', content: incoming.text }],
            maxTokens: 300,
            temperature: 0.2,
          });

          try {
            const plan = extractJSON(planResponse.content);

            let responseText: string;
            if (plan.action === 'list') {
              responseText = `**Available Templates:**\n${templateList}${projectList}`;
            } else if (plan.action === 'status') {
              const status = await this.projectBuilder.getStatus(plan.projectName);
              responseText = `Project **${plan.projectName}**: ${status}`;
            } else if (plan.action === 'logs') {
              const logs = await this.projectBuilder.getLogs(plan.projectName);
              responseText = `**Logs for ${plan.projectName}:**\n\`\`\`\n${logs}\n\`\`\``;
            } else {
              const result = await this.projectBuilder.fullPipeline(
                plan.templateId, plan.projectName, plan.port ?? 3001,
                { description: plan.description ?? '' },
              );
              const parts = [`**Scaffold:** ${result.scaffold.message}`];
              if (result.install) parts.push(`**Install:** ${result.install.message}`);
              if (result.build) parts.push(`**Build:** ${result.build.message}`);
              if (result.docker) parts.push(`**Docker:** ${result.docker.message}`);
              if (result.deploy) parts.push(`**Deploy:** ${result.deploy.message}`);
              responseText = parts.join('\n');
            }

            if (this.saveMessage) {
              await this.saveMessage(incoming.userId, incoming.platform, 'user', incoming.text, { intent: routing.intent });
              await this.saveMessage(incoming.userId, incoming.platform, 'assistant', responseText, { agent: 'project-builder' });
            }

            return { text: responseText, format: 'markdown', agentUsed: 'project-builder', provider: 'local' };
          } catch {
            // Fall through to normal AI flow if JSON parsing fails
          }
        } else {
          logger.info('Game build request — using agentic flow with file tool', { text: incoming.text.slice(0, 80) });
          incoming.onProgress?.({ type: 'status', message: '🎮 Game Builder — preparing agentic flow with file tool...' });
          // Fall through to normal AI flow — project-builder agent will use file tool
        }
      }

      // 2c-pre. Reminder — intercept one-time reminders via BullMQ delayed job
      if (routing.intent === Intent.REMINDER_SET) {
        try {
          const parseResponse = await this.ai.chat({
            systemPrompt: `Parse this reminder request. Respond with ONLY valid JSON:\n{"delayMinutes":<number>,"message":"<reminder text>"}\nExamples: "remind me in 5 minutes to call" → {"delayMinutes":5,"message":"Call"}\n"שלח לי הודעה בעוד דקה" → {"delayMinutes":1,"message":"תזכורת"}\n"remind me tomorrow" → {"delayMinutes":1440,"message":"Reminder"}`,
            messages: [{ role: 'user', content: incoming.text }],
            maxTokens: 200, temperature: 0.1,
          });
          const plan = extractJSON<{ delayMinutes: number; message: string }>(parseResponse.content);
          const delayMs = Math.max(1, plan.delayMinutes) * 60 * 1000;
          await scheduleReminder({ userId: incoming.userId, message: plan.message, platform: incoming.platform }, delayMs);
          const responseText = `⏰ תזכורת נקבעה בעוד ${plan.delayMinutes} דקות: "${plan.message}"`;
          if (this.saveMessage) {
            await this.saveMessage(incoming.userId, incoming.platform, 'user', incoming.text, { intent: routing.intent });
            await this.saveMessage(incoming.userId, incoming.platform, 'assistant', responseText, { agent: 'reminder' });
          }
          return { text: responseText, format: 'markdown' as const, agentUsed: 'reminder', provider: 'local' };
        } catch { /* fall through to normal AI */ }
      }

      // 2c. Schedule / Cron — intercept
      if (routing.intent === Intent.SCHEDULE && this.cronEngine) {
        try {
          const parseResponse = await this.ai.chat({
            systemPrompt: `Parse this scheduling request. Respond with ONLY valid JSON:\n{"action":"add"|"list"|"remove","name":"<task name>","schedule":"<natural language or cron>","message":"<what to send>","taskId":"<id for remove>"}`,
            messages: [{ role: 'user', content: incoming.text }],
            maxTokens: 300, temperature: 0.1,
          });
          const plan = extractJSON(parseResponse.content);
          let responseText: string;
          if (plan.action === 'list') {
            const tasks = this.cronEngine.listTasks();
            responseText = tasks.length === 0 ? 'No scheduled tasks.'
              : tasks.map(t => `- **${t.name}** (\`${t.expression}\`) — ${t.enabled ? '✅' : '⏸️'}`).join('\n');
          } else if (plan.action === 'remove') {
            await this.cronEngine.removeTask(plan.taskId);
            responseText = `Removed scheduled task: ${plan.taskId}`;
          } else {
            const expr = parseCronExpression(plan.schedule) ?? '0 9 * * *';
            const task: CronTask = {
              id: `cron_${Date.now()}`, userId: incoming.userId, name: plan.name ?? 'Scheduled task',
              expression: expr, action: 'send_message',
              actionData: { message: plan.message ?? plan.name ?? 'Reminder' },
              platform: incoming.platform, enabled: true, createdAt: new Date().toISOString(),
            };
            await this.cronEngine.addTask(task);
            responseText = `✅ Scheduled: **${task.name}**\nCron: \`${expr}\``;
          }
          if (this.saveMessage) {
            await this.saveMessage(incoming.userId, incoming.platform, 'user', incoming.text, { intent: routing.intent });
            await this.saveMessage(incoming.userId, incoming.platform, 'assistant', responseText, { agent: 'scheduler' });
          }
          return { text: responseText, format: 'markdown' as const, agentUsed: 'scheduler', provider: 'local' };
        } catch { /* fall through to normal AI */ }
      }

      // 2d. Email — intercept
      if (routing.intent === Intent.EMAIL) {
        try {
          const parseResponse = await this.ai.chat({
            systemPrompt: `Parse this email request. Respond with ONLY valid JSON:\n{"action":"send"|"list"|"search","to":"<email>","subject":"<subject>","body":"<body>","query":"<search query>","count":5}`,
            messages: [{ role: 'user', content: incoming.text }],
            maxTokens: 300, temperature: 0.1,
          });
          const plan = extractJSON(parseResponse.content);
          let responseText: string;
          if (plan.action === 'send') {
            // Approval gate — sending email is irreversible
            // Auto-approve for authenticated users on any platform (they explicitly typed the command)
            let emailApproved = ['web', 'whatsapp', 'telegram', 'discord'].includes(incoming.platform);
            if (emailApproved) {
              incoming.onProgress?.({ type: 'status', message: `Auto-approved email send to ${plan.to} (${incoming.platform} user)` });
              logger.info('Approval auto-granted for authenticated user', { userId: incoming.userId, action: 'email:send' });
            } else {
              const gate = getApprovalGate();
              emailApproved = await gate.requestApproval({
                agentId: routing.agentId ?? 'email',
                action: `email:send`,
                description: `Send email to ${plan.to}: "${(plan.subject ?? '').slice(0, 100)}"`,
                riskCategory: 'outgoing_communication',
                riskScore: 0.6,
                timeoutMs: 120_000,
              });
            }
            if (!emailApproved) {
              return { text: 'Email send was not approved. Action cancelled.', format: 'text' as const, agentUsed: 'approval-gate' };
            }
            const { sendEmail } = await import('../actions/email/gmail.js');
            await sendEmail(plan.to, plan.subject, plan.body);
            responseText = `✅ Email sent to ${plan.to}: "${plan.subject}"`;
          } else if (plan.action === 'search') {
            const { searchEmails } = await import('../actions/email/gmail.js');
            const emails = await searchEmails(plan.query, plan.count ?? 5);
            responseText = emails.length === 0 ? 'No emails found.'
              : emails.map(e => `- **${e.subject}** from ${e.from} (${e.date})\n  ${e.snippet}`).join('\n\n');
          } else {
            const { listEmails } = await import('../actions/email/gmail.js');
            const emails = await listEmails(plan.count ?? 10);
            responseText = emails.length === 0 ? 'Inbox empty.'
              : emails.map(e => `${e.isUnread ? '🔵' : '⚪'} **${e.subject}** — ${e.from}\n  ${e.snippet}`).join('\n\n');
          }
          if (this.saveMessage) {
            await this.saveMessage(incoming.userId, incoming.platform, 'user', incoming.text, { intent: routing.intent });
            await this.saveMessage(incoming.userId, incoming.platform, 'assistant', responseText, { agent: 'email' });
          }
          return { text: responseText, format: 'markdown' as const, agentUsed: 'email', provider: 'local' };
        } catch (err: any) {
          logger.warn('Email intercept failed, falling through', { error: err.message });
        }
      }

      // 2e. Document / RAG — intercept
      if (routing.intent === Intent.DOCUMENT && this.ragEngine) {
        if (incoming.attachments?.length) {
          const results: string[] = [];
          for (const att of incoming.attachments) {
            try {
              const result = await this.ragEngine.ingestDocument(att.url, incoming.userId);
              results.push(`✅ **${result.source}** ingested (${result.chunks} chunks)`);
            } catch (err: any) {
              results.push(`❌ Failed: ${err.message}`);
            }
          }
          const responseText = results.join('\n');
          if (this.saveMessage) {
            await this.saveMessage(incoming.userId, incoming.platform, 'user', incoming.text, { intent: routing.intent });
            await this.saveMessage(incoming.userId, incoming.platform, 'assistant', responseText, { agent: 'rag' });
          }
          return { text: responseText, format: 'markdown' as const, agentUsed: 'rag', provider: 'local' };
        }
        const docs = this.ragEngine.listDocuments(incoming.userId);
        if (incoming.text.match(/list|רשימ|documents|מסמכ/i)) {
          const responseText = docs.length === 0 ? 'No documents stored.'
            : `**Your documents:**\n${docs.map(d => `- ${d}`).join('\n')}\n\n${this.ragEngine.getChunkCount(incoming.userId)} total chunks`;
          if (this.saveMessage) {
            await this.saveMessage(incoming.userId, incoming.platform, 'user', incoming.text, { intent: routing.intent });
            await this.saveMessage(incoming.userId, incoming.platform, 'assistant', responseText, { agent: 'rag' });
          }
          return { text: responseText, format: 'markdown' as const, agentUsed: 'rag', provider: 'local' };
        }
        // Query RAG for context — inject into message and fall through to normal AI
        if (docs.length > 0) {
          const ragContext = await this.ragEngine.query(incoming.text, incoming.userId);
          if (ragContext) {
            incoming.text = `${incoming.text}\n\n--- Relevant documents ---\n${ragContext}`;
          }
        }
      }

      // 2f. Calendar — intercept
      if (routing.intent === Intent.CALENDAR) {
        try {
          const parseResponse = await this.ai.chat({
            systemPrompt: `Parse this calendar request. Respond with ONLY valid JSON:\n{"action":"list"|"create"|"delete","title":"<event>","start":"<ISO datetime>","end":"<ISO datetime>","description":"","eventId":"<id>"}`,
            messages: [{ role: 'user', content: incoming.text }],
            maxTokens: 300, temperature: 0.1,
          });
          const plan = extractJSON(parseResponse.content);
          const { listEvents, createEvent, deleteEvent } = await import('../actions/calendar/google-calendar.js');
          let responseText: string;
          if (plan.action === 'create') {
            const event = await createEvent(plan.title, plan.start, plan.end, plan.description);
            responseText = `✅ Event created: **${event.title}**\n${event.start} → ${event.end}`;
          } else if (plan.action === 'delete') {
            await deleteEvent(plan.eventId);
            responseText = '✅ Event deleted';
          } else {
            const events = await listEvents();
            responseText = events.length === 0 ? 'No upcoming events.'
              : events.map(e => `- **${e.title}**\n  ${e.start} → ${e.end}${e.location ? `\n  📍 ${e.location}` : ''}`).join('\n\n');
          }
          if (this.saveMessage) {
            await this.saveMessage(incoming.userId, incoming.platform, 'user', incoming.text, { intent: routing.intent });
            await this.saveMessage(incoming.userId, incoming.platform, 'assistant', responseText, { agent: 'calendar' });
          }
          return { text: responseText, format: 'markdown' as const, agentUsed: 'calendar', provider: 'local' };
        } catch (err: any) {
          logger.warn('Calendar intercept failed, falling through', { error: err.message });
        }
      }

      // 2g. Usage / Costs — intercept
      if (routing.intent === Intent.USAGE && this.usageTracker) {
        const summary = this.usageTracker.getTodaySummary();
        const monthCost = this.usageTracker.getMonthCost();
        const modelBreakdown = Object.entries(summary.byModel)
          .map(([m, c]) => `  - ${m}: $${c.toFixed(4)}`).join('\n');
        const responseText = `**Usage Summary**\nToday: $${summary.totalCost.toFixed(4)} (${summary.totalCalls} calls)\nMonth: $${monthCost.toFixed(4)}${Object.keys(summary.byModel).length > 0 ? `\n\n**By model:**\n${modelBreakdown}` : ''}\n\nBudget: ${this.usageTracker.isOverBudget() ? '⚠️ Over budget!' : '✅ Within budget'}`;
        if (this.saveMessage) {
          await this.saveMessage(incoming.userId, incoming.platform, 'user', incoming.text, { intent: routing.intent });
          await this.saveMessage(incoming.userId, incoming.platform, 'assistant', responseText, { agent: 'usage' });
        }
        return { text: responseText, format: 'markdown' as const, agentUsed: 'usage', provider: 'local' };
      }

      // 2h. Phone — intercept SMS/call
      if (routing.intent === Intent.PHONE) {
        try {
          const parseResponse = await this.ai.chat({
            systemPrompt: `Parse this phone request. Respond with ONLY valid JSON:\n{"action":"sms"|"call","to":"<phone number with country code>","message":"<message text>"}`,
            messages: [{ role: 'user', content: incoming.text }],
            maxTokens: 200, temperature: 0.1,
          });
          const plan = extractJSON<{ action: string; to: string; message: string }>(parseResponse.content);
          const { getPhoneService } = await import('../actions/phone/twilio.js');
          const phone = await getPhoneService();
          if (!phone.available) throw new Error('Phone service not configured (set TWILIO_* env vars)');
          const result = plan.action === 'call'
            ? await phone.makeCall(plan.to, plan.message)
            : await phone.sendSMS(plan.to, plan.message);
          const responseText = `✅ ${result}`;
          if (this.saveMessage) {
            await this.saveMessage(incoming.userId, incoming.platform, 'user', incoming.text, { intent: routing.intent });
            await this.saveMessage(incoming.userId, incoming.platform, 'assistant', responseText, { agent: 'phone' });
          }
          return { text: responseText, format: 'markdown' as const, agentUsed: 'phone', provider: 'local' };
        } catch (err: any) {
          logger.warn('Phone intercept failed, falling through', { error: err.message });
        }
      }

      // 2i. Meta-agent think step — skip for simple intents AND auto-mode short messages
      const SIMPLE_INTENTS = new Set([
        Intent.GENERAL_CHAT, Intent.HELP, Intent.SETTINGS, Intent.USAGE,
        Intent.TASK_LIST, Intent.REMINDER_SET, Intent.CALENDAR,
        Intent.QUESTION_ANSWER, Intent.REMEMBER, Intent.WHATSAPP_CONNECT,
        Intent.PHONE, Intent.EMAIL,
      ]);
      let metaThinking = '';
      const skipMeta = SIMPLE_INTENTS.has(routing.intent)
        || (effectiveMode === 'auto' && incoming.text.length < 300);  // auto mode skips meta for short messages
      if (!skipMeta) {
        incoming.onProgress?.({ type: 'thinking', message: '💭 Intelligence — meta-agent thinking...' });
        const thought = await this.meta.think(incoming.text, contextSummary);
        metaThinking = thought.situation ?? '';
        if (thought.plan?.length) {
          metaThinking += '\n' + thought.plan.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n');
          incoming.onProgress?.({ type: 'thinking', message: `Plan: ${thought.plan.slice(0, 3).join(' → ')}${thought.plan.length > 3 ? '...' : ''}` });
        }
        logger.info('Meta-agent thought', { situation: thought.situation, confidence: thought.confidence, planSteps: thought.plan?.length ?? 0 });
      } else {
        logger.info('Skipping meta-agent', { intent: routing.intent, mode: effectiveMode, textLength: incoming.text.length });
      }

      // 3. Select agent
      const agent = getAgent(routing.agentId) ?? getAgent('general')!;
      if (routing.intent === Intent.AUTONOMOUS_TASK || agent.id === 'task-executor') {
        await audit(incoming.userId, 'task_executor.dispatched', {
          intent: routing.intent,
          agentId: agent.id,
          responseMode: effectiveMode,
          textPreview: incoming.text.slice(0, 300),
        }, incoming.platform);
      }
      incoming.onProgress?.({ type: 'agent', message: `🤖 ${agent.name} — handling request`, agent: agent.id });

      // 3a. Deep mode — remove token limits, notify user with cost estimate
      if (effectiveMode === 'deep') {
        agent.maxTokens = 16384; // Maximum output for deep mode
        if (agent.maxToolIterations) agent.maxToolIterations = 30; // More tool iterations
        const estimatedCost = ((incoming.text.length / 4) / 1000) * 0.003 + (16384 / 1000) * 0.015; // Rough estimate based on Sonnet pricing
        incoming.onProgress?.({ type: 'status', message: `🔬 Deep mode — max tokens: 16K, tools: ${agent.tools.length}, estimated max cost: ~$${estimatedCost.toFixed(3)}` });
        logger.info('Deep mode activated', { agent: agent.id, maxTokens: 16384, tools: agent.tools.length, estimatedCost: estimatedCost.toFixed(4) });
      }

      // 4. Match skills
      const matchedSkill = this.skills.matchSkill(incoming.text);
      if (matchedSkill) {
        logger.info('Skill matched', { skill: matchedSkill.id, name: matchedSkill.name });
      }

      // 5. Load full context (knowledge, tasks, servers, skills, cross-platform)
      incoming.onProgress?.({ type: 'status', message: '🧠 Engine — loading context & memory...' });
      const [knowledgeStr, tasksStr, serversStr, knowledgeCount, crossPlatformStr] = await Promise.all([
        this.getUserKnowledge ? this.getUserKnowledge(incoming.userId) : '',
        this.getUserTasks ? this.getUserTasks(incoming.userId) : '',
        this.getUserServers ? this.getUserServers(incoming.userId) : '',
        this.getKnowledgeCount ? this.getKnowledgeCount(incoming.userId) : 0,
        this.getCrossPlatformSummary ? this.getCrossPlatformSummary(incoming.userId, incoming.platform) : '',
      ]);

      // ── Intelligence: enrich context with live intelligence data ──
      let evolutionContext: FullContext['evolution'] | undefined;
      if (isBridgeReady() && this.evolution) {
        const intel = getIntelligenceContext();
        evolutionContext = {
          phase: 'active',
          totalSkills: this.skills.getSkillCount(),
          healthIndex: intel.healthIndex,
          governanceBudget: intel.governanceBudget,
          activeGoals: intel.activeGoals,
          pendingSelfTasks: intel.pendingSelfTasks,
          disabledAgents: intel.disabledAgents,
          costToday: intel.costToday,
        };
      }

      const fullContext: FullContext = {
        history,
        knowledge: knowledgeStr,
        pendingTasks: tasksStr,
        servers: serversStr,
        skills: this.skills.getSkillsSummary(),
        activeSkill: matchedSkill ? { name: matchedSkill.name, prompt: matchedSkill.prompt } : null,
        providers: this.ai.getAvailableProviders(),
        knowledgeCount,
        goals: this.goals.getGoalsSummary(incoming.userId),
        crossPlatformActivity: crossPlatformStr || undefined,
        ...(evolutionContext ? { evolution: evolutionContext } : {}),
      };

      // 6. Build system prompt with full context
      const agentTools = agent.tools.filter(t => t !== 'desktop');
      const systemPrompt = buildSystemPromptWithContext(agent.systemPrompt, {
        userName: incoming.userName,
        platform: incoming.platform,
        intent: routing.intent,
        params: routing.extractedParams,
        fullContext,
        activeTools: agentTools,
      });

      // 7. Build message array with history (generous window for continuity)
      const trimmedHistory = trimHistoryToFit(history, 16000);

      // If we had to trim, prepend a summary note so the AI knows there's earlier context
      const messages: Message[] = [];
      if (history.length > trimmedHistory.length) {
        const droppedCount = history.length - trimmedHistory.length;
        messages.push({ role: 'user', content: `[System note: ${droppedCount} earlier messages in this conversation were trimmed for context. The most recent messages follow. If the user references something from earlier, acknowledge you may need them to remind you.]` });
      }
      messages.push(...trimmedHistory, { role: 'user', content: incoming.text });

      // 8. Smart model/provider selection
      //
      // Simple intents (greetings, help, etc.) don't need tools even if the agent has them.
      // This lets us use CLI (FREE) instead of Anthropic API for simple messages.
      const TOOLLESS_INTENTS = new Set([
        Intent.GENERAL_CHAT, Intent.HELP, Intent.SETTINGS,
        Intent.QUESTION_ANSWER, Intent.REMEMBER,
      ]);
      // Deep mode: NEVER skip tools — use all agent capabilities
      const skipTools = effectiveMode === 'deep' ? false : TOOLLESS_INTENTS.has(routing.intent);
      const toolDefs = (!skipTools && agentTools.length > 0) ? getToolDefinitions(agentTools) : [];
      if (skipTools && agentTools.length > 0) {
        logger.info('Skipping tools for simple intent', { intent: routing.intent, agentTools: agentTools.length });
      }

      const lastMsg = messages[messages.length - 1]?.content ?? '';
      const lastMsgStr = typeof lastMsg === 'string' ? lastMsg : '';
      const hasHebrew = /[\u0590-\u05FF]/.test(lastMsgStr);

      let selectedModelId: string | undefined;
      let selectedProvider: 'anthropic' | 'openrouter' | 'claude-code' | 'ollama' | undefined;

      // User model override from UI selector
      const userModelOverride = incoming.model && incoming.model !== 'auto'
        ? findModel(incoming.model) : null;

      // Provider mode drives provider selection
      const { resolved: resolvedMode } = this.ai.getProviderMode();
      const claudeCodeActive = this.ai.getAvailableProviders().includes('claude-code');
      const needsTools = toolDefs.length > 0;
      logger.info('Main mode provider selection', { resolvedMode, claudeCodeActive, providers: this.ai.getAvailableProviders(), userModel: incoming.model });

      if (incoming.model === 'claude-code-cli') {
        // Special: user explicitly selected Claude Code CLI
        selectedProvider = 'claude-code';
        selectedModelId = undefined;
        logger.info('Model override from UI', { model: 'Claude Code CLI (Opus 4.6)', provider: 'claude-code' });
      } else if (userModelOverride) {
        selectedModelId = userModelOverride.id;
        selectedProvider = userModelOverride.provider as typeof selectedProvider;
        logger.info('Model override from UI', { model: userModelOverride.name, provider: userModelOverride.provider, tier: userModelOverride.tier });
      } else if (resolvedMode === 'local' && config.OLLAMA_ENABLED) {
        // LOCAL mode: Ollama-first with per-agent model assignment
        const ollamaModel = resolveOllamaModel(agent.id, agent.preferredOllamaModel);
        if (ollamaModel) {
          // Check if model supports tools when needed
          if (needsTools && !ollamaModel.supportsTools) {
            // Fallback to a tool-capable Ollama model
            const toolModel = resolveOllamaModel(agent.id, config.OLLAMA_TOOL_MODEL);
            selectedModelId = toolModel?.ollamaTag ?? config.OLLAMA_TOOL_MODEL;
            logger.info('Ollama model lacks tool support, using tool model', {
              agent: agent.id, original: ollamaModel.id, fallback: selectedModelId,
            });
          } else {
            selectedModelId = ollamaModel.ollamaTag;
          }
          selectedProvider = 'ollama';
          logger.info('Model selected', {
            provider: 'ollama', mode: 'local', model: ollamaModel.displayName,
            agent: agent.id, supportsTools: ollamaModel.supportsTools,
          });
        } else {
          // No Ollama model mapped — use default Ollama model
          selectedModelId = config.OLLAMA_DEFAULT_MODEL;
          selectedProvider = 'ollama';
          logger.info('Model selected', { provider: 'ollama', mode: 'local', model: selectedModelId, reason: 'default' });
        }
      } else if (resolvedMode === 'max' && claudeCodeActive) {
        // MAX mode: Claude Code CLI for ALL requests (FREE — Max subscription)
        // Tools are embedded in the prompt and tool_call tags are parsed from response
        selectedProvider = 'claude-code';
        selectedModelId = undefined;
        logger.info('Model selected', { provider: 'claude-code', mode: 'max', reason: 'FREE — Max subscription', tools: needsTools ? agentTools.length : 0 });
      } else if (resolvedMode === 'pro') {
        // PRO mode: Anthropic API primary
        selectedProvider = 'anthropic';
        selectedModelId = config.AI_MODEL;
        logger.info('Model selected', { provider: 'anthropic', mode: 'pro', model: config.AI_MODEL });
      } else if (resolvedMode === 'economy') {
        // ECONOMY mode: OpenRouter free models → model router for cost optimization
        const modelOverride = config.MODEL_OVERRIDE;
        if (modelOverride) {
          selectedModelId = modelOverride;
          selectedProvider = modelOverride.includes('/') ? 'openrouter' : 'anthropic';
        } else {
          const complexity = classifyComplexity({
            intent: routing.intent,
            messageLength: lastMsgStr.length,
            hasTools: needsTools,
            requiresHebrew: hasHebrew,
            requiresVision: false,
            isMultiStep: toolDefs.length > 3,
          });

          const selectedModel = selectModel({
            complexity,
            requiresTools: needsTools,
            requiresHebrew: hasHebrew,
            requiresVision: false,
            dailyBudgetLeft: this.usageTracker?.getDailyBudgetLeft() ?? 10,
            preferFree: config.PREFER_FREE_MODELS,
            isSubAgent: false, // Main request — always use strong models
          });

          selectedModelId = selectedModel.id;
          selectedProvider = selectedModel.provider;
          logger.info('Model selected', {
            mode: 'economy', complexity, model: selectedModel.name, tier: selectedModel.tier,
            cost: `$${selectedModel.costPer1kInput}/$${selectedModel.costPer1kOutput}`,
          });
        }
      } else {
        // Fallback: CLI if available, else API
        if (claudeCodeActive) {
          selectedProvider = 'claude-code';
          selectedModelId = undefined;
        } else {
          selectedProvider = 'anthropic';
          selectedModelId = config.AI_MODEL;
        }
        logger.info('Model selected', { provider: selectedProvider, mode: resolvedMode, reason: 'fallback' });
      }

      // ── Adaptive Thinking Mode ──
      // Compute effort level → map to thinking config for supported providers
      const effortLevel = classifyEffort({
        intent: routing.intent,
        complexity: classifyComplexity({
          intent: routing.intent,
          messageLength: lastMsgStr.length,
          hasTools: needsTools,
          requiresHebrew: hasHebrew,
          requiresVision: false,
          isMultiStep: toolDefs.length > 3,
        }),
        messageLength: lastMsgStr.length,
      });
      const thinkingConfig = mapEffortToThinking(effortLevel, selectedProvider ?? 'anthropic');

      // ── Intelligence: set execution context so tool-executor tracks agent/intent/platform ──
      setExecutionContext(agent.id, routing.intent, incoming.platform);

      // ── Crew Orchestrator: detect multi-agent tasks ──
      const crewConfig = this.shouldUseCrew(routing.intent, incoming.text, agent.id);
      if (crewConfig && this.crewOrchestrator) {
        await audit(incoming.userId, 'task_executor.crew_triggered', {
          reason: crewConfig.reason,
          mode: crewConfig.mode,
          crewId: crewConfig.id,
          members: crewConfig.members.map(m => ({ agentId: m.agentId, role: m.role ?? null })),
          taskPreview: crewConfig.task.slice(0, 500),
        }, incoming.platform);
        incoming.onProgress?.({ type: 'status', message: `${crewConfig.reason} → ${crewConfig.mode} crew (${crewConfig.members.map(m => m.agentId).join(', ')})` });
        logger.info('Crew triggered', { reason: crewConfig.reason, mode: crewConfig.mode, members: crewConfig.members.map(m => m.agentId), task: crewConfig.task.slice(0, 80) });
        const crewResult = await this.crewOrchestrator.runCrew(crewConfig);

        if (this.saveMessage) {
          await this.saveMessage(incoming.userId, incoming.platform, 'user', incoming.text, { intent: routing.intent });
          await this.saveMessage(incoming.userId, incoming.platform, 'assistant', crewResult.output, { agent: 'crew', mode: crewConfig.mode });
        }

        return {
          text: crewResult.output,
          format: 'markdown' as const,
          agentUsed: `crew:${crewConfig.mode}`,
          provider: selectedProvider ?? 'anthropic',
        };
      }

      // ── OpenRouter Enhancements ──
      // Apply thinking variant, plugins, and response-healing when going through OpenRouter
      let orPlugins: Array<{ id: string; [key: string]: unknown }> | undefined;
      if (selectedProvider === 'openrouter') {
        // Thinking variant: append :thinking to model ID for high/critical effort
        if ((thinkingConfig as any).useThinkingVariant && selectedModelId) {
          selectedModelId = withVariant(selectedModelId, 'thinking');
        }
        // Response-healing plugin: auto-fix malformed JSON from tool-calling models
        if (needsTools) {
          orPlugins = [{ id: 'response-healing' }];
        }
        // Web plugin: enable web search for agents that have search tools
        if (agentTools.includes('search')) {
          orPlugins = [...(orPlugins || []), { id: 'web' }];
        }
      }

      const providerLabel = selectedProvider === 'claude-code' ? 'Claude Code CLI' : selectedProvider === 'ollama' ? `Ollama (${selectedModelId ?? 'default'})` : selectedProvider === 'openrouter' ? `OpenRouter (${selectedModelId ?? 'default'})` : selectedProvider ?? 'Anthropic';
      incoming.onProgress?.({ type: 'status', message: `⚙️ ${providerLabel} — generating response${needsTools ? ` with ${toolDefs.length} tools` : ''}...` });
      let response;
      if (toolDefs.length > 0) {
        // Agent HAS tools → use chatWithTools (tool execution loop)
        logger.info('Using tool loop', { agent: agent.id, tools: agentTools, toolDefs: toolDefs.length, model: selectedModelId });
        response = await this.ai.chatWithTools(
          {
            systemPrompt,
            messages,
            tools: toolDefs,
            maxTokens: agent.maxTokens,
            temperature: agent.temperature,
            thinkingMode: thinkingConfig.thinkingMode,
            ...(thinkingConfig.thinkingBudget ? { thinkingBudget: thinkingConfig.thinkingBudget } : {}),
            ...(selectedModelId ? { model: selectedModelId } : {}),
            ...(selectedProvider ? { provider: selectedProvider } : {}),
            ...(agent.maxToolIterations ? { maxToolIterations: agent.maxToolIterations } : {}),
            ...(orPlugins ? { plugins: orPlugins } : {}),
            ...(incoming.onTextChunk ? { onTextChunk: incoming.onTextChunk } : {}),
            ...(incoming.onStreamReset ? { onStreamReset: incoming.onStreamReset } : {}),
          },
          async (toolName, toolInput) => {
            const toolAction = toolInput?.action ? ` → ${toolInput.action}` : '';
            incoming.onProgress?.({ type: 'tool', message: `🔧 Tool: ${toolName}${toolAction}`, tool: toolName });
            if ((toolName === 'task' || toolName === 'db') && !toolInput.userId) {
              toolInput.userId = incoming.userId;
            }
            // Inject user role for permission checks
            toolInput._userRole = incoming.userRole ?? 'user';
            toolInput._userId = incoming.userId;
            const result = await executeTool(toolName, toolInput);
            const resultStr = String(result ?? '');
            const ok = resultStr.length > 0 && !resultStr.startsWith('Error');
            incoming.onProgress?.({ type: 'status', message: `🔧 Tool: ${toolName}${toolAction} — ${ok ? '✅ done' : '❌ failed'}`, tool: toolName });
            return result;
          },
        );
        if (response.toolsUsed.length > 0) {
          logger.info('Tools used in response', {
            tools: response.toolsUsed,
            iterations: response.iterations,
          });
        }
      } else {
        // Agent has NO tools → regular text-only AI call
        response = await this.ai.chat({
          systemPrompt,
          messages,
          maxTokens: agent.maxTokens,
          temperature: agent.temperature,
          thinkingMode: thinkingConfig.thinkingMode,
          ...(thinkingConfig.thinkingBudget ? { thinkingBudget: thinkingConfig.thinkingBudget } : {}),
          ...(selectedModelId ? { model: selectedModelId } : {}),
          ...(selectedProvider ? { provider: selectedProvider } : {}),
          ...(orPlugins ? { plugins: orPlugins } : {}),
          ...(incoming.onTextChunk ? { onTextChunk: incoming.onTextChunk } : {}),
        });
      }

      // Empty response fallback — don't send blank messages
      if (!response.content || response.content.trim().length === 0) {
        logger.warn('AI returned empty response, using fallback', { agent: agent.id, intent: routing.intent, provider: response.provider });
        response.content = `\u05E7\u05D9\u05D1\u05DC\u05EA\u05D9 \u05D0\u05EA \u05D4\u05D4\u05D5\u05D3\u05E2\u05D4 \u05E9\u05DC\u05DA \u05D0\u05D1\u05DC \u05DC\u05D0 \u05D4\u05E6\u05DC\u05D7\u05EA\u05D9 \u05DC\u05E2\u05D1\u05D3 \u05D0\u05D5\u05EA\u05D4. \u05E0\u05E1\u05D4 \u05E9\u05D5\u05D1 \u05D0\u05D5 \u05E0\u05E1\u05D7 \u05D0\u05D7\u05E8\u05EA \u{1F504}\n[\u05E1\u05D5\u05DB\u05DF: ${agent.name} | \u05DB\u05D5\u05D5\u05E0\u05D4: ${routing.intent}]`;
      }

      // ── Post-process: strip "tool approval" language from headless CLI responses ──
      // Claude Code CLI's built-in system prompt tells the model to ask for permission
      // before using tools. On our headless server there is no terminal/popup for approvals.
      // Our system prompt override prevents most cases, but this filter catches any stragglers.
      if (response.content) {
        const approvalPatterns = [
          // English patterns
          /(?:you['']?ll?\s+need\s+to\s+)?(?:click|press|tap)\s+['"]?Allow['"]?\s*(?:on\s+the\s+(?:popup|dialog|prompt|terminal))?/gi,
          /(?:pending|waiting\s+for)\s+tool\s+(?:request|approval|permission)s?/gi,
          /(?:please\s+)?(?:approve|allow|accept|confirm)\s+(?:the\s+)?tool\s+(?:request|use|call|execution)s?/gi,
          /I\s+(?:need|require)\s+(?:your\s+)?(?:permission|approval|authorization)\s+(?:to\s+(?:use|run|execute|access)\s+(?:the\s+)?(?:tool|command|search|browser))/gi,
          /(?:the\s+tool\s+(?:request|call)\s+(?:is|was)\s+(?:pending|blocked|waiting))/gi,
          /(?:you\s+(?:should|need\s+to|can)\s+(?:see|find)\s+a\s+(?:popup|dialog|prompt|notification)\s+(?:in\s+(?:the|your)\s+terminal))/gi,
          /I\s+(?:need|require|want)\s+(?:your\s+)?(?:permission|approval|confirmation)\s+(?:to\s+(?:write|read|edit|delete|create|modify|access|update)\s+)/gi,
          /(?:please\s+)?(?:grant|give)\s+(?:me\s+)?(?:permission|access|approval)\s+(?:to|for)\s+/gi,
          // Hebrew patterns — "אני צריך אישור", "תאשר את", "אני דורש הרשאה", etc.
          /\u05D0\u05E0\u05D9\s+(?:\u05E6\u05E8\u05D9\u05DA|\u05D3\u05D5\u05E8\u05E9|\u05E8\u05D5\u05E6\u05D4|\u05DE\u05D1\u05E7\u05E9)\s+(?:\u05D0\u05D9\u05E9\u05D5\u05E8|\u05D4\u05E8\u05E9\u05D0\u05D4|\u05D0\u05D9\u05E9\u05D5\u05E8\u05DA)/gi,
          /\u05EA\u05D0\u05E9\u05E8\s+(?:\u05D0\u05EA\s+)?(?:\u05D4)?(?:\u05DB\u05EA\u05D9\u05D1\u05D4|\u05D2\u05D9\u05E9\u05D4|\u05E4\u05E2\u05D5\u05DC\u05D4|\u05E9\u05D9\u05DE\u05D5\u05E9|\u05E7\u05E8\u05D9\u05D0\u05D4|\u05DE\u05D7\u05D9\u05E7\u05D4|\u05E2\u05E8\u05D9\u05DB\u05D4)/gi,
          /\u05E6\u05E8\u05D9\u05DA\s+(?:\u05D0\u05D9\u05E9\u05D5\u05E8|\u05D4\u05E8\u05E9\u05D0\u05D4)\s+(?:\u05DC|\u05DB\u05D3\u05D9)/gi,
          /\u05D0\u05D9\u05E9\u05D5\u05E8\s+(?:\u05DB\u05EA\u05D9\u05D1\u05D4|\u05E7\u05E8\u05D9\u05D0\u05D4|\u05D2\u05D9\u05E9\u05D4|\u05E9\u05D9\u05DE\u05D5\u05E9)\s+\u05DC/gi,
          /\u05D4\u05D0\u05DD\s+(?:\u05D0\u05EA\u05D4?\s+)?(?:\u05DE\u05D0\u05E9\u05E8|\u05DE\u05E8\u05E9\u05D4)\s+\u05DC\u05D9/gi,
        ];
        let cleaned = response.content;
        for (const pattern of approvalPatterns) {
          cleaned = cleaned.replace(pattern, '');
        }
        // Clean up orphaned punctuation and extra whitespace from removals
        cleaned = cleaned.replace(/\.\s*\.\s*\./g, '.').replace(/\n{3,}/g, '\n\n').trim();
        if (cleaned !== response.content) {
          logger.info('Stripped tool-approval language from response', { agent: agent.id });
          response.content = cleaned;
        }
      }

      // Track usage for cost monitoring
      if (this.usageTracker && response.usage) {
        this.usageTracker.track({
          provider: response.provider,
          model: response.modelUsed ?? selectedModelId ?? config.AI_MODEL,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          userId: incoming.userId,
          action: routing.intent,
        }).catch(() => {});
      }

      let responseArtifacts = Array.isArray((response as any).artifacts)
        ? (response as any).artifacts as ChatArtifact[]
        : [];

      // If user requested file delivery but model did not call file tool,
      // auto-create a file and publish it as an attachment.
      if (isFileDeliveryRequest(incoming.text) && responseArtifacts.length === 0) {
        try {
          const { writeFile } = await import('fs/promises');
          const { publishFileToUserShare } = await import('./shared-artifacts.js');
          const fileName = `a4claw-${Date.now()}.txt`;
          const tmpPath = `/tmp/${fileName}`;
          const explicitContent = extractExplicitFileContent(incoming.text);
          const responseLooksFake = typeof response.content === 'string' && isLikelyFakeFileDeliveryResponse(response.content);
          const candidateResponse =
            typeof response.content === 'string'
            && response.content.trim()
            && !isAskingForSavePath(response.content)
            && !isDeliveryAckOnly(response.content)
            && !responseLooksFake
              ? response.content.trim()
              : null;
          let synthesizedContent: string | null = null;
          if (!explicitContent && !candidateResponse) {
            try {
              const synthetic = await this.ai.chat({
                systemPrompt: 'You generate plain file content only. Return the final content body without any wrapper text, no markdown links, no file paths, no “download” wording.',
                messages: [{ role: 'user', content: incoming.text }],
                maxTokens: Math.min(agent.maxTokens ?? 1200, 1200),
                temperature: Math.min(Math.max(agent.temperature ?? 0.6, 0), 0.8),
                ...(selectedModelId ? { model: selectedModelId } : {}),
                ...(selectedProvider ? { provider: selectedProvider } : {}),
              });
              const syntheticText = synthetic.content?.trim();
              if (
                syntheticText
                && !isAskingForSavePath(syntheticText)
                && !isDeliveryAckOnly(syntheticText)
                && !isLikelyFakeFileDeliveryResponse(syntheticText)
              ) {
                synthesizedContent = syntheticText;
              }
            } catch (synthErr: any) {
              logger.warn('Synthetic file-content generation failed', {
                userId: incoming.userId,
                error: synthErr.message,
              });
            }
          }
          const fileContent =
            explicitContent
            ?? candidateResponse
            ?? synthesizedContent
            ?? incoming.text.trim()
            ?? 'Generated by a4claw';
          await writeFile(tmpPath, fileContent, 'utf-8');
          const artifact = await publishFileToUserShare(tmpPath, incoming.userId, fileName);
          responseArtifacts = [artifact];
          if (synthesizedContent && responseLooksFake) {
            response.content = synthesizedContent;
          } else if (typeof response.content === 'string' && (isAskingForSavePath(response.content) || responseLooksFake)) {
            response.content = `已保存并作为附件返回：${artifact.originalName || artifact.name}`;
          }
          incoming.onProgress?.({ type: 'status', message: '📎 Auto-saved as attachment' });
          logger.info('Auto-generated shared artifact for file delivery request', {
            userId: incoming.userId,
            fileName,
            artifactPath: artifact.path,
          });
        } catch (autoFileErr: any) {
          logger.warn('Auto file publish failed for file delivery request', {
            userId: incoming.userId,
            error: autoFileErr.message,
          });
        }
      }

      // 9. Save messages to persistent memory (never save empty content)
      if (this.saveMessage) {
        if (incoming.text) {
          await this.saveMessage(incoming.userId, incoming.platform, 'user', incoming.text, {
            platform: incoming.platform, intent: routing.intent,
          });
        }
        if (response.content) {
          await this.saveMessage(incoming.userId, incoming.platform, 'assistant', response.content, {
            agent: agent.id,
            tokens: response.usage,
            provider: response.provider,
            skill: matchedSkill?.id,
            artifacts: responseArtifacts.length > 0 ? responseArtifacts : undefined,
          });
        }
      }

      // 10. Learn from conversation (background — don't block response)
      if (this.learnFromConversation) {
        this.learnFromConversation(incoming.userId, incoming.text, response.content).catch(err =>
          logger.warn('Knowledge learning failed', { error: err.message })
        );
      }

      // 10b. Meta-agent reflection (background — non-blocking)
      this.meta.reflect(incoming.text, response.content, true).catch(err =>
        logger.warn('Meta-agent reflection failed', { error: err.message })
      );

      const duration = Date.now() - startTime;

      // ── Intelligence: feed message result into all subsystems ──
      if (isBridgeReady()) {
        onMessageProcessed({
          agentId: agent.id,
          intent: routing.intent,
          success: true,
          latency: duration,
          cost: 0, // Actual cost tracked by usageTracker
          modelId: response.modelUsed ?? selectedModelId,
          provider: response.provider ?? selectedProvider,
          toolsUsed: (response as any).toolsUsed ?? [],
          inputTokens: response.usage?.inputTokens,
          outputTokens: response.usage?.outputTokens,
          userMessage: incoming.text,
          response: response.content,
        });
      }
      logger.info('Message processed', {
        agent: agent.id, provider: response.provider, skill: matchedSkill?.id,
        duration, tokens: response.usage,
      });

      // Collect thinking from meta-agent + AI response
      const thinkingParts: string[] = [];
      if (metaThinking) thinkingParts.push(metaThinking);
      if (response.thinking) thinkingParts.push(response.thinking);
      const thinking = thinkingParts.length > 0 ? thinkingParts.join('\n\n') : undefined;

      pushActivity('response', `[${agent.id}] ${response.content.slice(0, 80)}${response.content.length > 80 ? '...' : ''}`, { agent: agent.id, platform: incoming.platform });

      // ── Social Engineering Detection (Gemini recommendation) ──
      incoming.onProgress?.({ type: 'status', message: '🛡️ Security — scanning response...' });
      const seResult = detectSocialEngineering(response.content);
      if (seResult.detected && seResult.severity === 'high') {
        logger.error('HIGH social engineering BLOCKED in agent response', {
          agent: agent.id, patterns: seResult.patterns,
        });
        return {
          text: '⛔ Response blocked — high-severity social engineering detected. The agent attempted to manipulate you into bypassing security controls. This incident has been logged.',
          format: 'text',
          agentUsed: `${agent.id}:BLOCKED`,
          provider: response.provider,
        };
      }
      let finalText = redactSecrets(response.content);
      if (seResult.detected && seResult.severity === 'medium') {
        logger.warn('Social engineering detected in agent response', {
          agent: agent.id, severity: seResult.severity, patterns: seResult.patterns,
        });
        finalText = `⚠️ **Security Warning**: This response contains patterns that may attempt to bypass security controls (severity: ${seResult.severity}).\n\n---\n\n${finalText}`;
      }

      // Format model name for display
      const modelDisplay = response.modelUsed ?? selectedModelId ?? 'default';
      const modelName = modelDisplay
        .replace(/^anthropic\//, '')
        .replace(/^openai\//, '')
        .replace(/^meta-llama\//, 'Llama ')
        .replace(/^google\//, '')
        .replace(/^qwen\//, 'Qwen ')
        .replace(/^deepseek\//, 'DeepSeek ')
        .replace(/^z-ai\//, 'GLM ')
        .replace(/:free$/, ' (Free)')
        .split('/')
        .pop() || modelDisplay;

      return {
        text: finalText,
        thinking,
        format: 'markdown',
        artifacts: responseArtifacts.length > 0 ? responseArtifacts : undefined,
        agentUsed: agent.id,
        tokensUsed: response.usage ? { input: response.usage.inputTokens, output: response.usage.outputTokens } : undefined,
        provider: response.provider,
        modelUsed: response.modelUsed ?? selectedModelId,
        modelDisplay: modelName, // Human-readable model name
        skillUsed: matchedSkill?.id,
        elapsed: Math.round((Date.now() - startTime) / 1000),
      };

    } catch (error: any) {
      logger.error('Engine processing error', { error: error.message, stack: error.stack });
      pushActivity('error', `Error: ${error.message?.slice(0, 100)}`, { platform: incoming.platform });

      // Self-heal attempt (non-blocking)
      if (this.evolution) {
        this.evolution.selfHeal(error, `Processing message: ${incoming.text.slice(0, 200)}`).catch(() => {});
      }

      // ── Intelligence: record error into memory + observability ──
      if (isBridgeReady()) {
        onError('engine_processing', error.message ?? 'Unknown engine error', {
          agentId: 'engine',
        });
      }

      // Specific Hebrew error messages per error type
      let errorMsg: string;
      const msg = error.message ?? '';
      if (msg.includes('ECONNREFUSED') || msg.includes('ETIMEOUT') || msg.includes('ENETUNREACH')) {
        errorMsg = '\u{274C} \u05D1\u05E2\u05D9\u05D4 \u05D1\u05D7\u05D9\u05D1\u05D5\u05E8 \u05DC\u05E9\u05E8\u05EA. \u05D1\u05D3\u05D5\u05E7 \u05E9\u05D4\u05E9\u05E8\u05EA \u05E4\u05E2\u05D9\u05DC \u05D5\u05E0\u05E1\u05D4 \u05E9\u05D5\u05D1.';
      } else if (msg.includes('rate limit') || msg.includes('429') || msg.includes('quota')) {
        errorMsg = '\u{26A0}\uFE0F \u05D4\u05D2\u05E2\u05EA\u05D9 \u05DC\u05DE\u05D2\u05D1\u05DC\u05EA \u05E7\u05E6\u05D1 \u05E9\u05DC \u05D4-API. \u05E0\u05E1\u05D4 \u05E9\u05D5\u05D1 \u05D1\u05E2\u05D5\u05D3 \u05D3\u05E7\u05D4.';
      } else if (msg.includes('401') || msg.includes('403') || msg.includes('authentication') || msg.includes('unauthorized')) {
        errorMsg = '\u{1F510} \u05D1\u05E2\u05D9\u05D4 \u05D1\u05D4\u05E8\u05E9\u05D0\u05D5\u05EA. \u05D1\u05D3\u05D5\u05E7 \u05E9\u05DE\u05E4\u05EA\u05D7\u05D5\u05EA \u05D4-API \u05EA\u05E7\u05D9\u05E0\u05D9\u05DD.';
      } else if (msg.includes('timeout') || msg.includes('RESPONSE_TIMEOUT')) {
        errorMsg = '\u{23F3} \u05D4\u05E4\u05E2\u05D5\u05DC\u05D4 \u05DC\u05E7\u05D7\u05D4 \u05D9\u05D5\u05EA\u05E8 \u05DE\u05D3\u05D9. \u05E0\u05E1\u05D4 \u05DC\u05E4\u05E9\u05D8 \u05D0\u05EA \u05D4\u05D1\u05E7\u05E9\u05D4.';
      } else {
        errorMsg = `\u{274C} \u05DE\u05E9\u05D4\u05D5 \u05D4\u05E9\u05EA\u05D1\u05E9. \u05E0\u05E1\u05D4 \u05E9\u05D5\u05D1.\n\u05E9\u05D2\u05D9\u05D0\u05D4: ${msg.slice(0, 150)}`;
      }

      return { text: errorMsg, format: 'text' };
    } finally {
      // Restore original saveMessage if we wrapped it
      if (_origSave) this.saveMessage = _origSave;
    }
  }
}
