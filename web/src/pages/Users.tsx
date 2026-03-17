import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type CommandCenterOrgOptions, type WebUser } from '../api/client';
import {
  KeyRound,
  Loader2,
  RefreshCw,
  Shield,
  Trash2,
  UserPlus,
  Users as UsersIcon,
} from 'lucide-react';

interface CreateForm {
  username: string;
  password: string;
  role: 'admin' | 'user';
}

const EMPTY_FORM: CreateForm = {
  username: '',
  password: '',
  role: 'user',
};

const EMPTY_ORG_OPTIONS: CommandCenterOrgOptions = {
  centers: [],
  departments: [],
  members: [],
};

function getErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return '请求失败';
  if (error.message.includes('Admin only')) return '仅管理员可操作';
  if (error.message.includes('already bound')) return '该员工已绑定其他账号';
  if (error.message.includes('not found')) return '所选员工不存在或不属于当前组织';
  return error.message;
}

function decodeJwtPayload(token: string | null): { userId?: string; role?: string } | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function formatTime(input: string | null): string {
  if (!input) return '从未登录';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', { hour12: false });
}

export default function Users() {
  const [users, setUsers] = useState<WebUser[]>([]);
  const [orgOptions, setOrgOptions] = useState<CommandCenterOrgOptions>(EMPTY_ORG_OPTIONS);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const [roleSavingId, setRoleSavingId] = useState<string | null>(null);
  const [bindingSavingId, setBindingSavingId] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [passwordDraft, setPasswordDraft] = useState<Record<string, string>>({});
  const [bindingDrafts, setBindingDrafts] = useState<Record<string, string>>({});

  const currentUser = useMemo(
    () => decodeJwtPayload(localStorage.getItem('token'))?.userId ?? '',
    [],
  );

  const centerMap = useMemo(
    () => new Map(orgOptions.centers.map((center) => [center.id, center])),
    [orgOptions.centers],
  );

  const departmentMap = useMemo(
    () => new Map(orgOptions.departments.map((department) => [department.id, department])),
    [orgOptions.departments],
  );

  const memberOptions = useMemo(() => orgOptions.members.map((member) => {
    const center = centerMap.get(member.centerId);
    const department = member.departmentId ? departmentMap.get(member.departmentId) : null;
    const parts = [
      center?.name ?? '未命名中心',
      department?.name ?? '未分配部门',
      member.displayName,
    ];
    if (member.roleTitle) parts.push(member.roleTitle);
    return {
      id: member.id,
      label: parts.join(' / '),
    };
  }), [centerMap, departmentMap, orgOptions.members]);

  const loadData = useCallback(async (silent = false) => {
    if (silent) {
      setFetching(true);
    } else {
      setLoading(true);
    }
    setError('');

    try {
      const [usersData, orgData] = await Promise.all([
        api.getUsers(),
        api.getUserOrgOptions(),
      ]);
      setUsers(usersData.users);
      setOrgOptions(orgData);
      setBindingDrafts(Object.fromEntries(
        usersData.users.map((user) => [user.id, user.binding?.memberId ?? '']),
      ));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreate = async () => {
    if (!form.username.trim() || !form.password) return;
    setCreating(true);
    setError('');
    try {
      await api.createUser({
        username: form.username.trim(),
        password: form.password,
        role: form.role,
      });
      setForm(EMPTY_FORM);
      await loadData(true);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const handleRoleChange = async (id: string, role: 'admin' | 'user') => {
    setRoleSavingId(id);
    setError('');
    try {
      await api.updateUserRole(id, role);
      setUsers((prev) => prev.map((user) => (user.id === id ? { ...user, role } : user)));
    } catch (err) {
      setError(getErrorMessage(err));
      await loadData(true);
    } finally {
      setRoleSavingId(null);
    }
  };

  const handleBindingSave = async (user: WebUser) => {
    const memberId = (bindingDrafts[user.id] ?? '').trim();
    const currentMemberId = user.binding?.memberId ?? '';
    if (memberId === currentMemberId) return;

    setBindingSavingId(user.id);
    setError('');
    try {
      const data = await api.updateUserBinding(user.id, { memberId: memberId || null });
      setUsers((prev) => prev.map((item) => (item.id === user.id ? data.user : item)));
      setBindingDrafts((prev) => ({ ...prev, [user.id]: data.user.binding?.memberId ?? '' }));
    } catch (err) {
      setError(getErrorMessage(err));
      await loadData(true);
    } finally {
      setBindingSavingId(null);
    }
  };

  const handleResetPassword = async (id: string) => {
    const password = (passwordDraft[id] ?? '').trim();
    if (!password) return;
    setResettingId(id);
    setError('');
    try {
      await api.resetUserPassword(id, password);
      setPasswordDraft((prev) => ({ ...prev, [id]: '' }));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setResettingId(null);
    }
  };

  const handleDelete = async (id: string, username: string) => {
    const confirmed = window.confirm(`确定删除用户 ${username} 吗？`);
    if (!confirmed) return;

    setDeletingId(id);
    setError('');
    try {
      await api.deleteUser(id);
      setUsers((prev) => prev.filter((user) => user.id !== id));
      setBindingDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <UsersIcon className="w-7 h-7 text-primary-500" />
            <h1 className="text-2xl font-bold">用户管理</h1>
            <span className="text-sm text-gray-400">({users.length})</span>
          </div>
          <button
            onClick={() => loadData(true)}
            disabled={fetching}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-dark-800 border border-gray-700 hover:border-primary-500/60 transition-colors disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${fetching ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 text-sm">
            {error}
          </div>
        )}

        <div className="bg-dark-800 rounded-xl border border-gray-800 p-4 md:p-5">
          <div className="flex items-center gap-2 mb-4">
            <UserPlus className="w-4 h-4 text-primary-400" />
            <h2 className="font-semibold">新增用户</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input
              value={form.username}
              onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
              placeholder="用户名（3-30位）"
              className="px-3 py-2 rounded-lg bg-dark-900 border border-gray-700 focus:outline-none focus:border-primary-500 text-sm"
            />
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
              placeholder="密码（至少8位，含大小写和数字）"
              className="px-3 py-2 rounded-lg bg-dark-900 border border-gray-700 focus:outline-none focus:border-primary-500 text-sm"
            />
            <select
              value={form.role}
              onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value as 'admin' | 'user' }))}
              className="px-3 py-2 rounded-lg bg-dark-900 border border-gray-700 focus:outline-none focus:border-primary-500 text-sm"
            >
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
            </select>
            <button
              onClick={handleCreate}
              disabled={creating || !form.username.trim() || !form.password}
              className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 transition-colors text-sm font-medium disabled:opacity-60"
            >
              {creating ? '创建中...' : '创建用户'}
            </button>
          </div>
        </div>

        {memberOptions.length === 0 && (
          <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-200 text-sm">
            当前还没有可绑定员工。请先到「旨意看板」创建中心、部门和员工，再回到这里绑定账号。
          </div>
        )}

        <div className="bg-dark-800 rounded-xl border border-gray-800 overflow-hidden">
          <div className="hidden md:grid md:grid-cols-[1.2fr_0.9fr_2.1fr_1fr_1.8fr] gap-3 px-4 py-3 text-xs uppercase tracking-wider text-gray-400 border-b border-gray-800">
            <div>用户名</div>
            <div>角色</div>
            <div>组织身份</div>
            <div>最后登录</div>
            <div>操作</div>
          </div>

          {users.map((user) => {
            const draftMemberId = bindingDrafts[user.id] ?? '';
            const currentMemberId = user.binding?.memberId ?? '';
            const bindingDirty = draftMemberId !== currentMemberId;

            return (
              <div
                key={user.id}
                className="px-4 py-4 border-b border-gray-800/70 last:border-b-0 space-y-3 md:space-y-0 md:grid md:grid-cols-[1.2fr_0.9fr_2.1fr_1fr_1.8fr] md:gap-3 md:items-start"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate">{user.username}</span>
                    {user.username === currentUser && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-500/20 text-primary-300">当前</span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    创建于 {formatTime(user.createdAt)}
                  </div>
                </div>

                <div>
                  <label className="sr-only" htmlFor={`role-${user.id}`}>角色</label>
                  <div className="relative">
                    <Shield className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
                    <select
                      id={`role-${user.id}`}
                      value={user.role}
                      onChange={(e) => handleRoleChange(user.id, e.target.value as 'admin' | 'user')}
                      disabled={roleSavingId === user.id}
                      className="w-full pl-8 pr-2 py-1.5 rounded bg-dark-900 border border-gray-700 text-sm focus:outline-none focus:border-primary-500 disabled:opacity-60"
                    >
                      <option value="user">用户</option>
                      <option value="admin">管理员</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  {user.binding ? (
                    <div className="text-sm">
                      <div className="font-medium text-gray-100">{user.binding.memberName}</div>
                      <div className="text-xs text-gray-400">
                        {user.binding.centerName}
                        {' / '}
                        {user.binding.departmentName ?? '未分配部门'}
                      </div>
                      <div className="text-xs text-gray-500">
                        {user.binding.title ?? '未设岗位'}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500">未绑定员工</div>
                  )}

                  <div className="flex flex-col gap-2">
                    <select
                      value={draftMemberId}
                      onChange={(e) => setBindingDrafts((prev) => ({ ...prev, [user.id]: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg bg-dark-900 border border-gray-700 text-sm focus:outline-none focus:border-primary-500 disabled:opacity-60"
                      disabled={bindingSavingId === user.id || memberOptions.length === 0}
                    >
                      <option value="">不绑定员工 / 清除绑定</option>
                      {memberOptions.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleBindingSave(user)}
                      disabled={bindingSavingId === user.id || !bindingDirty}
                      className="self-start px-3 py-1.5 rounded bg-primary-600 hover:bg-primary-700 transition-colors text-xs font-medium disabled:opacity-60"
                    >
                      {bindingSavingId === user.id ? '保存中...' : '保存组织绑定'}
                    </button>
                  </div>
                </div>

                <div className="text-sm text-gray-300">{formatTime(user.lastLogin)}</div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      value={passwordDraft[user.id] ?? ''}
                      onChange={(e) => setPasswordDraft((prev) => ({ ...prev, [user.id]: e.target.value }))}
                      placeholder="新密码"
                      className="min-w-0 flex-1 px-2 py-1.5 rounded bg-dark-900 border border-gray-700 text-xs focus:outline-none focus:border-primary-500"
                    />
                    <button
                      onClick={() => handleResetPassword(user.id)}
                      disabled={resettingId === user.id || !(passwordDraft[user.id] ?? '').trim()}
                      className="px-2.5 py-1.5 rounded bg-blue-600/80 hover:bg-blue-600 text-xs disabled:opacity-60 inline-flex items-center gap-1"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      重置
                    </button>
                  </div>
                  <button
                    onClick={() => handleDelete(user.id, user.username)}
                    disabled={deletingId === user.id}
                    className="self-start px-2.5 py-1.5 rounded bg-red-600/80 hover:bg-red-600 text-xs disabled:opacity-60 inline-flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    删除
                  </button>
                </div>
              </div>
            );
          })}

          {users.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-gray-500">暂无用户数据</div>
          )}
        </div>
      </div>
    </div>
  );
}
