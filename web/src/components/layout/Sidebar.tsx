import { NavLink } from 'react-router-dom';
import {
  MessageSquare, ListTodo, Server, Bot, Clock, Settings,
  LayoutDashboard, Sparkles, DollarSign, ScrollText, Timer, LineChart, Database, Brain, Network, Terminal, Zap, Monitor, Users, KanbanSquare, Shield
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { decodeJwtRole } from '../../utils/auth-role';

interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  adminOnly?: boolean;
}

const links: NavItem[] = [
  { to: '/dashboard', icon: LayoutDashboard, label: '仪表盘', adminOnly: true },
  { to: '/', icon: MessageSquare, label: '聊天' },
  { to: '/openclaw', icon: Terminal, label: 'OpenClaw', adminOnly: true },
  { to: '/tasks', icon: ListTodo, label: '任务', adminOnly: true },
  { to: '/command-center', icon: KanbanSquare, label: '旨意看板', adminOnly: true },
  { to: '/approval-gates', icon: Shield, label: '审批闸门', adminOnly: true },
  { to: '/skills', icon: Sparkles, label: '技能' },
  { to: '/browser', icon: Monitor, label: '浏览器', adminOnly: true },
  { to: '/terminal', icon: Terminal, label: 'SSH 终端', adminOnly: true },
  { to: '/servers', icon: Server, label: '服务器', adminOnly: true },
  { to: '/agents', icon: Bot, label: '智能体' },
  { to: '/cron', icon: Timer, label: '定时任务' },
  { to: '/trading', icon: LineChart, label: '交易', adminOnly: true },
  { to: '/knowledge', icon: Database, label: '知识库' },
  { to: '/intelligence', icon: Brain, label: '智能中心', adminOnly: true },
  { to: '/evolution', icon: Zap, label: '进化' },
  { to: '/graph', icon: Network, label: '系统图谱', adminOnly: true },
  { to: '/costs', icon: DollarSign, label: '成本', adminOnly: true },
  { to: '/logs', icon: ScrollText, label: '日志' },
  { to: '/history', icon: Clock, label: '历史记录' },
  { to: '/users', icon: Users, label: '用户管理', adminOnly: true },
  { to: '/settings', icon: Settings, label: '设置' },
];

export default function Sidebar() {
  const token = useAuthStore((s) => s.token);
  const role = decodeJwtRole(token);

  return (
    <aside className="w-64 bg-dark-900 border-r border-gray-800/50 flex flex-col">
      {/* Logo */}
      <div className="p-5 border-b border-gray-800/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-primary-500 to-primary-700 shadow-lg shadow-primary-600/20">
            <span className="text-xl leading-none select-none" role="img" aria-label="logo">🐙</span>
          </div>
          <div>
            <h2 className="text-base font-bold tracking-tight bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">a4claw</h2>
            <p className="text-[10px] text-gray-500 font-medium tracking-wider uppercase">v6.0 Pro</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {links
          .filter((link) => !link.adminOnly || role === 'admin')
          .map(link => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 group ${
                isActive
                  ? 'bg-gradient-to-r from-primary-600/90 to-primary-700/90 text-white shadow-md shadow-primary-600/10'
                  : 'text-gray-400 hover:bg-dark-800/80 hover:text-gray-200'
              }`
            }
          >
            <link.icon className="w-[18px] h-[18px] transition-transform duration-200 group-hover:scale-110" />
            <span className="text-[13px] font-medium">{link.label}</span>
          </NavLink>
          ))}
      </nav>

      {/* Status footer */}
      <div className="p-4 border-t border-gray-800/50">
        <div className="flex items-center gap-2.5">
          <div className="w-2 h-2 bg-green-400 rounded-full pulse-dot" />
          <span className="text-[11px] text-gray-500 font-medium">系统在线</span>
        </div>
      </div>
    </aside>
  );
}
