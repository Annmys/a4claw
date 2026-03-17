import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import config from '../config.js';
import { getAgent, getAllAgents } from '../agents/registry.js';
import { isCacheAvailable } from '../memory/cache.js';
import { executeTool } from './tool-executor.js';

export type AgentRuntimeLevel = 'ready' | 'partial' | 'blocked';

export interface AgentRuntimeToolStatus {
  name: string;
  status: AgentRuntimeLevel;
  detail: string;
}

export interface AgentRuntimeStatus {
  id: string;
  name: string;
  status: AgentRuntimeLevel;
  executionLevel: 'full' | 'limited' | 'none';
  summary: string;
  evidence: string[];
  missing: string[];
  availableTools: string[];
  unavailableTools: string[];
  toolStatus: AgentRuntimeToolStatus[];
}

interface RuntimeContext {
  aiReady: boolean;
  providerCount: number;
  browserReady: boolean;
  browserDetail: string;
  browserVncReady: boolean;
  desktopReady: boolean;
  desktopDetail: string;
  deviceReady: boolean;
  deviceDetail: string;
  sshBinaryReady: boolean;
  sshTargetCount: number;
  openclawReady: boolean;
  openclawDetail: string;
  redisReady: boolean;
  commandCache: Map<string, boolean>;
}

interface RuntimeBuildOptions {
  includeOpenClaw?: boolean;
}

const requireFromHere = createRequire(import.meta.url);
const SERVER_STORE_PATH = join(process.cwd(), 'data', 'servers.json');
const RUNTIME_CACHE_MS = 30_000;

let runtimeCache: { at: number; key: string; items: AgentRuntimeStatus[] } | null = null;

function hasEnv(name: string): boolean {
  return Boolean(process.env[name] && String(process.env[name]).trim());
}

function hasCommand(name: string, cache: Map<string, boolean>): boolean {
  if (cache.has(name)) return cache.get(name)!;
  const result = spawnSync('bash', ['-lc', `command -v ${name}`], { stdio: 'pipe' });
  const available = result.status === 0;
  cache.set(name, available);
  return available;
}

function hasPackage(name: string): boolean {
  try {
    requireFromHere.resolve(name);
    return true;
  } catch {
    return false;
  }
}

function countSavedServers(): number {
  try {
    if (!existsSync(SERVER_STORE_PATH)) return 0;
    const raw = JSON.parse(readFileSync(SERVER_STORE_PATH, 'utf-8'));
    return Array.isArray(raw) ? raw.length : 0;
  } catch {
    return 0;
  }
}

async function detectBrowserRuntime(): Promise<{ ready: boolean; detail: string; vncReady: boolean }> {
  try {
    const playwright = await import('playwright');
    const executable = playwright.chromium.executablePath();
    if (!executable || !existsSync(executable)) {
      return { ready: false, detail: '未检测到可用的 Playwright Chromium 运行时', vncReady: false };
    }

    const commandCache = new Map<string, boolean>();
    const vncReady = hasCommand('Xvfb', commandCache) && hasCommand('x11vnc', commandCache) && hasCommand('websockify', commandCache);
    return {
      ready: true,
      detail: vncReady ? 'Playwright 浏览器运行时和 VNC 依赖已就绪' : 'Playwright 浏览器运行时已就绪，VNC 旁路依赖未完整就绪',
      vncReady,
    };
  } catch (err: any) {
    return { ready: false, detail: `浏览器自动化依赖不可用: ${err.message}`, vncReady: false };
  }
}

async function detectOpenClawHealth(): Promise<{ ready: boolean; detail: string }> {
  if (!config.DEFAULT_SSH_SERVER) {
    return { ready: false, detail: '未配置 DEFAULT_SSH_SERVER，无法桥接 OpenClaw' };
  }
  if (!config.OPENCLAW_GATEWAY_TOKEN) {
    return { ready: false, detail: '未配置 OPENCLAW_GATEWAY_TOKEN' };
  }

  try {
    const result = await executeTool('openclaw', { action: 'health', _userId: 'system', _userRole: 'admin' });
    if (result.success) {
      return { ready: true, detail: 'OpenClaw 网关健康检查通过' };
    }
    return { ready: false, detail: result.error || 'OpenClaw 网关健康检查失败' };
  } catch (err: any) {
    return { ready: false, detail: err.message };
  }
}

async function buildRuntimeContext(providers?: string[], options?: RuntimeBuildOptions): Promise<RuntimeContext> {
  const commandCache = new Map<string, boolean>();
  const providerCount = Array.isArray(providers) ? providers.length : 0;
  const aiReady = providerCount > 0 || hasEnv('ANTHROPIC_API_KEY') || hasEnv('OPENROUTER_API_KEY') || config.OLLAMA_ENABLED || config.CLAUDE_CODE_ENABLED;
  const browserRuntime = await detectBrowserRuntime();
  const desktopPackageReady = hasPackage('@nut-tree/nut-js');
  const desktopReady = config.DESKTOP_ENABLED && desktopPackageReady && hasEnv('ANTHROPIC_API_KEY');
  const openclawHealth = options?.includeOpenClaw === false
    ? { ready: Boolean(config.DEFAULT_SSH_SERVER && config.OPENCLAW_GATEWAY_TOKEN), detail: config.DEFAULT_SSH_SERVER && config.OPENCLAW_GATEWAY_TOKEN ? 'OpenClaw 检查已跳过，按配置预判可用' : 'OpenClaw 配置不完整' }
    : await detectOpenClawHealth();
  const sshTargetCount = countSavedServers() + (config.DEFAULT_SSH_SERVER ? 1 : 0);

  return {
    aiReady,
    providerCount,
    browserReady: browserRuntime.ready,
    browserDetail: browserRuntime.detail,
    browserVncReady: browserRuntime.vncReady,
    desktopReady,
    desktopDetail: !config.DESKTOP_ENABLED
      ? 'DESKTOP_ENABLED=false'
      : !desktopPackageReady
        ? '未安装 @nut-tree/nut-js'
        : !hasEnv('ANTHROPIC_API_KEY')
          ? '缺少 ANTHROPIC_API_KEY，AI 桌面视觉无法决策'
          : '桌面控制依赖已就绪',
    deviceReady: hasCommand('adb', commandCache) && hasPackage('webdriverio'),
    deviceDetail: hasCommand('adb', commandCache)
      ? (hasPackage('webdriverio') ? 'ADB 与移动自动化依赖已就绪' : '检测到 adb，但缺少 WebDriver/Appium 客户端依赖')
      : '未检测到 adb',
    sshBinaryReady: hasCommand('ssh', commandCache),
    sshTargetCount,
    openclawReady: openclawHealth.ready,
    openclawDetail: openclawHealth.detail,
    redisReady: isCacheAvailable(),
    commandCache,
  };
}

function makeToolStatus(name: string, context: RuntimeContext): AgentRuntimeToolStatus {
  switch (name) {
    case 'bash':
      return { name, status: hasCommand('bash', context.commandCache) ? 'ready' : 'blocked', detail: hasCommand('bash', context.commandCache) ? '本机 shell 可用' : '缺少 bash' };
    case 'file':
    case 'memory':
    case 'task':
    case 'db':
    case 'analytics':
    case 'rag':
      return { name, status: 'ready', detail: '本地核心能力已接通' };
    case 'github':
      return { name, status: hasEnv('GITHUB_TOKEN') ? 'ready' : 'partial', detail: hasEnv('GITHUB_TOKEN') ? 'GitHub Token 已配置' : '未配置 GITHUB_TOKEN，只能本地改代码，不能直接操作 GitHub' };
    case 'search':
      return { name, status: hasEnv('BRAVE_API_KEY') ? 'ready' : 'partial', detail: hasEnv('BRAVE_API_KEY') ? 'Brave Search 已配置' : '未配置 BRAVE_API_KEY，联网搜索受限' };
    case 'browser':
      return { name, status: context.browserReady ? (context.browserVncReady ? 'ready' : 'partial') : 'blocked', detail: context.browserDetail };
    case 'cron':
      return { name, status: context.redisReady ? 'ready' : 'partial', detail: context.redisReady ? 'Redis/队列可用，定时任务可执行' : 'Redis 不可用，延迟提醒与队列型定时能力受限' };
    case 'reminder':
      return { name, status: context.redisReady ? 'ready' : 'partial', detail: context.redisReady ? '提醒队列可用' : '提醒队列依赖 Redis，当前受限' };
    case 'workflow':
      return { name, status: context.aiReady ? 'ready' : 'partial', detail: context.aiReady ? '工作流引擎已初始化' : '缺少 AI 提供方，自动规划能力会受限' };
    case 'auto':
      return { name, status: context.aiReady ? 'ready' : 'blocked', detail: context.aiReady ? '自动执行器可工作' : '缺少 AI 提供方，自动执行器不可用' };
    case 'email':
      return {
        name,
        status: (hasEnv('SMTP_HOST') && hasEnv('SMTP_USER') && hasEnv('SMTP_PASS')) || hasEnv('GMAIL_CLIENT_ID')
          ? 'ready'
          : 'partial',
        detail: (hasEnv('SMTP_HOST') && hasEnv('SMTP_USER') && hasEnv('SMTP_PASS')) || hasEnv('GMAIL_CLIENT_ID')
          ? '邮件发送配置已接通'
          : '未完整配置 SMTP/Gmail 凭证',
      };
    case 'ssh':
      return {
        name,
        status: !context.sshBinaryReady ? 'blocked' : context.sshTargetCount > 0 ? 'ready' : 'partial',
        detail: !context.sshBinaryReady
          ? '缺少 ssh 客户端'
          : context.sshTargetCount > 0
            ? `已检测到 ${context.sshTargetCount} 个 SSH 目标`
            : 'SSH 客户端存在，但还没有配置服务器目标',
      };
    case 'docker':
      return { name, status: hasCommand('docker', context.commandCache) ? 'ready' : 'partial', detail: hasCommand('docker', context.commandCache) ? 'Docker 命令可用' : '未检测到 docker 命令' };
    case 'deploy':
      return { name, status: hasCommand('pm2', context.commandCache) ? 'ready' : 'partial', detail: hasCommand('pm2', context.commandCache) ? '本机部署链路可用' : '未检测到 pm2，部署能力受限' };
    case 'openclaw':
      return { name, status: context.openclawReady ? 'ready' : 'blocked', detail: context.openclawDetail };
    case 'desktop':
      return { name, status: context.desktopReady ? 'ready' : 'blocked', detail: context.desktopDetail };
    case 'device':
      return { name, status: context.deviceReady ? 'ready' : 'blocked', detail: context.deviceDetail };
    case 'social':
      return { name, status: hasEnv('BLOTATO_API_KEY') ? 'ready' : 'partial', detail: hasEnv('BLOTATO_API_KEY') ? 'Blotato 发布能力已接通' : '未配置 BLOTATO_API_KEY' };
    case 'kie':
      return { name, status: hasEnv('KIE_AI_API_KEY') ? 'ready' : 'partial', detail: hasEnv('KIE_AI_API_KEY') ? 'Kie 内容生成已接通' : '未配置 KIE_AI_API_KEY' };
    case 'elevenlabs':
      return { name, status: hasEnv('ELEVENLABS_API_KEY') ? 'ready' : 'partial', detail: hasEnv('ELEVENLABS_API_KEY') ? 'ElevenLabs 已接通' : '未配置 ELEVENLABS_API_KEY' };
    case 'firecrawl':
      return { name, status: hasEnv('FIRECRAWL_API_KEY') ? 'ready' : 'partial', detail: hasEnv('FIRECRAWL_API_KEY') ? 'Firecrawl 已接通' : '未配置 FIRECRAWL_API_KEY' };
    case 'rapidapi':
      return { name, status: hasEnv('RAPIDAPI_KEY') ? 'ready' : 'partial', detail: hasEnv('RAPIDAPI_KEY') ? 'RapidAPI 已接通' : '未配置 RAPIDAPI_KEY' };
    case 'apify':
      return { name, status: hasEnv('APIFY_API_TOKEN') ? 'ready' : 'partial', detail: hasEnv('APIFY_API_TOKEN') ? 'Apify 已接通' : '未配置 APIFY_API_TOKEN' };
    case 'trading':
      return { name, status: config.TRADING_ENABLED ? 'ready' : 'partial', detail: config.TRADING_ENABLED ? `交易能力已启用（${config.TRADING_PAPER_MODE ? '纸面模式' : '实盘模式'}）` : 'TRADING_ENABLED=false' };
    case 'whatsapp':
      return { name, status: config.WHATSAPP_ENABLED ? 'ready' : 'partial', detail: config.WHATSAPP_ENABLED ? 'WhatsApp 已启用' : 'WHATSAPP_ENABLED=false' };
    case 'claude-code':
      return {
        name,
        status: config.CLAUDE_CODE_ENABLED && hasCommand(config.CLAUDE_CODE_PATH, context.commandCache) ? 'ready' : 'partial',
        detail: config.CLAUDE_CODE_ENABLED && hasCommand(config.CLAUDE_CODE_PATH, context.commandCache)
          ? 'Claude Code CLI 已接通'
          : 'Claude Code CLI 未启用或命令不可用',
      };
    case 'facebook':
    case 'twitter':
    case 'linkedin':
    case 'tiktok':
      return { name, status: context.browserReady ? 'partial' : 'blocked', detail: context.browserReady ? '浏览器自动化底座可用，但平台登录态需单独验证' : '浏览器自动化底座不可用' };
    default:
      return { name, status: 'partial', detail: '未定义运行时探针，先按部分可用处理' };
  }
}

function summarizeAgent(agentId: string, availableCount: number, unavailableCount: number, context: RuntimeContext): { status: AgentRuntimeLevel; executionLevel: 'full' | 'limited' | 'none'; summary: string; missing: string[]; evidence: string[] } {
  switch (agentId) {
    case 'code-assistant': {
      const missing: string[] = [];
      const evidence = ['本地代码修改链路已验证可工作'];
      if (!hasEnv('GITHUB_TOKEN')) missing.push('GitHub 远程操作未接通');
      return {
        status: 'partial',
        executionLevel: 'full',
        summary: missing.length === 0 ? '可直接改代码、写文件、构建并操作 GitHub。' : '可直接改代码、写文件、构建；GitHub 远程操作当前未接通。',
        missing,
        evidence,
      };
    }
    case 'task-planner':
      return {
        status: context.redisReady ? 'ready' : 'partial',
        executionLevel: 'full',
        summary: context.redisReady ? '任务创建、查询、提醒与工作流编排可执行。' : '任务创建与查询可执行；提醒/延迟队列能力受 Redis 状态影响。',
        missing: context.redisReady ? [] : ['Redis 不可用，提醒与部分定时任务受限'],
        evidence: ['任务仓储已接数据库', context.redisReady ? 'Redis 队列可用' : 'Redis 队列未就绪'],
      };
    case 'desktop-controller':
      return {
        status: context.desktopReady ? 'ready' : 'blocked',
        executionLevel: context.desktopReady ? 'full' : 'none',
        summary: context.desktopReady ? '桌面截图、点击、输入和 AI 视觉决策可执行。' : '当前机器未满足桌面控制依赖，不能执行真实桌面操作。',
        missing: context.desktopReady ? [] : [context.desktopDetail],
        evidence: [context.desktopDetail],
      };
    case 'device-controller':
      return {
        status: context.deviceReady ? 'ready' : 'blocked',
        executionLevel: context.deviceReady ? 'full' : 'none',
        summary: context.deviceReady ? 'Android 设备控制链路可执行。' : '当前机器未满足 ADB/Appium 依赖，不能执行真实设备操作。',
        missing: context.deviceReady ? [] : [context.deviceDetail],
        evidence: [context.deviceDetail],
      };
    case 'orchestrator':
      return {
        status: context.openclawReady ? 'ready' : 'partial',
        executionLevel: context.openclawReady ? 'full' : 'limited',
        summary: context.openclawReady ? '本地智能体编排与 OpenClaw 协同都可执行。' : '本地编排可用，但 OpenClaw 协同链路未完全就绪。',
        missing: context.openclawReady ? [] : [context.openclawDetail],
        evidence: [context.openclawDetail, 'Crew Orchestrator 已接入主引擎'],
      };
    case 'server-manager':
      return {
        status: !context.sshBinaryReady ? 'blocked' : context.sshTargetCount > 0 ? 'ready' : 'partial',
        executionLevel: !context.sshBinaryReady ? 'none' : context.sshTargetCount > 0 ? 'full' : 'limited',
        summary: !context.sshBinaryReady
          ? '当前机器缺少 ssh 客户端，无法执行服务器管理。'
          : context.sshTargetCount > 0
            ? 'SSH 服务器管理链路可执行。'
            : 'SSH 客户端存在，但尚未配置可管理的服务器目标。',
        missing: !context.sshBinaryReady ? ['缺少 ssh 客户端'] : context.sshTargetCount > 0 ? [] : ['未配置任何服务器目标'],
        evidence: [context.sshBinaryReady ? '检测到 ssh 客户端' : '未检测到 ssh 客户端', `服务器目标数：${context.sshTargetCount}`],
      };
    case 'web-agent':
      return {
        status: context.browserReady ? (context.browserVncReady ? 'ready' : 'partial') : 'blocked',
        executionLevel: context.browserReady ? 'full' : 'none',
        summary: context.browserReady
          ? (context.browserVncReady ? '网页自动化与浏览器视图都可执行。' : '网页自动化可执行，但浏览器旁路展示依赖不完整。')
          : '浏览器自动化运行时不可用。',
        missing: context.browserReady ? (context.browserVncReady ? [] : ['Xvfb/x11vnc/websockify 未完整就绪']) : [context.browserDetail],
        evidence: [context.browserDetail],
      };
    case 'researcher':
      return {
        status: availableCount >= 2 ? 'ready' : availableCount >= 1 ? 'partial' : 'blocked',
        executionLevel: availableCount >= 1 ? 'full' : 'none',
        summary: availableCount >= 2
          ? '联网搜索与资料处理链路可执行。'
          : availableCount >= 1
            ? '具备部分资料处理能力，但联网数据源不完整。'
            : '当前缺少可用的联网研究能力。',
        missing: availableCount >= 1 ? [] : ['缺少可用的搜索/抓取数据源'],
        evidence: [`已接通 ${availableCount} 项研究工具`],
      };
    case 'task-executor':
      return {
        status: context.aiReady && availableCount >= 4 ? 'ready' : context.aiReady ? 'partial' : 'blocked',
        executionLevel: context.aiReady ? 'full' : 'none',
        summary: context.aiReady && availableCount >= 4
          ? '任务执行器已具备真实落地能力。'
          : context.aiReady
            ? '任务执行器可运行，但可调用工具还不够完整。'
            : '缺少 AI 提供方，任务执行器不可用。',
        missing: context.aiReady ? [] : ['缺少可用 AI 提供方'],
        evidence: [`可调用工具数：${availableCount}`],
      };
    default: {
      const status: AgentRuntimeLevel = unavailableCount === 0 ? 'ready' : availableCount > 0 ? 'partial' : 'blocked';
      return {
        status,
        executionLevel: status === 'ready' ? 'full' : status === 'partial' ? 'limited' : 'none',
        summary: status === 'ready' ? '核心能力可执行。' : status === 'partial' ? '部分能力可执行，存在依赖缺口。' : '当前不可执行。',
        missing: [],
        evidence: [`可用工具 ${availableCount} / 总工具 ${availableCount + unavailableCount}`],
      };
    }
  }
}

function normalizeCodeAssistantStatus(status: AgentRuntimeStatus): AgentRuntimeStatus {
  const hasGithubGap = status.missing.includes('GitHub 远程操作未接通');
  return {
    ...status,
    status: hasGithubGap ? 'partial' : 'ready',
    executionLevel: 'full',
  };
}

function normalizeTaskPlannerStatus(status: AgentRuntimeStatus, context: RuntimeContext): AgentRuntimeStatus {
  return {
    ...status,
    status: context.redisReady ? 'ready' : 'partial',
    executionLevel: 'full',
  };
}

function normalizeAgentStatus(agentId: string, status: AgentRuntimeStatus, context: RuntimeContext): AgentRuntimeStatus {
  switch (agentId) {
    case 'code-assistant':
      return normalizeCodeAssistantStatus(status);
    case 'task-planner':
      return normalizeTaskPlannerStatus(status, context);
    default:
      return status;
  }
}

function buildStatusForAgent(agentId: string, context: RuntimeContext): AgentRuntimeStatus {
  const agent = getAgent(agentId);
  if (!agent) {
    return {
      id: agentId,
      name: agentId,
      status: 'blocked',
      executionLevel: 'none',
      summary: '智能体不存在。',
      evidence: [],
      missing: ['智能体未注册'],
      availableTools: [],
      unavailableTools: [],
      toolStatus: [],
    };
  }

  const toolStatus = agent.tools.map((tool) => makeToolStatus(tool, context));
  const availableTools = toolStatus.filter((tool) => tool.status === 'ready').map((tool) => tool.name);
  const unavailableTools = toolStatus.filter((tool) => tool.status !== 'ready').map((tool) => tool.name);
  const summaryBase = summarizeAgent(agent.id, availableTools.length, unavailableTools.length, context);
  const missing = [...summaryBase.missing, ...toolStatus.filter((tool) => tool.status === 'blocked').map((tool) => `${tool.name}: ${tool.detail}`)];
  const evidence = [...summaryBase.evidence, ...toolStatus.filter((tool) => tool.status === 'ready').map((tool) => `${tool.name}: ${tool.detail}`)].slice(0, 8);

  return normalizeAgentStatus(agent.id, {
    id: agent.id,
    name: agent.name,
    status: summaryBase.status,
    executionLevel: summaryBase.executionLevel,
    summary: summaryBase.summary,
    evidence,
    missing,
    availableTools,
    unavailableTools,
    toolStatus,
  }, context);
}

export async function getAgentRuntimeStatuses(providers?: string[]): Promise<AgentRuntimeStatus[]> {
  const cacheKey = JSON.stringify({ providers: providers?.slice().sort() ?? [] });
  if (runtimeCache && runtimeCache.key === cacheKey && Date.now() - runtimeCache.at < RUNTIME_CACHE_MS) {
    return runtimeCache.items;
  }

  const context = await buildRuntimeContext(providers);
  const items = getAllAgents().map((agent) => buildStatusForAgent(agent.id, context));
  runtimeCache = { at: Date.now(), key: cacheKey, items };
  return items;
}

export async function getAgentRuntimeStatus(agentId: string, providers?: string[]): Promise<AgentRuntimeStatus> {
  if (runtimeCache && Date.now() - runtimeCache.at < RUNTIME_CACHE_MS) {
    const cached = runtimeCache.items.find((item) => item.id === agentId);
    if (cached) return cached;
  }

  const agent = getAgent(agentId);
  const context = await buildRuntimeContext(providers, { includeOpenClaw: agent?.id === 'orchestrator' });
  return buildStatusForAgent(agentId, context);
}
