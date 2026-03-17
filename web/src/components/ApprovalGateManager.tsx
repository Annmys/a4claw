import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  Plus,
  Trash2,
  Edit2,
  CheckCircle,
  XCircle,
  Clock,
  Users,
  Settings,
  AlertTriangle,
  Save,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { api } from '../api/client';

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

interface ApprovalRequest {
  id: string;
  gateId: string;
  taskId: string;
  requesterId: string;
  payload: {
    action: string;
    details: Record<string, unknown>;
    estimatedCost?: number;
    estimatedDuration?: number;
  };
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'auto_approved';
  decisions: Array<{
    approverId: string;
    decision: 'approved' | 'rejected';
    comment?: string;
    decidedAt: string;
  }>;
  requestedAt: string;
  expiresAt: string;
}

interface Member {
  id: string;
  displayName: string;
  roleTitle?: string;
}

interface ApprovalGateManagerProps {
  centerId?: string;
  members: Member[];
  availableSkills: string[];
}

const GATE_TYPE_LABELS: Record<string, { label: string; description: string; icon: any }> = {
  skill_execution: {
    label: '技能执行审批',
    description: '执行特定技能前需要审批',
    icon: Shield,
  },
  high_cost_operation: {
    label: '高成本操作审批',
    description: '预估成本超过阈值时需要审批',
    icon: AlertTriangle,
  },
  destructive_action: {
    label: '破坏性操作审批',
    description: '删除、修改等不可逆操作需要审批',
    icon: Trash2,
  },
  external_api_call: {
    label: '外部 API 调用审批',
    description: '调用外部服务时需要审批',
    icon: Settings,
  },
  custom: {
    label: '自定义审批',
    description: '根据自定义条件触发审批',
    icon: Settings,
  },
};

export function ApprovalGateManager({ centerId, members, availableSkills }: ApprovalGateManagerProps) {
  const [gates, setGates] = useState<ApprovalGate[]>([]);
  const [pendingRequests, setPendingRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingGate, setEditingGate] = useState<ApprovalGate | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [expandedRequest, setExpandedRequest] = useState<string | null>(null);

  const [formData, setFormData] = useState<Partial<ApprovalGate>>({
    name: '',
    gateType: 'skill_execution',
    description: '',
    approverMemberIds: [],
    requireAllApprovers: false,
    timeoutHours: 24,
    enabled: true,
    autoApproveConditions: {},
  });

  const loadGates = useCallback(async () => {
    try {
      setLoading(true);
      const { gates: data } = await api.listApprovalGates(centerId);
      setGates(data || []);
    } catch (err) {
      console.error('Failed to load approval gates:', err);
    } finally {
      setLoading(false);
    }
  }, [centerId]);

  const loadPendingRequests = useCallback(async () => {
    try {
      const { requests } = await api.getPendingApprovals();
      setPendingRequests(requests || []);
    } catch (err) {
      console.error('Failed to load pending approvals:', err);
    }
  }, []);

  useEffect(() => {
    loadGates();
    loadPendingRequests();
    const interval = setInterval(loadPendingRequests, 30000);
    return () => clearInterval(interval);
  }, [loadGates, loadPendingRequests]);

  const handleSave = async () => {
    try {
      if (!formData.name || !formData.gateType) return;

      const data = {
        ...formData,
        centerId,
      } as ApprovalGate;

      if (editingGate) {
        await api.updateApprovalGate(editingGate.id, data);
      } else {
        await api.createApprovalGate(data);
      }

      await loadGates();
      setShowForm(false);
      setEditingGate(null);
      setFormData({
        name: '',
        gateType: 'skill_execution',
        description: '',
        approverMemberIds: [],
        requireAllApprovers: false,
        timeoutHours: 24,
        enabled: true,
        autoApproveConditions: {},
      });
    } catch (err) {
      console.error('Failed to save approval gate:', err);
    }
  };

  const handleDelete = async (gateId: string) => {
    if (!confirm('确定要删除此审批闸门吗？')) return;
    try {
      await api.deleteApprovalGate(gateId);
      await loadGates();
    } catch (err) {
      console.error('Failed to delete approval gate:', err);
    }
  };

  const handleDecision = async (requestId: string, decision: 'approved' | 'rejected', comment?: string) => {
    try {
      await api.makeApprovalDecision(requestId, decision, comment);
      await loadPendingRequests();
    } catch (err) {
      console.error('Failed to make decision:', err);
    }
  };

  const startEdit = (gate: ApprovalGate) => {
    setEditingGate(gate);
    setFormData(gate);
    setShowForm(true);
  };

  const toggleMember = (memberId: string) => {
    setFormData(prev => {
      const current = prev.approverMemberIds || [];
      const updated = current.includes(memberId)
        ? current.filter(id => id !== memberId)
        : [...current, memberId];
      return { ...prev, approverMemberIds: updated };
    });
  };

  const StatusBadge = ({ status }: { status: string }) => {
    const styles: Record<string, string> = {
      pending: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      approved: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      rejected: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
      expired: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
      auto_approved: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    };

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium border ${styles[status] || styles.pending}`}>
        {status === 'auto_approved' ? 'Auto Approved' : status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-blue-400" />
          <div>
            <h2 className="text-lg font-semibold text-slate-100">审批闸门</h2>
            <p className="text-sm text-slate-400">配置审批规则，管理待审批请求</p>
          </div>
        </div>
        <button
          onClick={() => {
            setEditingGate(null);
            setFormData({
              name: '',
              gateType: 'skill_execution',
              description: '',
              approverMemberIds: [],
              requireAllApprovers: false,
              timeoutHours: 24,
              enabled: true,
              autoApproveConditions: {},
            });
            setShowForm(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 
            text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          新建闸门
        </button>
      </div>

      {/* Pending Requests Section */}
      {pendingRequests.length > 0 && (
        <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
          <div className="px-4 py-3 bg-slate-700/50 border-b border-slate-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" />
              <span className="font-medium text-slate-200">待审批请求 ({pendingRequests.length})</span>
            </div>
          </div>
          
          <div className="divide-y divide-slate-700">
            {pendingRequests.map(request => (
              <div key={request.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <StatusBadge status={request.status} />
                      <span className="text-sm text-slate-400">
                        请求于 {new Date(request.requestedAt).toLocaleString('zh-CN')}
                      </span>
                      <span className="text-sm text-slate-500">
                        截止: {new Date(request.expiresAt).toLocaleString('zh-CN')}
                      </span>
                    </div>
                    
                    <div className="mt-2 text-sm text-slate-300">
                      <span className="font-medium">操作: </span>
                      {request.payload.action}
                    </div>
                    
                    {request.payload.estimatedCost && (
                      <div className="mt-1 text-sm text-slate-400">
                        预估成本: ${request.payload.estimatedCost}
                      </div>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleDecision(request.id, 'approved')}
                      className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 
                        text-white rounded-lg text-sm transition-colors"
                    >
                      <CheckCircle className="w-4 h-4" />
                      批准
                    </button>
                    <button
                      onClick={() => handleDecision(request.id, 'rejected')}
                      className="flex items-center gap-1 px-3 py-1.5 bg-rose-600 hover:bg-rose-500 
                        text-white rounded-lg text-sm transition-colors"
                    >
                      <XCircle className="w-4 h-4" />
                      拒绝
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Gates List */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-slate-300">审批闸门配置</h3>
        
        {loading ? (
          <div className="text-center py-8 text-slate-500">加载中...</div>
        ) : gates.length === 0 ? (
          <div className="text-center py-8 text-slate-500">暂无审批闸门配置</div>
        ) : (
          <div className="grid gap-4">
            {gates.map(gate => {
              const TypeIcon = GATE_TYPE_LABELS[gate.gateType]?.icon || Shield;
              
              return (
                <div
                  key={gate.id}
                  className={`p-4 rounded-lg border transition-all ${
                    gate.enabled 
                      ? 'bg-slate-800 border-slate-700' 
                      : 'bg-slate-800/50 border-slate-700/50 opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg ${
                        gate.enabled ? 'bg-blue-500/20' : 'bg-slate-700'
                      }`}>
                        <TypeIcon className={`w-5 h-5 ${
                          gate.enabled ? 'text-blue-400' : 'text-slate-500'
                        }`} />
                      </div>
                      
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-slate-200">{gate.name}</h4>
                          {!gate.enabled && (
                            <span className="px-2 py-0.5 bg-slate-700 text-slate-400 rounded text-xs">
                              已禁用
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-400 mt-1">
                          {gate.description || GATE_TYPE_LABELS[gate.gateType]?.description}
                        </p>
                        
                        <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
                          <div className="flex items-center gap-1">
                            <Users className="w-3.5 h-3.5" />
                            {gate.approverMemberIds.length} 位审批人
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {gate.timeoutHours} 小时超时
                          </div>
                          <div>
                            {gate.requireAllApprovers ? '需全部审批' : '任一审批即可'}
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => startEdit(gate)}
                        className="p-2 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 
                          rounded-lg transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(gate.id)}
                        className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 
                          rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-2xl max-h-[90vh] overflow-auto">
            <div className="p-6 border-b border-slate-700">
              <h3 className="text-lg font-semibold text-slate-100">
                {editingGate ? '编辑审批闸门' : '新建审批闸门'}
              </h3>
            </div>
            
            <div className="p-6 space-y-6">
              {/* Basic Info */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">闸门名称 *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="例如：高风险操作审批"
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg 
                      text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">闸门类型 *</label>
                  <div className="grid grid-cols-2 gap-3">
                    {Object.entries(GATE_TYPE_LABELS).map(([type, { label, description, icon: Icon }]) => (
                      <button
                        key={type}
                        onClick={() => setFormData(prev => ({ ...prev, gateType: type as any }))}
                        className={`p-3 rounded-lg border text-left transition-all ${
                          formData.gateType === type
                            ? 'border-blue-500 bg-blue-500/10'
                            : 'border-slate-600 hover:border-slate-500'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Icon className={`w-4 h-4 ${
                            formData.gateType === type ? 'text-blue-400' : 'text-slate-400'
                          }`} />
                          <span className={`font-medium ${
                            formData.gateType === type ? 'text-blue-300' : 'text-slate-300'
                          }`}>
                            {label}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">{description}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">描述</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    rows={2}
                    placeholder="描述此审批闸门的用途..."
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg 
                      text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none"
                  />
                </div>
              </div>

              {/* Approvers */}
              <div className="border-t border-slate-700 pt-6">
                <label className="block text-sm font-medium text-slate-300 mb-3">审批人</label>
                
                <div className="space-y-2">
                  {members.length === 0 ? (
                    <p className="text-sm text-slate-500">暂无可用的员工</p>
                  ) : (
                    members.map(member => (
                      <label
                        key={member.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                          formData.approverMemberIds?.includes(member.id)
                            ? 'border-blue-500 bg-blue-500/10'
                            : 'border-slate-600 hover:border-slate-500'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={formData.approverMemberIds?.includes(member.id)}
                          onChange={() => toggleMember(member.id)}
                          className="w-4 h-4 rounded border-slate-600 bg-slate-700 
                            text-blue-500 focus:ring-blue-500/20"
                        />
                        <div className="flex-1">
                          <div className="text-sm font-medium text-slate-200">{member.displayName}</div>
                          {member.roleTitle && (
                            <div className="text-xs text-slate-500">{member.roleTitle}</div>
                          )}
                        </div>
                      </label>
                    ))
                  )}
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <label className="flex items-center gap-2 text-sm text-slate-400">
                    <input
                      type="checkbox"
                      checked={formData.requireAllApprovers}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        requireAllApprovers: e.target.checked 
                      }))}
                      className="w-4 h-4 rounded border-slate-600 bg-slate-700"
                    />
                    需要所有审批人批准（否则任一审批人批准即可）
                  </label>
                </div>
              </div>

              {/* Auto-approve Conditions */}
              <div className="border-t border-slate-700 pt-6">
                <label className="block text-sm font-medium text-slate-300 mb-3">自动审批条件</label>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">最高成本阈值（美元）</label>
                    <input
                      type="number"
                      value={formData.autoApproveConditions?.maxCost || ''}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        autoApproveConditions: {
                          ...prev.autoApproveConditions,
                          maxCost: e.target.value ? parseFloat(e.target.value) : undefined,
                        },
                      }))}
                      placeholder="例如：10"
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg 
                        text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-xs text-slate-500 mt-1">
                      预估成本低于此值时自动通过，留空则不启用
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-500 mb-1">最长执行时间（分钟）</label>
                    <input
                      type="number"
                      value={formData.autoApproveConditions?.maxDuration || ''}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        autoApproveConditions: {
                          ...prev.autoApproveConditions,
                          maxDuration: e.target.value ? parseInt(e.target.value) : undefined,
                        },
                      }))}
                      placeholder="例如：5"
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg 
                        text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Timeout */}
              <div className="border-t border-slate-700 pt-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">超时时间（小时）</label>
                    <input
                      type="number"
                      value={formData.timeoutHours}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        timeoutHours: parseInt(e.target.value) || 24 
                      }))}
                      min={1}
                      max={168}
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg 
                        text-slate-200 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="flex items-end">
                    <label className="flex items-center gap-2 text-sm text-slate-400">
                      <input
                        type="checkbox"
                        checked={formData.enabled}
                        onChange={(e) => setFormData(prev => ({ ...prev, enabled: e.target.checked }))}
                        className="w-4 h-4 rounded border-slate-600 bg-slate-700"
                      />
                      启用此闸门
                    </label>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="p-6 border-t border-slate-700 flex justify-end gap-3">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-slate-400 hover:text-slate-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={!formData.name || !formData.gateType || (formData.approverMemberIds?.length || 0) === 0}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 
                  disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg 
                  font-medium transition-colors"
              >
                <Save className="w-4 h-4" />
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ApprovalGateManager;
