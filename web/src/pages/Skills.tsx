import { useEffect, useState } from 'react';
import { api, type CapabilitySkillItem } from '../api/client';
import {
  Sparkles, Plus, Pencil, Trash2, X, Save, Loader2, Zap
} from 'lucide-react';

export default function Skills() {
  const [skills, setSkills] = useState<CapabilitySkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingSkill, setEditingSkill] = useState<Partial<CapabilitySkillItem> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadSkills(); }, []);

  const loadSkills = async () => {
    try {
      const data = await api.getSkills();
      setSkills(data);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleSave = async () => {
    if (!editingSkill?.name || !editingSkill?.trigger || !editingSkill?.prompt) return;
    setSaving(true);
    try {
      if (isNew) {
        await api.createSkill(editingSkill);
      } else {
        await api.updateSkill(editingSkill.id!, editingSkill);
      }
      setEditingSkill(null);
      await loadSkills();
    } catch (err) {
      console.error('Failed to save skill:', err);
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除这个技能吗？')) return;
    try {
      await api.deleteSkill(id);
      await loadSkills();
    } catch (err) {
      console.error('Failed to delete skill:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Sparkles className="w-7 h-7 text-primary-500" />
            <h1 className="text-2xl font-bold">技能</h1>
            <span className="text-sm text-gray-400">({skills.length})</span>
          </div>
          <button
            onClick={() => {
      setEditingSkill({ name: '', description: '', trigger: '', prompt: '', examples: [] });
              setIsNew(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors font-medium"
          >
            <Plus className="w-4 h-4" />
            新建技能
          </button>
        </div>

        {/* 编辑/创建弹窗 */}
        {editingSkill && (
          <div className="mb-6 p-5 bg-dark-800 rounded-lg border border-primary-600/50">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">{isNew ? '创建技能' : '编辑技能'}</h3>
              <button onClick={() => setEditingSkill(null)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">名称</label>
                <input
                  value={editingSkill.name ?? ''}
                  onChange={(e) => setEditingSkill({ ...editingSkill, name: e.target.value })}
                  placeholder="例如：晨报生成"
                  className="w-full p-2.5 rounded bg-dark-900 border border-gray-700 text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">描述</label>
                <input
                  value={editingSkill.description ?? ''}
                  onChange={(e) => setEditingSkill({ ...editingSkill, description: e.target.value })}
                  placeholder="例如：生成每日晨报"
                  className="w-full p-2.5 rounded bg-dark-900 border border-gray-700 text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">触发器（正则表达式）</label>
                <input
                  value={editingSkill.trigger ?? ''}
                  onChange={(e) => setEditingSkill({ ...editingSkill, trigger: e.target.value })}
                  placeholder="(morning briefing|早报|daily briefing)"
                  className="w-full p-2.5 rounded bg-dark-900 border border-gray-700 text-white text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">提示词</label>
                <textarea
                  value={editingSkill.prompt ?? ''}
                  onChange={(e) => setEditingSkill({ ...editingSkill, prompt: e.target.value })}
                  placeholder="例如：你正在执行晨报技能，请直接输出结果……"
                  rows={5}
                  className="w-full p-2.5 rounded bg-dark-900 border border-gray-700 text-white text-sm font-mono resize-y"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleSave}
                  disabled={saving || !editingSkill.name || !editingSkill.trigger || !editingSkill.prompt}
                  className="flex items-center gap-2 px-4 py-2 bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 font-medium"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {isNew ? '创建' : '保存'}
                </button>
                <button onClick={() => setEditingSkill(null)} className="px-4 py-2 bg-dark-900 rounded-lg hover:bg-dark-800 transition-colors text-gray-400">
                  取消
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 技能列表 */}
        <div className="space-y-3">
          {skills.map(skill => (
            <div key={skill.id} className="p-4 bg-dark-800 rounded-lg border border-gray-800 hover:border-gray-700 transition-colors">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Zap className="w-4 h-4 text-yellow-400" />
                    <h3 className="font-medium">{skill.name}</h3>
                    <span className="text-xs text-gray-500">v{skill.version}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      skill.status === 'ready'
                        ? 'bg-green-600/15 text-green-400'
                        : skill.status === 'partial'
                          ? 'bg-yellow-600/15 text-yellow-400'
                          : 'bg-red-600/15 text-red-400'
                    }`}>
                      {skill.status === 'ready' ? '可用' : skill.status === 'partial' ? '部分可用' : '受阻'}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${skill.type === 'plugin-tool' ? 'bg-cyan-600/15 text-cyan-300' : 'bg-gray-700 text-gray-300'}`}>
                      {skill.type === 'plugin-tool' ? '插件工具' : '技能'}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${skill.source === 'dashboard' || skill.source === 'user-created' ? 'bg-primary-600/20 text-primary-400' : 'bg-gray-700 text-gray-400'}`}>
                      {skill.sourceLabel}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400 mb-2">{skill.description}</p>
                  <p className="text-xs text-gray-500 font-mono">触发器：{skill.trigger}</p>
                  {skill.pluginName && (
                    <p className="text-xs text-gray-500 mt-1">
                      插件：{skill.pluginName} {skill.pluginVersion ? `· v${skill.pluginVersion}` : ''}{skill.pluginAuthor ? ` · ${skill.pluginAuthor}` : ''}
                    </p>
                  )}
                </div>
                {skill.editable && (
                  <div className="flex gap-1 ml-4">
                    <button
                      onClick={() => { setEditingSkill(skill); setIsNew(false); }}
                      className="p-2 text-gray-400 hover:text-white hover:bg-dark-900 rounded transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(skill.id)}
                      className="p-2 text-gray-400 hover:text-red-400 hover:bg-dark-900 rounded transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {skills.length === 0 && (
            <div className="text-center text-gray-500 py-12">
              <Sparkles className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>还没有技能，先创建第一个吧！</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
