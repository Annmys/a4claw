import { Intent, type RoutingResult } from './router.js';

export type RouteExecutionMode = 'quick' | 'auto' | 'deep';
export type RouteType = 'chat' | 'tool' | 'workflow' | 'command-center' | 'openclaw' | 'document';
export type RouteRiskLevel = 'low' | 'medium' | 'high';

export interface RoutePlanStep {
  id: string;
  title: string;
  detail: string;
  capability?: string;
  optional?: boolean;
}

export interface RoutePlan {
  intent: Intent;
  confidence: number;
  agentId: string;
  mode: RouteExecutionMode;
  routeType: RouteType;
  requiresTools: boolean;
  requiresFiles: boolean;
  requiresMemory: boolean;
  requiresOrganization: boolean;
  requiredCapabilities: string[];
  steps: RoutePlanStep[];
  reason: string;
  riskLevel: RouteRiskLevel;
  fallback: string;
  forceMode?: RouteExecutionMode;
}

export interface BuildRoutePlanInput {
  routing: RoutingResult;
  text: string;
  mode: RouteExecutionMode;
  hasAttachments?: boolean;
  interactionMode?: 'chat' | 'task';
}

const TOOL_INTENTS = new Set<Intent>([
  Intent.SERVER_STATUS,
  Intent.SERVER_DEPLOY,
  Intent.SERVER_FIX,
  Intent.SERVER_MONITOR,
  Intent.CODE_WRITE,
  Intent.CODE_FIX,
  Intent.CODE_REVIEW,
  Intent.GITHUB_PR,
  Intent.GITHUB_ISSUE,
  Intent.WEB_SEARCH,
  Intent.DESKTOP_CONTROL,
  Intent.DESKTOP_SCREENSHOT,
  Intent.BUILD_PROJECT,
  Intent.SCHEDULE,
  Intent.EMAIL,
  Intent.DOCUMENT,
  Intent.CALENDAR,
  Intent.WEB_ACTION,
  Intent.PHONE,
  Intent.CONTENT_CREATE,
  Intent.SOCIAL_PUBLISH,
  Intent.ORCHESTRATE,
  Intent.AUTONOMOUS_TASK,
  Intent.SELF_DIAGNOSE,
  Intent.WORKFLOW,
  Intent.ANALYTICS,
  Intent.DEVICE_CONTROL,
  Intent.DEVICE_CONFIG,
  Intent.UGC_CREATE,
  Intent.PODCAST_CREATE,
  Intent.SITE_ANALYZE,
  Intent.SERVER_MANAGE,
  Intent.SERVER_HEALTH,
  Intent.SERVER_SCAN,
  Intent.CRYPTO_TRADE,
  Intent.CRYPTO_ANALYZE,
  Intent.CRYPTO_PORTFOLIO,
  Intent.WHATSAPP_CONNECT,
  Intent.BUILD_APP,
  Intent.MRR_STRATEGY,
  Intent.FACEBOOK_ACTION,
]);

const MEMORY_INTENTS = new Set<Intent>([
  Intent.QUESTION_ANSWER,
  Intent.TASK_CREATE,
  Intent.TASK_LIST,
  Intent.TASK_UPDATE,
  Intent.REMINDER_SET,
  Intent.DOCUMENT,
  Intent.REMEMBER,
  Intent.AUTONOMOUS_TASK,
  Intent.WORKFLOW,
  Intent.ORCHESTRATE,
  Intent.SELF_DIAGNOSE,
  Intent.ANALYTICS,
]);

const ORG_INTENTS = new Set<Intent>([
  Intent.TASK_CREATE,
  Intent.TASK_LIST,
  Intent.TASK_UPDATE,
  Intent.ORCHESTRATE,
  Intent.AUTONOMOUS_TASK,
  Intent.WORKFLOW,
]);

function contains(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function inferRouteType(intent: Intent, text: string, hasAttachments: boolean, interactionMode?: 'chat' | 'task'): RouteType {
  if (intent === Intent.DOCUMENT || hasAttachments) return 'document';
  if (intent === Intent.ORCHESTRATE || contains(text, /openclaw|telegram|facebook|whatsapp|联动|协同|同步/i)) return 'openclaw';
  if (
    intent === Intent.WORKFLOW
    || intent === Intent.AUTONOMOUS_TASK
    || intent === Intent.SCHEDULE
    || intent === Intent.BUILD_PROJECT
    || intent === Intent.CONTENT_CREATE
    || intent === Intent.SOCIAL_PUBLISH
    || interactionMode === 'task'
  ) return 'workflow';
  if (
    ORG_INTENTS.has(intent)
    || contains(text, /中心|部门|员工|成员|人员|岗位|组织|center|department|employee|member|org/i)
  ) return 'command-center';
  if (TOOL_INTENTS.has(intent)) return 'tool';
  return 'chat';
}

function inferRequiredCapabilities(routeType: RouteType, intent: Intent, text: string, hasAttachments: boolean): string[] {
  const caps = new Set<string>();
  if (TOOL_INTENTS.has(intent) || routeType === 'tool' || routeType === 'workflow' || routeType === 'openclaw') {
    caps.add('tool-execution');
  }
  if (MEMORY_INTENTS.has(intent) || contains(text, /继续|上次|刚才|remember|history|历史|上下文/i)) {
    caps.add('memory');
  }
  if (routeType === 'document' || hasAttachments) {
    caps.add('document-pipeline');
    caps.add('artifact-delivery');
  }
  if (routeType === 'workflow') {
    caps.add('task-planning');
    caps.add('multi-step-execution');
  }
  if (routeType === 'command-center') {
    caps.add('organization-context');
    caps.add('task-dispatch');
  }
  if (routeType === 'openclaw') {
    caps.add('openclaw-bridge');
    caps.add('channel-orchestration');
  }
  caps.add('response-synthesis');
  return Array.from(caps);
}

function inferReason(routeType: RouteType, intent: Intent, text: string, hasAttachments: boolean): string {
  if (routeType === 'document') {
    return hasAttachments
      ? '检测到文件输入，优先走文档处理与结果产出链路。'
      : '当前请求属于文档理解或改写，优先走文档链路。';
  }
  if (routeType === 'openclaw') return '请求涉及 OpenClaw 或多渠道联动，需要协同编排链路。';
  if (routeType === 'command-center') return '请求涉及组织身份、任务指派或人员职责，需要组织上下文。';
  if (routeType === 'workflow') return '请求是多步骤执行任务，需先规划再执行。';
  if (routeType === 'tool') return `意图已识别为 ${intent}，需要调用工具或外部能力执行。`;
  if (contains(text, /总结|翻译|分析|修复|执行|处理/i)) return '请求包含明确动作目标，优先按结果导向执行。';
  return '当前请求适合直接对话回复，保持轻量链路。';
}

function inferRiskLevel(routeType: RouteType, intent: Intent, text: string): RouteRiskLevel {
  if (
    routeType === 'openclaw'
    || intent === Intent.DESKTOP_CONTROL
    || intent === Intent.EMAIL
    || intent === Intent.PHONE
    || intent === Intent.SERVER_DEPLOY
    || intent === Intent.SERVER_FIX
    || intent === Intent.CRYPTO_TRADE
    || contains(text, /删除|部署|付款|转账|buy|sell|trade|deploy|delete/i)
  ) return 'high';
  if (routeType === 'workflow' || routeType === 'document' || routeType === 'command-center' || routeType === 'tool') return 'medium';
  return 'low';
}

function inferFallback(routeType: RouteType): string {
  switch (routeType) {
    case 'document':
      return '若模型链路失败，则退回本地提取、摘要或文件工件生成。';
    case 'workflow':
      return '若自动执行中断，则退回分步计划并保留已完成轨迹。';
    case 'command-center':
      return '若组织映射不足，则退回默认身份并提示补齐中心/部门/员工。';
    case 'openclaw':
      return '若外部协同不可用，则退回本地聊天链路并返回缺失环节。';
    case 'tool':
      return '若工具执行失败，则退回纯文本说明并暴露失败步骤。';
    default:
      return '若主模型不可用，则退回基础聊天响应。';
  }
}

function inferSteps(routeType: RouteType, requiredCapabilities: string[]): RoutePlanStep[] {
  const steps: RoutePlanStep[] = [
    {
      id: 'classify',
      title: '识别意图与执行入口',
      detail: '先确认消息属于哪类任务，再选择主智能体与链路。',
      capability: 'router',
    },
  ];

  if (requiredCapabilities.includes('memory')) {
    steps.push({
      id: 'memory',
      title: '加载会话与记忆',
      detail: '补全最近上下文、用户偏好和历史任务信息。',
      capability: 'memory',
    });
  }

  if (requiredCapabilities.includes('organization-context')) {
    steps.push({
      id: 'organization',
      title: '加载组织身份',
      detail: '注入中心、部门、员工和技能分配上下文。',
      capability: 'organization-context',
    });
  }

  if (routeType === 'document') {
    steps.push({
      id: 'document',
      title: '处理文档与生成工件',
      detail: '提取正文、执行翻译/分析/改写，并输出可下载结果文件。',
      capability: 'document-pipeline',
    });
  } else if (requiredCapabilities.includes('tool-execution')) {
    steps.push({
      id: 'tools',
      title: '执行工具链',
      detail: '按路由结果调用所需工具、插件或系统能力。',
      capability: 'tool-execution',
    });
  }

  if (requiredCapabilities.includes('task-planning')) {
    steps.push({
      id: 'plan',
      title: '生成任务计划',
      detail: '把复杂目标拆成可执行步骤，并在必要时自动续跑。',
      capability: 'task-planning',
    });
  }

  steps.push({
    id: 'respond',
    title: '汇总结果与反馈',
    detail: '整理执行结果、失败点和后续动作，回传给聊天界面。',
    capability: 'response-synthesis',
  });

  return steps;
}

function inferForceMode(
  currentMode: RouteExecutionMode,
  routeType: RouteType,
  text: string,
  requiresTools: boolean,
  requiresFiles: boolean,
  requiresOrganization: boolean,
): RouteExecutionMode | undefined {
  const isLongTask = text.length > 450;
  if (currentMode === 'quick' && (requiresTools || requiresFiles || requiresOrganization || routeType !== 'chat')) {
    return isLongTask && (routeType === 'workflow' || routeType === 'document' || routeType === 'openclaw')
      ? 'deep'
      : 'auto';
  }
  if (currentMode !== 'deep' && isLongTask && (routeType === 'workflow' || routeType === 'document' || routeType === 'openclaw')) {
    return 'deep';
  }
  return undefined;
}

export function buildRoutePlan(input: BuildRoutePlanInput): RoutePlan {
  const hasAttachments = Boolean(input.hasAttachments);
  const routeType = inferRouteType(input.routing.intent, input.text, hasAttachments, input.interactionMode);
  const requiresFiles = hasAttachments || routeType === 'document';
  const requiresTools = TOOL_INTENTS.has(input.routing.intent) || routeType !== 'chat';
  const requiresMemory = MEMORY_INTENTS.has(input.routing.intent) || requiresFiles;
  const requiresOrganization = routeType === 'command-center';
  const requiredCapabilities = inferRequiredCapabilities(routeType, input.routing.intent, input.text, hasAttachments);
  const forceMode = inferForceMode(
    input.mode,
    routeType,
    input.text,
    requiresTools,
    requiresFiles,
    requiresOrganization,
  );
  const mode = forceMode ?? input.mode;

  return {
    intent: input.routing.intent,
    confidence: input.routing.confidence,
    agentId: input.routing.agentId,
    mode,
    routeType,
    requiresTools,
    requiresFiles,
    requiresMemory,
    requiresOrganization,
    requiredCapabilities,
    steps: inferSteps(routeType, requiredCapabilities),
    reason: inferReason(routeType, input.routing.intent, input.text, hasAttachments),
    riskLevel: inferRiskLevel(routeType, input.routing.intent, input.text),
    fallback: inferFallback(routeType),
    forceMode,
  };
}
