import { useEffect, useState } from 'react';
import { api } from '../api/client';
import {
  Bot, Shield, Code, Search, ListTodo, MessageSquare,
  Monitor, Hammer, Globe, Palette, GitBranch, Smartphone,
  Cpu, Zap, Loader2, CheckCircle2, LucideIcon
} from 'lucide-react';

interface AgentDef {
  id: string;
  name: string;
  icon: LucideIcon;
  color: string;
  borderColor: string;
  description: string;
  capabilities: string[];
  tools: string[];
}

const AGENTS: AgentDef[] = [
  {
    id: 'server-manager',
    name: '服务器管理',
    icon: Monitor,
    color: 'bg-red-500/15 text-red-400',
    borderColor: 'border-l-red-500',
    description: '负责 SSH 连接、Docker 管理、监控、部署，以及远程服务器自动修复。',
    capabilities: ['通过 SSH 登录服务器并执行命令', '管理 Docker 容器生命周期', '执行系统监控与自动修复'],
    tools: ['SSH', 'Docker', 'PM2', 'Nginx'],
  },
  {
    id: 'code-assistant',
    name: '代码助手',
    icon: Code,
    color: 'bg-purple-500/15 text-purple-400',
    borderColor: 'border-l-purple-500',
    description: '负责 GitHub 仓库管理、拉取请求、代码审查与问题跟踪。',
    capabilities: ['克隆仓库并管理分支', '创建和审查拉取请求', '自动代码审查与改进建议'],
    tools: ['GitHub', 'Git', 'ESLint', 'Prettier'],
  },
  {
    id: 'researcher',
    name: '调研助手',
    icon: Search,
    color: 'bg-green-500/15 text-green-400',
    borderColor: 'border-l-green-500',
    description: '负责网页搜索、内容总结、数据分析与趋势调研。',
    capabilities: ['搜索实时网页信息', '总结文章与文档', '做对比分析与报告'],
    tools: ['Web Search', 'Scraper', 'Summarizer'],
  },
  {
    id: 'task-planner',
    name: '任务规划',
    icon: ListTodo,
    color: 'bg-yellow-500/15 text-yellow-400',
    borderColor: 'border-l-yellow-500',
    description: '负责任务管理、提醒、排期与项目规划。',
    capabilities: ['创建并跟踪带截止时间的任务', '设置周期性提醒', '将复杂项目拆解成执行步骤'],
    tools: ['Tasks DB', 'Cron', 'Calendar'],
  },
  {
    id: 'general',
    name: '通用助手',
    icon: MessageSquare,
    color: 'bg-blue-500/15 text-blue-400',
    borderColor: 'border-l-blue-500',
    description: '负责通用对话、问答、创作与日常辅助。',
    capabilities: ['回答各类问题', '创意写作与头脑风暴', '翻译与文本处理'],
    tools: ['LLM', 'TTS', 'Translation'],
  },
  {
    id: 'security-guard',
    name: '安全守卫',
    icon: Shield,
    color: 'bg-orange-500/15 text-orange-400',
    borderColor: 'border-l-orange-500',
    description: '负责审查危险命令、校验操作并执行安全策略。',
    capabilities: ['执行前校验命令', '识别潜在危险操作', '提供审计轨迹与权限检查'],
    tools: ['Validator', 'Audit Log', 'Policy Engine'],
  },
  {
    id: 'desktop-controller',
    name: '桌面控制',
    icon: Cpu,
    color: 'bg-indigo-500/15 text-indigo-400',
    borderColor: 'border-l-indigo-500',
    description: '通过 nutjs 执行桌面自动化，包括鼠标、键盘与屏幕控制。',
    capabilities: ['鼠标移动与点击自动化', '键盘输入与快捷键控制', '屏幕截图与 OCR 识别'],
    tools: ['nutjs', 'Screen OCR', 'Clipboard'],
  },
  {
    id: 'project-builder',
    name: '项目构建',
    icon: Hammer,
    color: 'bg-teal-500/15 text-teal-400',
    borderColor: 'border-l-teal-500',
    description: '负责项目脚手架、模板代码生成与构建流水线配置。',
    capabilities: ['生成完整项目结构', '按最佳实践生成模板代码', '配置 CI/CD 流水线'],
    tools: ['Templates', 'NPM', 'Git Init', 'Docker'],
  },
  {
    id: 'web-agent',
    name: '网页代理',
    icon: Globe,
    color: 'bg-cyan-500/15 text-cyan-400',
    borderColor: 'border-l-cyan-500',
    description: '负责浏览器自动化、网页抓取、表单填写与网站测试。',
    capabilities: ['自动执行浏览器交互', '抓取并提取网页数据', '填写表单并执行界面测试'],
    tools: ['Puppeteer', 'Cheerio', 'Fetch'],
  },
  {
    id: 'content-creator',
    name: '内容创作',
    icon: Palette,
    color: 'bg-pink-500/15 text-pink-400',
    borderColor: 'border-l-pink-500',
    description: '负责内容生成、社媒文案、营销文案与创意素材。',
    capabilities: ['生成博客文章与长文', '创建社交媒体内容', '撰写营销文案与广告'],
    tools: ['LLM', 'Image Gen', 'Markdown'],
  },
  {
    id: 'orchestrator',
    name: '任务编排',
    icon: GitBranch,
    color: 'bg-amber-500/15 text-amber-400',
    borderColor: 'border-l-amber-500',
    description: '负责多智能体协同、复杂任务拆解与流水线执行。',
    capabilities: ['按顺序协调多个智能体', '自动拆解复杂任务', '管理执行流水线与重试'],
    tools: ['Agent Router', 'Pipeline', 'Queue'],
  },
  {
    id: 'device-controller',
    name: '设备控制',
    icon: Smartphone,
    color: 'bg-emerald-500/15 text-emerald-400',
    borderColor: 'border-l-emerald-500',
    description: '负责 IoT 设备管理、智能家居控制与设备自动化。',
    capabilities: ['控制 IoT 设备与传感器', '执行智能家居自动化流程', '监控设备状态与健康度'],
    tools: ['MQTT', 'HTTP', 'Webhooks'],
  },
];

export default function Agents() {
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const data = await api.dashboardStatus();
      setDashboardData(data);
    } catch {
      // 回退到静态智能体列表
    }
    setLoading(false);
  };

  const getAgentStatus = (agentId: string): string => {
    if (!dashboardData?.agents) return '活跃';
    const found = dashboardData.agents.find?.((a: any) => a.id === agentId || a.name === agentId);
    return found?.status ?? '活跃';
  };

  const getStatusLabel = (status: string) => {
    switch (status.toLowerCase()) {
      case 'active':
      case 'online':
      case 'running':
      case '活跃':
        return '活跃';
      case 'idle':
      case 'standby':
      case '待命':
        return '待命';
      case 'disabled':
      case 'offline':
      case '离线':
        return '离线';
      default:
        return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'active':
      case 'online':
      case 'running':
      case '活跃':
        return { dot: 'bg-green-500', text: 'text-green-400' };
      case 'idle':
      case 'standby':
      case '待命':
        return { dot: 'bg-yellow-500', text: 'text-yellow-400' };
      case 'disabled':
      case 'offline':
      case '离线':
        return { dot: 'bg-red-500', text: 'text-red-400' };
      default:
        return { dot: 'bg-green-500', text: 'text-green-400' };
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  const activeCount = AGENTS.filter(a => {
    const status = getAgentStatus(a.id);
    return ['active', 'online', 'running', '活跃'].includes(status.toLowerCase());
  }).length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Bot className="w-7 h-7 text-primary-500" />
          <h1 className="text-2xl font-bold">智能体</h1>
          <span className="text-sm bg-green-600/20 text-green-400 px-3 py-0.5 rounded-full font-medium">
            {activeCount} 个活跃
          </span>
          <span className="text-sm text-gray-500">/ 共 {AGENTS.length} 个</span>
        </div>

        {/* System info bar */}
        {dashboardData && (
          <div className="flex items-center gap-4 mb-6 p-3 bg-dark-800 rounded-lg border border-gray-800 text-sm text-gray-400">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-400" />
              <span>路由引擎在线</span>
            </div>
            <span className="text-gray-700">|</span>
            <span>系统会根据消息意图自动选择智能体</span>
          </div>
        )}

        {/* Agent Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {AGENTS.map(agent => {
            const status = getAgentStatus(agent.id);
            const statusColor = getStatusColor(status);
            const Icon = agent.icon;

            return (
              <div
                key={agent.id}
                className={`bg-dark-800 rounded-lg border border-gray-800 border-l-4 ${agent.borderColor} hover:border-gray-600 hover:shadow-lg hover:shadow-black/20 transition-all duration-200 group`}
              >
                <div className="p-5">
                  {/* Agent header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${agent.color}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white group-hover:text-primary-400 transition-colors">
                          {agent.name}
                        </h3>
                        <span className="text-xs text-gray-500 font-mono">{agent.id}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <div className={`w-2 h-2 rounded-full ${statusColor.dot} animate-pulse`} />
                      <span className={`text-xs font-medium ${statusColor.text}`}>{getStatusLabel(status)}</span>
                    </div>
                  </div>

                  {/* Description */}
                  <p className="text-sm text-gray-400 mb-4 leading-relaxed">{agent.description}</p>

                  {/* Capabilities */}
                  <div className="mb-4 space-y-1.5">
                    {agent.capabilities.map((cap, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-gray-300">
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 flex-shrink-0" />
                        <span>{cap}</span>
                      </div>
                    ))}
                  </div>

                  {/* Tools */}
                  <div className="flex flex-wrap gap-1.5 pt-3 border-t border-gray-800/80">
                    {agent.tools.map(tool => (
                      <span
                        key={tool}
                        className="text-[10px] px-2 py-0.5 rounded bg-dark-900 text-gray-400 border border-gray-700/50 font-medium"
                      >
                        {tool}
                      </span>
                    ))}
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
