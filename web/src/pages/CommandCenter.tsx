import { useEffect, useMemo, useState } from 'react';
import {
  api,
  type CommandCenterCenter,
  type CommandCenterDepartment,
  type CommandCenterMember,
  type CommandCenterOverview,
  type CommandCenterTask,
  type CommandCenterTaskDetail,
  type TaskExecutorAuditItem,
} from '../api/client';
import {
  AlertCircle,
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  ClipboardList,
  Flag,
  KanbanSquare,
  Loader2,
  MessageSquareText,
  Plus,
  ShieldCheck,
  UserRound,
  Users2,
} from 'lucide-react';

const STATUS_META: Array<{
  key: CommandCenterTask['status'];
  label: string;
  accent: string;
  border: string;
  pill: string;
}> = [
  { key: 'incoming', label: '待接收', accent: 'text-slate-200', border: 'border-slate-700', pill: 'bg-slate-500/15 text-slate-300' },
  { key: 'triage', label: '待研判', accent: 'text-cyan-300', border: 'border-cyan-500/30', pill: 'bg-cyan-500/15 text-cyan-300' },
  { key: 'assigned', label: '已分派', accent: 'text-blue-300', border: 'border-blue-500/30', pill: 'bg-blue-500/15 text-blue-300' },
  { key: 'in_progress', label: '执行中', accent: 'text-amber-300', border: 'border-amber-500/30', pill: 'bg-amber-500/15 text-amber-300' },
  { key: 'review', label: '待复核', accent: 'text-fuchsia-300', border: 'border-fuchsia-500/30', pill: 'bg-fuchsia-500/15 text-fuchsia-300' },
  { key: 'done', label: '已完成', accent: 'text-emerald-300', border: 'border-emerald-500/30', pill: 'bg-emerald-500/15 text-emerald-300' },
  { key: 'blocked', label: '阻塞', accent: 'text-rose-300', border: 'border-rose-500/30', pill: 'bg-rose-500/15 text-rose-300' },
];

const PRIORITY_META: Record<CommandCenterTask['priority'], string> = {
  low: 'bg-slate-500/15 text-slate-300',
  medium: 'bg-blue-500/15 text-blue-300',
  high: 'bg-amber-500/15 text-amber-300',
  critical: 'bg-rose-500/15 text-rose-300',
};

function formatDateTime(value?: string | null): string {
  if (!value) return '未设置';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusLabel(status: CommandCenterTask['status']) {
  return STATUS_META.find((item) => item.key === status)?.label ?? status;
}

function formatAuditAction(action: string) {
  switch (action) {
    case 'task_executor.dispatched':
      return '任务已派发';
    case 'task_executor.crew_triggered':
      return '触发多智能体调度';
    default:
      return action;
  }
}

export default function CommandCenter() {
  const [overview, setOverview] = useState<CommandCenterOverview | null>(null);
  const [detail, setDetail] = useState<CommandCenterTaskDetail | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [centerFilter, setCenterFilter] = useState<string>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [executorAudit, setExecutorAudit] = useState<TaskExecutorAuditItem[]>([]);

  const [centerForm, setCenterForm] = useState({ name: '', code: '', description: '' });
  const [departmentForm, setDepartmentForm] = useState({ centerId: '', name: '', code: '' });
  const [memberForm, setMemberForm] = useState({ centerId: '', departmentId: '', displayName: '', employeeCode: '', roleTitle: '' });
  const [taskForm, setTaskForm] = useState({
    centerId: '',
    departmentId: '',
    assigneeMemberId: '',
    title: '',
    description: '',
    priority: 'medium' as CommandCenterTask['priority'],
    status: 'incoming' as CommandCenterTask['status'],
    dueAt: '',
    requestedBy: '',
    tags: '',
  });
  const [eventNote, setEventNote] = useState('');

  const loadOverview = async (keepSelection = true) => {
    try {
      const [data, auditTrail] = await Promise.all([
        api.commandCenterOverview(),
        api.getTaskExecutorAuditTrail(20).catch(() => ({ items: [] as TaskExecutorAuditItem[] })),
      ]);
      setOverview(data);
      setExecutorAudit(auditTrail.items);
      setError('');
      if (!keepSelection || !selectedTaskId || !data.tasks.some((task) => task.id === selectedTaskId)) {
        setSelectedTaskId(data.tasks[0]?.id ?? null);
      }
      if (!departmentForm.centerId && data.centers[0]) {
        setDepartmentForm((prev) => ({ ...prev, centerId: data.centers[0].id }));
      }
      if (!memberForm.centerId && data.centers[0]) {
        setMemberForm((prev) => ({ ...prev, centerId: data.centers[0].id }));
      }
      if (!taskForm.centerId && data.centers[0]) {
        setTaskForm((prev) => ({ ...prev, centerId: data.centers[0].id }));
      }
    } catch (err: any) {
      setError(err.message ?? '加载任务中枢失败');
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (taskId: string) => {
    try {
      const data = await api.commandCenterTaskDetail(taskId);
      setDetail(data);
    } catch (err: any) {
      setError(err.message ?? '加载任务详情失败');
    }
  };

  useEffect(() => {
    loadOverview(false);
  }, []);

  useEffect(() => {
    if (!selectedTaskId) {
      setDetail(null);
      return;
    }
    loadDetail(selectedTaskId);
  }, [selectedTaskId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const centers = overview?.centers ?? [];
  const departments = overview?.departments ?? [];
  const members = overview?.members ?? [];
  const tasks = overview?.tasks ?? [];

  const filteredDepartments = useMemo(() => {
    if (centerFilter === 'all') return departments;
    return departments.filter((department) => department.centerId === centerFilter);
  }, [centerFilter, departments]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (centerFilter !== 'all' && task.centerId !== centerFilter) return false;
      if (departmentFilter !== 'all' && task.departmentId !== departmentFilter) return false;
      return true;
    });
  }, [centerFilter, departmentFilter, tasks]);

  const departmentsForTaskForm = useMemo(() => {
    if (!taskForm.centerId) return departments;
    return departments.filter((department) => department.centerId === taskForm.centerId);
  }, [departments, taskForm.centerId]);

  const membersForTaskForm = useMemo(() => {
    return members.filter((member) => {
      if (taskForm.centerId && member.centerId !== taskForm.centerId) return false;
      if (taskForm.departmentId && member.departmentId !== taskForm.departmentId) return false;
      return true;
    });
  }, [members, taskForm.centerId, taskForm.departmentId]);

  const departmentsForMemberForm = useMemo(() => {
    if (!memberForm.centerId) return departments;
    return departments.filter((department) => department.centerId === memberForm.centerId);
  }, [departments, memberForm.centerId]);

  const lookupCenter = (centerId: string): CommandCenterCenter | undefined => centers.find((item) => item.id === centerId);
  const lookupDepartment = (departmentId?: string | null): CommandCenterDepartment | undefined =>
    departmentId ? departments.find((item) => item.id === departmentId) : undefined;
  const lookupMember = (memberId?: string | null): CommandCenterMember | undefined =>
    memberId ? members.find((item) => item.id === memberId) : undefined;

  const setBusyAction = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const handleCreateCenter = async () => {
    if (!centerForm.name.trim()) return;
    await setBusyAction(async () => {
      await api.commandCenterCreateCenter({
        name: centerForm.name.trim(),
        code: centerForm.code.trim() || undefined,
        description: centerForm.description.trim() || undefined,
      });
      setCenterForm({ name: '', code: '', description: '' });
      await loadOverview(false);
      setNotice('中心已创建');
    });
  };

  const handleCreateDepartment = async () => {
    if (!departmentForm.centerId || !departmentForm.name.trim()) return;
    await setBusyAction(async () => {
      await api.commandCenterCreateDepartment({
        centerId: departmentForm.centerId,
        name: departmentForm.name.trim(),
        code: departmentForm.code.trim() || undefined,
      });
      setDepartmentForm((prev) => ({ ...prev, name: '', code: '' }));
      await loadOverview(false);
      setNotice('部门已创建');
    });
  };

  const handleCreateMember = async () => {
    if (!memberForm.centerId || !memberForm.displayName.trim()) return;
    await setBusyAction(async () => {
      await api.commandCenterCreateMember({
        centerId: memberForm.centerId,
        departmentId: memberForm.departmentId || null,
        displayName: memberForm.displayName.trim(),
        employeeCode: memberForm.employeeCode.trim() || undefined,
        roleTitle: memberForm.roleTitle.trim() || undefined,
      });
      setMemberForm((prev) => ({ ...prev, displayName: '', employeeCode: '', roleTitle: '' }));
      await loadOverview(false);
      setNotice('员工已创建');
    });
  };

  const handleCreateTask = async () => {
    if (!taskForm.centerId || !taskForm.title.trim()) return;
    await setBusyAction(async () => {
      const result = await api.commandCenterCreateTask({
        centerId: taskForm.centerId,
        departmentId: taskForm.departmentId || null,
        assigneeMemberId: taskForm.assigneeMemberId || null,
        title: taskForm.title.trim(),
        description: taskForm.description.trim() || undefined,
        priority: taskForm.priority,
        status: taskForm.status,
        dueAt: taskForm.dueAt ? new Date(taskForm.dueAt).toISOString() : null,
        requestedBy: taskForm.requestedBy.trim() || undefined,
        tags: taskForm.tags.split(',').map((item) => item.trim()).filter(Boolean),
      });
      setTaskForm((prev) => ({
        ...prev,
        title: '',
        description: '',
        dueAt: '',
        requestedBy: '',
        tags: '',
        assigneeMemberId: '',
      }));
      await loadOverview(false);
      setSelectedTaskId(result.task.id);
      setNotice('任务已创建');
    });
  };

  const handleUpdateStatus = async (status: CommandCenterTask['status']) => {
    if (!detail?.task.id) return;
    await setBusyAction(async () => {
      await api.commandCenterUpdateTaskStatus(detail.task.id, status);
      await loadOverview();
      await loadDetail(detail.task.id);
      setNotice(`状态已切换到 ${statusLabel(status)}`);
    });
  };

  const handleAddEvent = async () => {
    if (!detail?.task.id || !eventNote.trim()) return;
    await setBusyAction(async () => {
      await api.commandCenterAddTaskEvent(detail.task.id, eventNote.trim());
      setEventNote('');
      await loadOverview();
      await loadDetail(detail.task.id);
      setNotice('审计记录已写入');
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-dark-950">
      <div className="px-6 py-5 border-b border-gray-800/70 bg-dark-900">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <KanbanSquare className="w-7 h-7 text-primary-400" />
              <div>
                <h1 className="text-2xl font-bold text-white">旨意看板</h1>
                <p className="text-sm text-gray-400">为未来的中心 / 部门 / 员工协作提供统一任务中枢与审计轨迹。</p>
              </div>
            </div>
          </div>

          <div className="flex gap-3 flex-wrap">
            {[
              { label: '中心', value: overview?.summary.centers ?? 0, icon: Building2, tone: 'text-cyan-300' },
              { label: '部门', value: overview?.summary.departments ?? 0, icon: BriefcaseBusiness, tone: 'text-blue-300' },
              { label: '员工', value: overview?.summary.members ?? 0, icon: Users2, tone: 'text-amber-300' },
              { label: '任务', value: overview?.summary.tasks ?? 0, icon: ClipboardList, tone: 'text-emerald-300' },
            ].map((item) => (
              <div key={item.label} className="min-w-[120px] rounded-2xl border border-gray-800 bg-dark-800/80 px-4 py-3">
                <div className={`flex items-center gap-2 text-xs uppercase tracking-[0.18em] ${item.tone}`}>
                  <item.icon className="w-3.5 h-3.5" />
                  {item.label}
                </div>
                <div className="mt-2 text-2xl font-semibold text-white">{item.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <select
            value={centerFilter}
            onChange={(event) => {
              const value = event.target.value;
              setCenterFilter(value);
              setDepartmentFilter('all');
            }}
            className="rounded-xl border border-gray-700 bg-dark-800 px-3 py-2 text-sm text-white"
          >
            <option value="all">全部中心</option>
            {centers.map((center) => (
              <option key={center.id} value={center.id}>{center.name}</option>
            ))}
          </select>

          <select
            value={departmentFilter}
            onChange={(event) => setDepartmentFilter(event.target.value)}
            className="rounded-xl border border-gray-700 bg-dark-800 px-3 py-2 text-sm text-white"
          >
            <option value="all">全部部门</option>
            {filteredDepartments.map((department) => (
              <option key={department.id} value={department.id}>{department.name}</option>
            ))}
          </select>
        </div>

        {(error || notice) && (
          <div className={`mt-4 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${
            error
              ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
          }`}>
            {error ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
            <span>{error || notice}</span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden grid grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_420px]">
        <div className="overflow-x-auto overflow-y-hidden p-5">
          {filteredTasks.length === 0 ? (
            <div className="h-full rounded-3xl border border-dashed border-gray-700 bg-dark-900/70 flex flex-col items-center justify-center text-center px-6">
              <CircleDashed className="w-12 h-12 text-gray-600 mb-4" />
              <h2 className="text-lg font-semibold text-white">任务中枢已就绪，但还没有任务</h2>
              <p className="mt-2 max-w-xl text-sm text-gray-400">
                先在右侧创建中心、部门、员工和第一条旨意任务。当前版本已经支持看板流转和审计备注，后续再接执行编排与技能调度。
              </p>
            </div>
          ) : (
            <div className="min-w-[1320px] grid grid-cols-7 gap-4 h-full">
              {STATUS_META.map((column) => {
                const columnTasks = filteredTasks.filter((task) => task.status === column.key);
                return (
                  <div key={column.key} className={`rounded-3xl border bg-dark-900/80 ${column.border} flex flex-col min-h-0`}>
                    <div className="px-4 py-4 border-b border-gray-800/70">
                      <div className="flex items-center justify-between">
                        <div className={`text-sm font-semibold ${column.accent}`}>{column.label}</div>
                        <div className={`rounded-full px-2.5 py-1 text-xs ${column.pill}`}>{columnTasks.length}</div>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 space-y-3">
                      {columnTasks.map((task) => {
                        const center = lookupCenter(task.centerId);
                        const department = lookupDepartment(task.departmentId);
                        const assignee = lookupMember(task.assigneeMemberId);
                        const isActive = task.id === selectedTaskId;

                        return (
                          <button
                            key={task.id}
                            onClick={() => setSelectedTaskId(task.id)}
                            className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                              isActive
                                ? 'border-primary-500/50 bg-primary-500/10 shadow-lg shadow-primary-900/20'
                                : 'border-gray-800 bg-dark-800/90 hover:border-gray-700 hover:bg-dark-800'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="text-sm font-semibold text-white line-clamp-2">{task.title}</div>
                              <div className={`shrink-0 rounded-full px-2 py-1 text-[11px] ${PRIORITY_META[task.priority]}`}>
                                {task.priority}
                              </div>
                            </div>

                            <div className="mt-3 flex flex-col gap-2 text-xs text-gray-400">
                              <div className="flex items-center gap-2">
                                <Building2 className="w-3.5 h-3.5" />
                                <span>{center?.name ?? '未命名中心'}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <BriefcaseBusiness className="w-3.5 h-3.5" />
                                <span>{department?.name ?? '未分配部门'}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <UserRound className="w-3.5 h-3.5" />
                                <span>{assignee?.displayName ?? '未分配员工'}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <CalendarClock className="w-3.5 h-3.5" />
                                <span>{task.dueAt ? formatDateTime(task.dueAt) : '无截止时间'}</span>
                              </div>
                            </div>

                            {task.latestEvent?.content && (
                              <div className="mt-3 rounded-xl bg-dark-900/80 px-3 py-2 text-xs text-gray-300 line-clamp-3">
                                {task.latestEvent.content}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <aside className="h-full overflow-y-auto border-l border-gray-800/70 bg-dark-900/60 p-4 space-y-4">
          <section className="rounded-3xl border border-gray-800 bg-dark-900/90 p-4">
            <div className="flex items-center gap-2 mb-4">
              <Plus className="w-4 h-4 text-primary-400" />
              <h2 className="text-sm font-semibold text-white">组织搭建</h2>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-gray-800 bg-dark-800/70 p-3 space-y-2">
                <div className="text-xs uppercase tracking-[0.18em] text-cyan-300">新中心</div>
                <input
                  value={centerForm.name}
                  onChange={(event) => setCenterForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="例如：华东增长中心"
                  className="w-full rounded-xl border border-gray-700 bg-dark-900 px-3 py-2 text-sm text-white"
                />
                <input
                  value={centerForm.code}
                  onChange={(event) => setCenterForm((prev) => ({ ...prev, code: event.target.value }))}
                  placeholder="中心编码"
                  className="w-full rounded-xl border border-gray-700 bg-dark-900 px-3 py-2 text-sm text-white"
                />
                <textarea
                  value={centerForm.description}
                  onChange={(event) => setCenterForm((prev) => ({ ...prev, description: event.target.value }))}
                  rows={2}
                  placeholder="中心说明"
                  className="w-full rounded-xl border border-gray-700 bg-dark-900 px-3 py-2 text-sm text-white resize-none"
                />
                <button
                  onClick={handleCreateCenter}
                  disabled={busy || !centerForm.name.trim()}
                  className="w-full rounded-xl bg-cyan-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  创建中心
                </button>
              </div>

              <div className="rounded-2xl border border-gray-800 bg-dark-800/70 p-3 space-y-2">
                <div className="text-xs uppercase tracking-[0.18em] text-blue-300">新部门</div>
                <select
                  value={departmentForm.centerId}
                  onChange={(event) => setDepartmentForm((prev) => ({ ...prev, centerId: event.target.value }))}
                  className="w-full rounded-xl border border-gray-700 bg-dark-900 px-3 py-2 text-sm text-white"
                >
                  <option value="">选择所属中心</option>
                  {centers.map((center) => (
                    <option key={center.id} value={center.id}>{center.name}</option>
                  ))}
                </select>
                <input
                  value={departmentForm.name}
                  onChange={(event) => setDepartmentForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="例如：运营部"
                  className="w-full rounded-xl border border-gray-700 bg-dark-900 px-3 py-2 text-sm text-white"
                />
                <input
                  value={departmentForm.code}
                  onChange={(event) => setDepartmentForm((prev) => ({ ...prev, code: event.target.value }))}
                  placeholder="部门编码"
                  className="w-full rounded-xl border border-gray-700 bg-dark-900 px-3 py-2 text-sm text-white"
                />
                <button
                  onClick={handleCreateDepartment}
                  disabled={busy || !departmentForm.centerId || !departmentForm.name.trim()}
                  className="w-full rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  创建部门
                </button>
              </div>

              <div className="rounded-2xl border border-gray-800 bg-dark-800/70 p-3 space-y-2">
                <div className="text-xs uppercase tracking-[0.18em] text-amber-300">新员工</div>
                <select
                  value={memberForm.centerId}
                  onChange={(event) => setMemberForm((prev) => ({ ...prev, centerId: event.target.value, departmentId: '' }))}
                  className="w-full rounded-xl border border-gray-700 bg-dark-900 px-3 py-2 text-sm text-white"
                >
                  <option value="">选择所属中心</option>
                  {centers.map((center) => (
                    <option key={center.id} value={center.id}>{center.name}</option>
                  ))}
                </select>
                <select
                  value={memberForm.departmentId}
                  onChange={(event) => setMemberForm((prev) => ({ ...prev, departmentId: event.target.value }))}
                  className="w-full rounded-xl border border-gray-700 bg-dark-900 px-3 py-2 text-sm text-white"
                >
                  <option value="">可选：所属部门</option>
                  {departmentsForMemberForm.map((department) => (
                    <option key={department.id} value={department.id}>{department.name}</option>
                  ))}
                </select>
                <input
                  value={memberForm.displayName}
                  onChange={(event) => setMemberForm((prev) => ({ ...prev, displayName: event.target.value }))}
                  placeholder="员工姓名"
                  className="w-full rounded-xl border border-gray-700 bg-dark-900 px-3 py-2 text-sm text-white"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={memberForm.employeeCode}
                    onChange={(event) => setMemberForm((prev) => ({ ...prev, employeeCode: event.target.value }))}
                    placeholder="工号"
                    className="w-full rounded-xl border border-gray-700 bg-dark-900 px-3 py-2 text-sm text-white"
                  />
                  <input
                    value={memberForm.roleTitle}
                    onChange={(event) => setMemberForm((prev) => ({ ...prev, roleTitle: event.target.value }))}
                    placeholder="岗位"
                    className="w-full rounded-xl border border-gray-700 bg-dark-900 px-3 py-2 text-sm text-white"
                  />
                </div>
                <button
                  onClick={handleCreateMember}
                  disabled={busy || !memberForm.centerId || !memberForm.displayName.trim()}
                  className="w-full rounded-xl bg-amber-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  创建员工
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-gray-800 bg-dark-900/90 p-4">
            <div className="flex items-center gap-2 mb-4">
              <Flag className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-semibold text-white">新旨意任务</h2>
            </div>

            <div className="space-y-2">
              <select
                value={taskForm.centerId}
                onChange={(event) => setTaskForm((prev) => ({ ...prev, centerId: event.target.value, departmentId: '', assigneeMemberId: '' }))}
                className="w-full rounded-xl border border-gray-700 bg-dark-900 px-3 py-2 text-sm text-white"
              >
                <option value="">选择中心</option>
                {centers.map((center) => (
                  <option key={center.id} value={center.id}>{center.name}</option>
                ))}
              </select>
              <select
                value={taskForm.departmentId}
                onChange={(event) => setTaskForm((prev) => ({ ...prev, departmentId: event.target.value, assigneeMemberId: '' }))}
                className="w-full rounded-xl border border-gray-700 bg-dark-900 px-3 py-2 text-sm text-white"
              >
                <option value="">可选：部门</option>
                {departmentsForTaskForm.map((department) => (
                  <option key={department.id} value={department.id}>{department.name}</option>
                ))}
              </select>
              <select
                value={taskForm.assigneeMemberId}
                onChange={(event) => setTaskForm((prev) => ({ ...prev, assigneeMemberId: event.target.value }))}
                className="w-full rounded-xl border border-gray-700 bg-dark-900 px-3 py-2 text-sm text-white"
              >
                <option value="">可选：执行员工</option>
                {membersForTaskForm.map((member) => (
                  <option key={member.id} value={member.id}>{member.displayName}</option>
                ))}
              </select>
              <input
                value={taskForm.title}
                onChange={(event) => setTaskForm((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="任务标题"
                className="w-full rounded-xl border border-gray-700 bg-dark-900 px-3 py-2 text-sm text-white"
              />
              <textarea
                value={taskForm.description}
                onChange={(event) => setTaskForm((prev) => ({ ...prev, description: event.target.value }))}
                rows={3}
                placeholder="任务描述 / 背景 / 要求"
                className="w-full rounded-xl border border-gray-700 bg-dark-900 px-3 py-2 text-sm text-white resize-none"
              />

              <div className="grid grid-cols-2 gap-2">
                <select
                  value={taskForm.priority}
                  onChange={(event) => setTaskForm((prev) => ({ ...prev, priority: event.target.value as CommandCenterTask['priority'] }))}
                  className="w-full rounded-xl border border-gray-700 bg-dark-900 px-3 py-2 text-sm text-white"
                >
                  <option value="low">低优先级</option>
                  <option value="medium">中优先级</option>
                  <option value="high">高优先级</option>
                  <option value="critical">关键优先级</option>
                </select>
                <select
                  value={taskForm.status}
                  onChange={(event) => setTaskForm((prev) => ({ ...prev, status: event.target.value as CommandCenterTask['status'] }))}
                  className="w-full rounded-xl border border-gray-700 bg-dark-900 px-3 py-2 text-sm text-white"
                >
                  {STATUS_META.map((item) => (
                    <option key={item.key} value={item.key}>{item.label}</option>
                  ))}
                </select>
              </div>

              <input
                type="datetime-local"
                value={taskForm.dueAt}
                onChange={(event) => setTaskForm((prev) => ({ ...prev, dueAt: event.target.value }))}
                className="w-full rounded-xl border border-gray-700 bg-dark-900 px-3 py-2 text-sm text-white"
              />
              <input
                value={taskForm.requestedBy}
                onChange={(event) => setTaskForm((prev) => ({ ...prev, requestedBy: event.target.value }))}
                placeholder="提出人"
                className="w-full rounded-xl border border-gray-700 bg-dark-900 px-3 py-2 text-sm text-white"
              />
              <input
                value={taskForm.tags}
                onChange={(event) => setTaskForm((prev) => ({ ...prev, tags: event.target.value }))}
                placeholder="标签，用逗号分隔"
                className="w-full rounded-xl border border-gray-700 bg-dark-900 px-3 py-2 text-sm text-white"
              />
              <button
                onClick={handleCreateTask}
                disabled={busy || !taskForm.centerId || !taskForm.title.trim()}
                className="w-full rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                创建任务
              </button>
            </div>
          </section>

          <section className="rounded-3xl border border-gray-800 bg-dark-900/90 p-4">
            <div className="flex items-center gap-2 mb-4">
              <ArrowRight className="w-4 h-4 text-sky-400" />
              <h2 className="text-sm font-semibold text-white">执行轨迹</h2>
            </div>

            {executorAudit.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-700 px-4 py-5 text-sm text-gray-500">
                还没有记录到任务执行轨迹。后续命中 `task-executor` 或触发多智能体调度后，会在这里显示。
              </div>
            ) : (
              <div className="space-y-3">
                {executorAudit.map((item) => {
                  const details = item.details ?? {};
                  const reason = typeof details.reason === 'string' ? details.reason : '';
                  const responseMode = typeof details.responseMode === 'string' ? details.responseMode : '';
                  const agentId = typeof details.agentId === 'string' ? details.agentId : '';
                  const mode = typeof details.mode === 'string' ? details.mode : '';
                  const members = Array.isArray(details.members) ? details.members as Array<{ agentId?: string; role?: string | null }> : [];
                  const textPreview = typeof details.textPreview === 'string'
                    ? details.textPreview
                    : typeof details.taskPreview === 'string'
                      ? details.taskPreview
                      : '';

                  return (
                    <div key={item.id} className="rounded-2xl border border-gray-800 bg-dark-800/70 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium text-white">{formatAuditAction(item.action)}</div>
                        <div className="text-[11px] text-gray-500">{formatDateTime(item.createdAt)}</div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                        {agentId && <span className="rounded-full bg-sky-500/15 px-2 py-1 text-sky-300">{agentId}</span>}
                        {responseMode && <span className="rounded-full bg-violet-500/15 px-2 py-1 text-violet-300">{responseMode}</span>}
                        {mode && <span className="rounded-full bg-amber-500/15 px-2 py-1 text-amber-300">{mode}</span>}
                      </div>
                      {reason && <div className="mt-2 text-xs text-amber-200">原因：{reason}</div>}
                      {members.length > 0 && (
                        <div className="mt-2 text-xs text-gray-300">
                          调度成员：{members.map((member) => `${member.agentId}${member.role ? `(${member.role})` : ''}`).join('、')}
                        </div>
                      )}
                      {textPreview && (
                        <div className="mt-2 rounded-xl bg-dark-900/80 px-3 py-2 text-xs text-gray-400 line-clamp-4 whitespace-pre-wrap">
                          {textPreview}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-gray-800 bg-dark-900/90 p-4">
            <div className="flex items-center gap-2 mb-4">
              <ShieldCheck className="w-4 h-4 text-fuchsia-400" />
              <h2 className="text-sm font-semibold text-white">任务详情与审计</h2>
            </div>

            {!detail ? (
              <div className="rounded-2xl border border-dashed border-gray-700 px-4 py-8 text-center text-sm text-gray-500">
                选择一条任务后，这里会显示中心、部门、员工、流转状态与审计时间线。
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-2xl border border-gray-800 bg-dark-800/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-white">{detail.task.title}</h3>
                      <p className="mt-2 text-sm text-gray-400 whitespace-pre-wrap">{detail.task.description || '暂无描述'}</p>
                    </div>
                    <div className={`rounded-full px-2.5 py-1 text-xs ${PRIORITY_META[detail.task.priority]}`}>
                      {detail.task.priority}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-gray-400">
                    <div>
                      <div className="text-gray-500">所属中心</div>
                      <div className="mt-1 text-gray-200">{lookupCenter(detail.task.centerId)?.name ?? '未设置'}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">所属部门</div>
                      <div className="mt-1 text-gray-200">{lookupDepartment(detail.task.departmentId)?.name ?? '未设置'}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">执行员工</div>
                      <div className="mt-1 text-gray-200">{lookupMember(detail.task.assigneeMemberId)?.displayName ?? '未设置'}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">提出人</div>
                      <div className="mt-1 text-gray-200">{detail.task.requestedBy || '未设置'}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">截止时间</div>
                      <div className="mt-1 text-gray-200">{formatDateTime(detail.task.dueAt)}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">当前状态</div>
                      <div className="mt-1 text-gray-200">{statusLabel(detail.task.status)}</div>
                    </div>
                  </div>

                  {detail.task.tags.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {detail.task.tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-dark-900 px-2.5 py-1 text-xs text-gray-300">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-gray-800 bg-dark-800/70 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-gray-400">快速流转</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {STATUS_META.map((item) => (
                      <button
                        key={item.key}
                        onClick={() => handleUpdateStatus(item.key)}
                        disabled={busy || detail.task.status === item.key}
                        className={`rounded-full px-3 py-1.5 text-xs transition ${
                          detail.task.status === item.key
                            ? item.pill
                            : 'bg-dark-900 text-gray-300 hover:bg-dark-950'
                        } disabled:opacity-60`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-800 bg-dark-800/70 p-4">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-gray-400">
                    <MessageSquareText className="w-3.5 h-3.5" />
                    审计备注
                  </div>
                  <textarea
                    value={eventNote}
                    onChange={(event) => setEventNote(event.target.value)}
                    rows={3}
                    placeholder="写入一条过程记录，例如：已完成需求澄清，等待研发排期。"
                    className="mt-3 w-full rounded-xl border border-gray-700 bg-dark-900 px-3 py-2 text-sm text-white resize-none"
                  />
                  <button
                    onClick={handleAddEvent}
                    disabled={busy || !eventNote.trim()}
                    className="mt-3 w-full rounded-xl bg-fuchsia-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    写入审计事件
                  </button>
                </div>

                <div className="rounded-2xl border border-gray-800 bg-dark-800/70 p-4">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-gray-400">
                    <ArrowRight className="w-3.5 h-3.5" />
                    时间线
                  </div>

                  <div className="mt-4 space-y-3">
                    {detail.events.length === 0 && (
                      <div className="text-sm text-gray-500">暂无审计事件</div>
                    )}

                    {detail.events.map((event) => (
                      <div key={event.id} className="rounded-2xl border border-gray-800 bg-dark-900/80 px-3 py-3">
                        <div className="flex items-center justify-between gap-3 text-xs text-gray-500">
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-dark-800 px-2 py-1 text-gray-300">{event.eventType}</span>
                            <span>{event.actorId || 'system'}</span>
                          </div>
                          <span>{formatDateTime(event.createdAt)}</span>
                        </div>
                        <div className="mt-2 text-sm text-gray-200 whitespace-pre-wrap">{event.content}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
