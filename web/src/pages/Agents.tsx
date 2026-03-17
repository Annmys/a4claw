import { useEffect, useState } from 'react';
import { api, type AgentRuntimeStatus, type CapabilitySnapshot } from '../api/client';
import {
  Bot, Shield, Code, Search, ListTodo, MessageSquare,
  Monitor, Hammer, Globe, Palette, GitBranch, Smartphone,
  Cpu, Zap, Loader2, CheckCircle2, AlertTriangle, XCircle, Wrench
} from 'lucide-react';

const AGENT_META: Record<string, {
  name: string;
  icon: any;
  color: string;
  borderColor: string;
  description: string;
}> = {
  'server-manager': { name: '服务器管理', icon: Monitor, color: 'bg-red-500/15 text-red-400', borderColor: 'border-l-red-500', description: 'SSH 服务器连接、命令执行、健康检查、部署与文件传输。' },
  'code-assistant': { name: '代码助手', icon: Code, color: 'bg-purple-500/15 text-purple-400', borderColor: 'border-l-purple-500', description: '代码编写、修复、构建、本地文件处理与 GitHub 协作。' },
  researcher: { name: '调研助手', icon: Search, color: 'bg-green-500/15 text-green-400', borderColor: 'border-l-green-500', description: '联网搜索、网页抓取、资料提炼与知识整理。' },
  'task-planner': { name: '任务规划', icon: ListTodo, color: 'bg-yellow-500/15 text-yellow-400', borderColor: 'border-l-yellow-500', description: '任务创建、状态跟踪、提醒和基础工作流管理。' },
  'task-executor': { name: '任务执行器', icon: Zap, color: 'bg-amber-500/15 text-amber-400', borderColor: 'border-l-amber-500', description: '自动拆任务、选工具、执行并留下结果。' },
  general: { name: '通用助手', icon: MessageSquare, color: 'bg-blue-500/15 text-blue-400', borderColor: 'border-l-blue-500', description: '通用问答、文本处理和基础辅助。' },
  'security-guard': { name: '安全守卫', icon: Shield, color: 'bg-orange-500/15 text-orange-400', borderColor: 'border-l-orange-500', description: '高风险操作审查与安全策略兜底。' },
  'desktop-controller': { name: '桌面控制', icon: Cpu, color: 'bg-indigo-500/15 text-indigo-400', borderColor: 'border-l-indigo-500', description: '真实桌面截图、点击、输入与视觉决策。' },
  'project-builder': { name: '项目构建', icon: Hammer, color: 'bg-teal-500/15 text-teal-400', borderColor: 'border-l-teal-500', description: '脚手架、构建、部署与工程初始化。' },
  'web-agent': { name: '网页代理', icon: Globe, color: 'bg-cyan-500/15 text-cyan-400', borderColor: 'border-l-cyan-500', description: '浏览器自动化、网页交互、表单与抓取。' },
  'content-creator': { name: '内容创作', icon: Palette, color: 'bg-pink-500/15 text-pink-400', borderColor: 'border-l-pink-500', description: '图文音视频生成与社媒发布协同。' },
  orchestrator: { name: '任务编排', icon: GitBranch, color: 'bg-amber-500/15 text-amber-400', borderColor: 'border-l-amber-500', description: '多智能体调度、本地与 OpenClaw 协同。' },
  'device-controller': { name: '设备控制', icon: Smartphone, color: 'bg-emerald-500/15 text-emerald-400', borderColor: 'border-l-emerald-500', description: 'ADB/Appium 驱动的 Android 设备自动化。' },
};

const TOOL_LABELS: Record<string, string> = {
  bash: '命令行',
  file: '文件',
  github: 'GitHub',
  search: '搜索',
  browser: '浏览器',
  task: '任务',
  cron: '定时任务',
  workflow: '工作流',
  auto: '自动执行',
  analytics: '分析',
  ssh: 'SSH',
  openclaw: 'OpenClaw',
  desktop: '桌面',
  device: '设备',
  social: '社媒发布',
  kie: 'Kie 内容',
  elevenlabs: 'ElevenLabs',
  firecrawl: 'Firecrawl',
  rapidapi: 'RapidAPI',
  apify: 'Apify',
  rag: '知识库',
  memory: '记忆',
  email: '邮件',
  trading: '交易',
  whatsapp: 'WhatsApp',
  deploy: '部署',
  'claude-code': 'Claude Code',
  facebook: 'Facebook',
  twitter: 'Twitter/X',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
};

function getStatusMeta(status: AgentRuntimeStatus['status']) {
  switch (status) {
    case 'ready':
      return { label: '可用', dot: 'bg-green-500', text: 'text-green-400', chip: 'bg-green-600/15 text-green-400 border-green-500/30' };
    case 'partial':
      return { label: '部分可用', dot: 'bg-yellow-500', text: 'text-yellow-400', chip: 'bg-yellow-600/15 text-yellow-400 border-yellow-500/30' };
    default:
      return { label: '不可用', dot: 'bg-red-500', text: 'text-red-400', chip: 'bg-red-600/15 text-red-400 border-red-500/30' };
  }
}

function getExecutionLabel(level: AgentRuntimeStatus['executionLevel']) {
  switch (level) {
    case 'full': return '真实执行';
    case 'limited': return '有限执行';
    default: return '不可执行';
  }
}

function getCapabilityStatusMeta(status: 'ready' | 'partial' | 'blocked') {
  switch (status) {
    case 'ready':
      return 'bg-green-600/15 text-green-400 border-green-500/30';
    case 'partial':
      return 'bg-yellow-600/15 text-yellow-400 border-yellow-500/30';
    default:
      return 'bg-red-600/15 text-red-400 border-red-500/30';
  }
}

export default function Agents() {
  const [data, setData] = useState<{ items: AgentRuntimeStatus[]; summary: { total: number; ready: number; partial: number; blocked: number }; providers: string[]; capabilities?: CapabilitySnapshot } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const reality = await api.dashboardAgentReality();
      const sorted = [...reality.items].sort((a, b) => {
        const score = { ready: 0, partial: 1, blocked: 2 };
        return score[a.status] - score[b.status];
      });
      setData({ ...reality, items: sorted });
    } catch {
      setData(null);
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-red-200">
          无法加载智能体真实可用性数据。
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3">
            <Bot className="w-7 h-7 text-primary-500" />
            <div>
              <h1 className="text-2xl font-bold">智能体真实可用性面板</h1>
              <p className="text-sm text-gray-400 mt-1">这里显示的是当前机器上真实能不能跑，不是静态宣传页。</p>
            </div>
          </div>
          <span className="px-3 py-1 rounded-full text-sm bg-green-600/15 text-green-400 border border-green-500/30">
            可用 {data.summary.ready}
          </span>
          <span className="px-3 py-1 rounded-full text-sm bg-yellow-600/15 text-yellow-400 border border-yellow-500/30">
            部分可用 {data.summary.partial}
          </span>
          <span className="px-3 py-1 rounded-full text-sm bg-red-600/15 text-red-400 border border-red-500/30">
            不可用 {data.summary.blocked}
          </span>
          <span className="px-3 py-1 rounded-full text-sm bg-dark-800 text-gray-300 border border-gray-700">
            提供方 {data.providers.length}
          </span>
        </div>

        <div className="rounded-xl border border-gray-800 bg-dark-800 p-4 text-sm text-gray-300">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Wrench className="w-4 h-4 text-primary-400" />
              <span>执行护栏已启用</span>
            </div>
            <span className="text-gray-600">|</span>
            <span>不可执行的智能体不会再继续假执行，会直接提示缺失依赖。</span>
          </div>
        </div>

        {data.capabilities && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-gray-800 bg-dark-800 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">插件系统</h2>
                <span className={`px-2 py-0.5 rounded-full border text-[11px] ${getCapabilityStatusMeta(data.capabilities.subsystems.plugins.status)}`}>
                  {data.capabilities.subsystems.plugins.status === 'ready' ? '可用' : data.capabilities.subsystems.plugins.status === 'partial' ? '部分可用' : '受阻'}
                </span>
              </div>
              <p className="text-sm text-gray-400">{data.capabilities.subsystems.plugins.detail}</p>
              <p className="text-xs text-gray-500">插件 {data.capabilities.subsystems.plugins.loadedCount}/{data.capabilities.subsystems.plugins.count}，工具 {data.capabilities.summary.pluginTools}</p>
            </div>

            <div className="rounded-xl border border-gray-800 bg-dark-800 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">记忆与知识库</h2>
                <span className={`px-2 py-0.5 rounded-full border text-[11px] ${getCapabilityStatusMeta(data.capabilities.subsystems.memory.status)}`}>
                  {data.capabilities.subsystems.memory.status === 'ready' ? '可用' : data.capabilities.subsystems.memory.status === 'partial' ? '部分可用' : '受阻'}
                </span>
              </div>
              <p className="text-sm text-gray-400">{data.capabilities.subsystems.memory.detail}</p>
              <p className="text-xs text-gray-500">文档 {data.capabilities.subsystems.memory.documents} · 切片 {data.capabilities.subsystems.memory.chunks}</p>
            </div>

            <div className="rounded-xl border border-gray-800 bg-dark-800 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">OpenClaw 协同</h2>
                <span className={`px-2 py-0.5 rounded-full border text-[11px] ${getCapabilityStatusMeta(data.capabilities.subsystems.openclaw.status)}`}>
                  {data.capabilities.subsystems.openclaw.status === 'ready' ? '可用' : data.capabilities.subsystems.openclaw.status === 'partial' ? '部分可用' : '受阻'}
                </span>
              </div>
              <p className="text-sm text-gray-400">{data.capabilities.subsystems.openclaw.detail}</p>
              <p className="text-xs text-gray-500">统一能力视图已接入当前页面</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.items.map((agent) => {
            const meta = AGENT_META[agent.id] ?? {
              name: agent.name,
              icon: Bot,
              color: 'bg-gray-500/15 text-gray-300',
              borderColor: 'border-l-gray-500',
              description: agent.summary,
            };
            const Icon = meta.icon;
            const statusMeta = getStatusMeta(agent.status);

            return (
              <div
                key={agent.id}
                className={`bg-dark-800 rounded-xl border border-gray-800 border-l-4 ${meta.borderColor} p-5 space-y-4`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${meta.color}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">{meta.name}</h3>
                      <div className="text-xs text-gray-500 font-mono mt-0.5">{agent.id}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs ${statusMeta.chip}`}>
                      <span className={`w-2 h-2 rounded-full ${statusMeta.dot}`} />
                      {statusMeta.label}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-1">{getExecutionLabel(agent.executionLevel)}</div>
                  </div>
                </div>

                <div>
                  <p className="text-sm text-gray-300">{meta.description}</p>
                  <p className="text-sm text-gray-400 mt-2 leading-relaxed">{agent.summary}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {agent.toolStatus.map((tool) => (
                    <span
                      key={`${agent.id}-${tool.name}`}
                      className={`text-[11px] px-2 py-1 rounded-full border ${
                        tool.status === 'ready'
                          ? 'bg-green-600/10 text-green-300 border-green-500/20'
                          : tool.status === 'partial'
                            ? 'bg-yellow-600/10 text-yellow-300 border-yellow-500/20'
                            : 'bg-red-600/10 text-red-300 border-red-500/20'
                      }`}
                      title={tool.detail}
                    >
                      {TOOL_LABELS[tool.name] ?? tool.name}
                    </span>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-gray-500 mb-1.5">已接通</div>
                    <div className="flex flex-wrap gap-1.5">
                      {agent.availableTools.length > 0 ? agent.availableTools.map((tool) => (
                        <span key={tool} className="px-2 py-0.5 rounded bg-green-600/10 text-green-300 border border-green-500/20 text-[11px]">
                          {TOOL_LABELS[tool] ?? tool}
                        </span>
                      )) : <span className="text-xs text-gray-600">无</span>}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-gray-500 mb-1.5">受阻项</div>
                    <div className="space-y-1.5">
                      {agent.missing.length > 0 ? agent.missing.slice(0, 4).map((item, index) => (
                        <div key={index} className="flex items-start gap-2 text-xs text-red-300">
                          <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                          <span>{item}</span>
                        </div>
                      )) : (
                        <div className="flex items-start gap-2 text-xs text-green-300">
                          <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                          <span>当前未发现阻塞项</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-gray-500 mb-1.5">验证证据</div>
                    <div className="space-y-1.5">
                      {agent.evidence.slice(0, 4).map((item, index) => (
                        <div key={index} className="flex items-start gap-2 text-xs text-gray-300">
                          {agent.status === 'blocked'
                            ? <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-yellow-400" />
                            : <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-green-500" />}
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
