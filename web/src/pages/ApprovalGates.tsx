import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import {
  Shield,
  Plus,
  Edit2,
  Trash2,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Users,
  Settings,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface ApprovalGate {
  id: string;
  name: string;
  gateType: 'skill_execution' | 'high_cost_operation' | 'destructive_action' | 'external_api_call' | 'custom';
  description: string;
  approverMemberIds: string[];
  autoApproveConditions?: {
    maxCost?: number;
    trustedSkills?: string[];
    maxDuration?: number;
  };
  requireAllApprovers: boolean;
  timeoutHours: number;
  enabled: boolean;
  centerId?: string;
}

const GATE_TYPE_LABELS: Record<string, string> = {
  skill_execution: '技能执行',
  high_cost_operation: '高成本操作',
  destructive_action: '破坏性操作',
  external_api_call: '外部 API 调用',
  custom: '自定义',
};

export default function ApprovalGates() {
  const [gates, setGates] = useState<ApprovalGate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedGate, setExpandedGate] = useState<string | null>(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingGate, setEditingGate] = useState<ApprovalGate | null>(null);
  const [formData, setFormData] = useState<Partial<ApprovalGate>>({
    name: '',
    gateType: 'custom',
    description: '',
    approverMemberIds: [],
    requireAllApprovers: false,
    timeoutHours: 24,
    enabled: true,
  });

  useEffect(() => {
    loadGates();
  }, []);

  async function loadGates() {
    try {
      setLoading(true);
      const data = await api.listApprovalGates();
      setGates(data.gates);
    } catch (err: any) {
      setError(err.message || '加载审批闸门失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (editingGate) {
        await api.updateApprovalGate(editingGate.id, formData);
      } else {
        await api.createApprovalGate(formData as Required<ApprovalGate>);
      }
      setShowForm(false);
      setEditingGate(null);
      setFormData({
        name: '',
        gateType: 'custom',
        description: '',
        approverMemberIds: [],
        requireAllApprovers: false,
        timeoutHours: 24,
        enabled: true,
      });
      loadGates();
    } catch (err: any) {
      setError(err.message || '保存失败');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('确定要删除这个审批闸门吗？')) return;
    try {
      await api.deleteApprovalGate(id);
      loadGates();
    } catch (err: any) {
      setError(err.message || '删除失败');
    }
  }

  function startEdit(gate: ApprovalGate) {
    setEditingGate(gate);
    setFormData({
      name: gate.name,
      gateType: gate.gateType,
      description: gate.description,
      approverMemberIds: gate.approverMemberIds,
      autoApproveConditions: gate.autoApproveConditions,
      requireAllApprovers: gate.requireAllApprovers,
      timeoutHours: gate.timeoutHours,
      enabled: gate.enabled,
    });
    setShowForm(true);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6 text-blue-500" />
            审批闸门
          </h1>
          <p className="text-gray-500 mt-1">管理需要审批的关键操作</p>
        </div>
        <button
          onClick={() => {
            setEditingGate(null);
            setFormData({
              name: '',
              gateType: 'custom',
              description: '',
              approverMemberIds: [],
              requireAllApprovers: false,
              timeoutHours: 24,
              enabled: true,
            });
            setShowForm(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
        >
          <Plus className="w-4 h-4" />
          新建闸门
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          {error}
          <button onClick={() => setError('')} className="ml-auto text-sm underline">
            清除
          </button>
        </div>
      )}

      {showForm && (
        <div className="bg-white rounded-lg border p-6 space-y-4">
          <h3 className="font-semibold text-lg">
            {editingGate ? '编辑审批闸门' : '新建审批闸门'}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  闸门名称 *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="例如：高风险技能执行审批"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  闸门类型 *
                </label>
                <select
                  value={formData.gateType}
                  onChange={(e) => setFormData({ ...formData, gateType: e.target.value as any })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  {Object.entries(GATE_TYPE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                描述
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                rows={2}
                placeholder="描述这个审批闸门的用途..."
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  超时时间（小时）
                </label>
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={formData.timeoutHours}
                  onChange={(e) => setFormData({ ...formData, timeoutHours: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex items-center gap-2 pt-7">
                <input
                  type="checkbox"
                  id="requireAll"
                  checked={formData.requireAllApprovers}
                  onChange={(e) => setFormData({ ...formData, requireAllApprovers: e.target.checked })}
                  className="w-4 h-4 text-blue-500 rounded"
                />
                <label htmlFor="requireAll" className="text-sm text-gray-700">
                  需要所有审批人通过
                </label>
              </div>
              <div className="flex items-center gap-2 pt-7">
                <input
                  type="checkbox"
                  id="enabled"
                  checked={formData.enabled}
                  onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                  className="w-4 h-4 text-blue-500 rounded"
                />
                <label htmlFor="enabled" className="text-sm text-gray-700">
                  启用
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                {editingGate ? '保存' : '创建'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid gap-4">
        {gates.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Shield className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p>暂无审批闸门</p>
            <p className="text-sm">点击"新建闸门"创建第一个审批闸门</p>
          </div>
        ) : (
          gates.map((gate) => (
            <div
              key={gate.id}
              className={`bg-white rounded-lg border transition-all ${
                gate.enabled ? 'border-gray-200' : 'border-gray-200 opacity-60'
              }`}
            >
              <div
                className="p-4 flex items-center gap-4 cursor-pointer hover:bg-gray-50"
                onClick={() => setExpandedGate(expandedGate === gate.id ? null : gate.id)}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  gate.enabled ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'
                }`}>
                  <Shield className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{gate.name}</h3>
                    {!gate.enabled && (
                      <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded">
                        已禁用
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500">
                    {GATE_TYPE_LABELS[gate.gateType]} · {gate.timeoutHours}小时超时
                    {gate.requireAllApprovers ? ' · 需全员通过' : ' · 任一通过即可'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit(gate);
                    }}
                    className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(gate.id);
                    }}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  {expandedGate === gate.id ? (
                    <ChevronUp className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  )}
                </div>
              </div>

              {expandedGate === gate.id && (
                <div className="px-4 pb-4 border-t bg-gray-50">
                  <div className="pt-4 space-y-3">
                    {gate.description && (
                      <div>
                        <span className="text-sm font-medium text-gray-700">描述：</span>
                        <p className="text-sm text-gray-600 mt-1">{gate.description}</p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="font-medium text-gray-700">审批人：</span>
                        <span className="text-gray-600 ml-1">{gate.approverMemberIds.length} 人</span>
                      </div>
                      {gate.autoApproveConditions && (
                        <div>
                          <span className="font-medium text-gray-700">自动审批条件：</span>
                          <div className="text-gray-600 ml-1 space-y-1">
                            {gate.autoApproveConditions.maxCost !== undefined && (
                              <div>最高成本: ¥{gate.autoApproveConditions.maxCost}</div>
                            )}
                            {gate.autoApproveConditions.maxDuration !== undefined && (
                              <div>最长时间: {gate.autoApproveConditions.maxDuration}ms</div>
                            )}
                            {gate.autoApproveConditions.trustedSkills && (
                              <div>信任技能: {gate.autoApproveConditions.trustedSkills.join(', ')}</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
