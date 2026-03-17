import React, { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  CheckCircle,
  Clock,
  AlertTriangle,
  Users,
  Server,
  Cpu,
  TrendingUp,
  RefreshCw,
  Zap,
  Pause,
  Play,
  XCircle,
} from 'lucide-react';
import { api, type CommandCenterTask, type CommandCenterTaskRun } from '../api/client';

interface SystemMetrics {
  activeTasks: number;
  pendingApprovals: number;
  runningWorkflows: number;
  activeCollaborations: number;
  cpuUsage: number;
  memoryUsage: number;
  queueDepth: number;
  throughput: number; // tasks/min
}

interface LiveTask extends CommandCenterTask {
  runs: CommandCenterTaskRun[];
  dependencies: string[];
  dependents: string[];
}

interface RealTimeMonitorProps {
  refreshInterval?: number;
  onTaskClick?: (taskId: string) => void;
}

export function RealTimeMonitor({ refreshInterval = 5000, onTaskClick }: RealTimeMonitorProps) {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [tasks, setTasks] = useState<LiveTask[]>([]);
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [collaborations, setCollaborations] = useState<any[]>([]);
  const [isConnected, setIsConnected] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [selectedView, setSelectedView] = useState<'overview' | 'tasks' | 'workflows' | 'collaborations'>('overview');

  // Fetch data
  const fetchData = useCallback(async () => {
    try {
      const [overview, dag, pendingApprovals] = await Promise.all([
        api.dashboardStatus(),
        api.get('/command-center/dag'),
        api.getPendingApprovals(),
      ]);

      // Calculate metrics
      const activeTasks = overview.tasks?.filter((t: any) => 
        ['in_progress', 'assigned', 'triage'].includes(t.status)
      ).length || 0;

      setMetrics({
        activeTasks,
        pendingApprovals: pendingApprovals.requests?.length || 0,
        runningWorkflows: 0, // TODO: Get from workflow engine
        activeCollaborations: 0, // TODO: Get from coordinator
        cpuUsage: overview.system?.cpu || 0,
        memoryUsage: overview.system?.memory || 0,
        queueDepth: overview.queue?.depth || 0,
        throughput: overview.metrics?.throughput || 0,
      });

      if (dag.dag) {
        setTasks(dag.dag.nodes.map((n: any) => ({
          ...n,
          dependencies: n.dependencies?.map((d: any) => d.dependsOnTaskId) || [],
          dependents: n.dependents?.map((d: any) => d.taskId) || [],
        })));
      }

      setLastUpdate(new Date());
      setIsConnected(true);
    } catch (error) {
      console.error('Failed to fetch metrics:', error);
      setIsConnected(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchData, refreshInterval]);

  // Status badge component
  const StatusBadge = ({ status }: { status: string }) => {
    const colors: Record<string, string> = {
      incoming: 'bg-slate-500',
      triage: 'bg-cyan-500',
      assigned: 'bg-blue-500',
      in_progress: 'bg-amber-500',
      review: 'bg-fuchsia-500',
      done: 'bg-emerald-500',
      blocked: 'bg-rose-500',
      pending: 'bg-slate-500',
      running: 'bg-blue-500',
      succeeded: 'bg-emerald-500',
      failed: 'bg-rose-500',
    };

    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white ${colors[status] || 'bg-slate-500'}`}>
        {status.replace('_', ' ')}
      </span>
    );
  };

  // Metric card component
  const MetricCard = ({ 
    title, 
    value, 
    icon: Icon, 
    color,
    trend,
  }: { 
    title: string; 
    value: string | number; 
    icon: any; 
    color: string;
    trend?: number;
  }) => (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-400">{title}</p>
          <p className={`text-2xl font-bold mt-1 text-${color}-400`}>{value}</p>
          {trend !== undefined && (
            <p className={`text-xs mt-1 ${trend >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}%
            </p>
          )}
        </div>
        <div className={`p-2 rounded-lg bg-${color}-500/20`}>
          <Icon className={`w-5 h-5 text-${color}-400`} />
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-full bg-slate-900 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-slate-100">Real-time Monitor</h2>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
            <span className="text-sm text-slate-400">
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
            {lastUpdate && (
              <span className="text-xs text-slate-500">
                Last update: {lastUpdate.toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded-lg 
              transition-colors"
            title="Refresh now"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          {[
            { id: 'overview', label: 'Overview', icon: Activity },
            { id: 'tasks', label: 'Tasks', icon: CheckCircle },
            { id: 'workflows', label: 'Workflows', icon: Zap },
            { id: 'collaborations', label: 'Collaborations', icon: Users },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSelectedView(id as any)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors
                ${selectedView === id 
                  ? 'bg-blue-600 text-white' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {selectedView === 'overview' && metrics && (
          <div className="space-y-6">
            {/* Metrics Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard
                title="Active Tasks"
                value={metrics.activeTasks}
                icon={CheckCircle}
                color="blue"
              />
              <MetricCard
                title="Pending Approvals"
                value={metrics.pendingApprovals}
                icon={Clock}
                color="amber"
              />
              <MetricCard
                title="Queue Depth"
                value={metrics.queueDepth}
                icon={Server}
                color="purple"
              />
              <MetricCard
                title="Throughput"
                value={`${metrics.throughput}/min`}
                icon={TrendingUp}
                color="emerald"
              />
            </div>

            {/* System Resources */}
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <h3 className="text-sm font-medium text-slate-200 mb-4">System Resources</h3>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-slate-400">CPU Usage</span>
                    <span className="text-slate-200">{metrics.cpuUsage.toFixed(1)}%</span>
                  </div>
                  <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        metrics.cpuUsage > 80 ? 'bg-rose-500' : 
                        metrics.cpuUsage > 60 ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${metrics.cpuUsage}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-slate-400">Memory Usage</span>
                    <span className="text-slate-200">{metrics.memoryUsage.toFixed(1)}%</span>
                  </div>
                  <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        metrics.memoryUsage > 80 ? 'bg-rose-500' : 
                        metrics.memoryUsage > 60 ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${metrics.memoryUsage}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Recent Activity */}
            <div className="bg-slate-800 rounded-lg border border-slate-700">
              <div className="px-4 py-3 border-b border-slate-700">
                <h3 className="text-sm font-medium text-slate-200">Task Status Distribution</h3>
              </div>
              <div className="p-4">
                <div className="flex items-end gap-2 h-32">
                  {['incoming', 'triage', 'assigned', 'in_progress', 'review', 'done', 'blocked'].map(status => {
                    const count = tasks.filter(t => t.status === status).length;
                    const maxCount = Math.max(...['incoming', 'triage', 'assigned', 'in_progress', 'review', 'done', 'blocked']
                      .map(s => tasks.filter(t => t.status === s).length), 1);
                    const height = count > 0 ? (count / maxCount) * 100 : 0;
                    
                    return (
                      <div key={status} className="flex-1 flex flex-col items-center gap-2">
                        <div className="text-xs text-slate-500">{count}</div>
                        <div
                          className="w-full bg-slate-700 rounded-t-sm transition-all duration-500"
                          style={{ height: `${height}%`, minHeight: count > 0 ? '4px' : '0' }}
                        >
                          <div className={`w-full h-full rounded-t-sm ${
                            status === 'incoming' ? 'bg-slate-500' :
                            status === 'triage' ? 'bg-cyan-500' :
                            status === 'assigned' ? 'bg-blue-500' :
                            status === 'in_progress' ? 'bg-amber-500' :
                            status === 'review' ? 'bg-fuchsia-500' :
                            status === 'done' ? 'bg-emerald-500' :
                            'bg-rose-500'
                          }`} />
                        </div>
                        <div className="text-xs text-slate-400 capitalize">{status.replace('_', ' ')}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {selectedView === 'tasks' && (
          <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
            <table className="w-full">
              <thead className="bg-slate-700/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Task</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Deps</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {tasks.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                      No tasks available
                    </td>
                  </tr>
                ) : (
                  tasks.map(task => (
                    <tr key={task.id} className="hover:bg-slate-700/50">
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-slate-200">{task.title}</div>
                        <div className="text-xs text-slate-500">{task.id.slice(0, 8)}...{/div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={task.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          {task.dependencies.length > 0 && (
                            <span className="flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              {task.dependencies.length} deps
                            </span>
                          )}
                          {task.dependents.length > 0 && (
                            <span className="flex items-center gap-1">
                              <CheckCircle className="w-3 h-3" />
                              {task.dependents.length} dependents
                            </span>
                          )}
                          {task.dependencies.length === 0 && task.dependents.length === 0 && (
                            <span>None</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => onTaskClick?.(task.id)}
                            className="p-1.5 text-slate-400 hover:text-blue-400 
                              hover:bg-blue-500/10 rounded transition-colors"
                            title="View details"
                          >
                            <Activity className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {selectedView === 'workflows' && (
          <div className="text-center py-12 text-slate-500">
            <Zap className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>Workflow monitoring coming soon</p>
          </div>
        )}

        {selectedView === 'collaborations' && (
          <div className="text-center py-12 text-slate-500">
            <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>Collaboration monitoring coming soon</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default RealTimeMonitor;
