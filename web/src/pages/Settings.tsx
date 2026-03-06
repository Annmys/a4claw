import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/auth';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import {
  Settings as SettingsIcon, LogOut, Key, Globe, Bot, DollarSign,
  Eye, EyeOff, CheckCircle, XCircle, Loader2, Save, TestTube, Terminal,
  Server, Plus, Trash2, Wifi, WifiOff, TrendingUp, Zap
} from 'lucide-react';
import { applyLanguage, persistLanguageChoice, type UILanguage } from '../utils/ui-language';

export default function Settings() {
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<'keys' | 'services' | 'budget' | 'general' | 'cli' | 'servers' | 'exchanges' | 'evolution'>('keys');
  const [cliStatus, setCli状态] = useState<{ available: boolean; authenticated: boolean; cliPath: string; lastCheckAt: number } | null>(null);
  const [cliLoading, setCLILoading] = useState(false);
  const [cliMessage, setCLIMessage] = useState('');
  const [cliAuthUrl, setCliAuthUrl] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [editKeys, setEditKeys] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, { valid: boolean; message: string }>>({});

  // Servers state
  const [servers, setServers] = useState<any[]>([]);
  const [showAddServer, setShowAddServer] = useState(false);
  const [newServer, setNewServer] = useState({ name: '', host: '', port: 22, user: 'root', authMethod: 'password' as 'key' | 'password', keyPath: '', password: '', tags: '' });
  const [serverLoading, setServerLoading] = useState(false);
  const [checkingHealth, setCheckingHealth] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadSettings();
  }, []);

  // Load CLI status when CLI tab is active
  useEffect(() => {
    if (activeTab === 'cli') {
      api.cliStatus().then(setCli状态).catch(() => {});
    }
    if (activeTab === 'servers') {
      api.getServers().then(setServers).catch(() => {});
    }
  }, [activeTab]);

  const loadSettings = async () => {
    try {
      const data = await api.getSettings();
      setSettings(data);
      const language = (data?.language ?? 'auto') as UILanguage;
      persistLanguageChoice(language);
      applyLanguage(language);
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
    setLoading(false);
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const updates: any = { ...settings };
      for (const [field, value] of Object.entries(editKeys)) {
        const [section, provider, key] = field.split('.');
        if (updates[section]?.[provider]) {
          updates[section][provider][key] = value;
        }
      }
      const result = await api.updateSettings(updates);
      setSettings(result.settings);
      setEditKeys({});
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
    setSaving(false);
  };

  const testApiKey = async (provider: string, key: string) => {
    setTesting(prev => ({ ...prev, [provider]: true }));
    try {
      const result = await api.testKey(provider, key);
      setTestResults(prev => ({ ...prev, [provider]: result }));
    } catch (err: any) {
      setTestResults(prev => ({ ...prev, [provider]: { valid: false, message: err.message } }));
    }
    setTesting(prev => ({ ...prev, [provider]: false }));
  };

  const getKey价值 = (section: string, provider: string, key: string): string => {
    const editKey = `${section}.${provider}.${key}`;
    if (editKeys[editKey] !== undefined) return editKeys[editKey];
    return settings?.[section]?.[provider]?.[key] ?? '';
  };

  const setKey价值 = (section: string, provider: string, key: string, value: string) => {
    setEditKeys(prev => ({ ...prev, [`${section}.${provider}.${key}`]: value }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  const tabs = [
    { id: 'keys' as const, label: 'API 密钥', icon: Key },
    { id: 'services' as const, label: '外部服务', icon: Globe },
    { id: 'servers' as const, label: '服务器', icon: Server },
    { id: 'exchanges' as const, label: '交易所', icon: TrendingUp },
    { id: 'budget' as const, label: '预算', icon: DollarSign },
    { id: 'cli' as const, label: 'Claude 命令行', icon: Terminal },
    { id: 'evolution' as const, label: '更新', icon: Zap },
    { id: 'general' as const, label: '通用', icon: Bot },
  ];

  const providerKeys = [
    { provider: 'anthropic', label: 'Anthropic (Claude)', section: 'providers', keyField: 'apiKey', placeholder: 'sk-ant-...' },
    { provider: 'openrouter', label: 'OpenRouter', section: 'providers', keyField: 'apiKey', placeholder: 'sk-or-...' },
    { provider: 'openai', label: 'OpenAI', section: 'providers', keyField: 'apiKey', placeholder: 'sk-...' },
  ];

  const serviceKeys = [
    { provider: 'github', label: 'GitHub Token', section: 'services', keyField: 'token', placeholder: 'ghp_...' },
    { provider: 'brave', label: 'Brave Search', section: 'services', keyField: 'apiKey', placeholder: 'BSA...' },
    { provider: 'telegram', label: 'Telegram Bot', section: 'services', keyField: 'botToken', placeholder: '123456:ABC...' },
    { provider: 'discord', label: 'Discord Bot', section: 'services', keyField: 'botToken', placeholder: 'MTk...' },
  ];

  const renderKeyRow = (item: typeof providerKeys[0]) => {
    const value = getKey价值(item.section, item.provider, item.keyField);
    const visible = showKeys[item.provider] ?? false;
    const isTesting = testing[item.provider];
    const result = testResults[item.provider];
    const isEnabled = settings?.[item.section]?.[item.provider]?.enabled ?? false;

    return (
      <div key={item.provider} className="p-4 bg-dark-800 rounded-lg border border-gray-800">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="font-medium">{item.label}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${isEnabled ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
              {isEnabled ? '已启用' : '未启用'}
            </span>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => {
                const updated = { ...settings };
                updated[item.section] = { ...updated[item.section] };
                updated[item.section][item.provider] = { ...updated[item.section][item.provider], enabled: e.target.checked };
                setSettings(updated);
              }}
              className="w-4 h-4 rounded border-gray-600 bg-dark-900 accent-primary-600"
            />
            <span className="text-xs text-gray-400">启用</span>
          </label>
        </div>

        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              type={visible ? 'text' : 'password'}
              value={value}
              onChange={(e) => setKey价值(item.section, item.provider, item.keyField, e.target.value)}
              placeholder={item.placeholder}
              className="w-full p-2.5 pr-10 rounded bg-dark-900 border border-gray-700 text-white text-sm font-mono"
            />
            <button
              onClick={() => setShowKeys(prev => ({ ...prev, [item.provider]: !prev[item.provider] }))}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
            >
              {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <button
            onClick={() => {
              const keyToTest = editKeys[`${item.section}.${item.provider}.${item.keyField}`] || '';
              if (keyToTest && !keyToTest.includes('\u2022')) {
                testApiKey(item.provider, keyToTest);
              }
            }}
            disabled={isTesting}
            className="px-3 py-2 bg-dark-900 border border-gray-700 rounded hover:bg-dark-800 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <TestTube className="w-4 h-4" />}
            <span className="text-xs">测试</span>
          </button>
        </div>

        {result && (
          <div className={`mt-2 flex items-center gap-2 text-xs ${result.valid ? 'text-green-400' : 'text-red-400'}`}>
            {result.valid ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
            {result.message}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <SettingsIcon className="w-7 h-7 text-primary-500" />
            <h1 className="text-2xl font-bold">设置</h1>
          </div>
          <button
            onClick={saveSettings}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 font-medium"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saved ? '已保存！' : '保存更改'}
          </button>
        </div>

        <div className="flex gap-1 mb-6 bg-dark-900 p-1 rounded-lg border border-gray-800">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors flex-1 justify-center ${
                activeTab === tab.id ? 'bg-primary-600 text-white' : 'text-gray-400 hover:text-white hover:bg-dark-800'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'keys' && (
          <div className="space-y-4">
            <div className="mb-4">
              <h2 className="text-lg font-semibold mb-1">AI 提供商密钥</h2>
              <p className="text-sm text-gray-400">配置 AI 模型服务商的 API 密钥。密钥将被加密并掩码显示。</p>
            </div>
            {providerKeys.map(renderKeyRow)}
          </div>
        )}

        {activeTab === 'services' && (
          <div className="space-y-4">
            <div className="mb-4">
              <h2 className="text-lg font-semibold mb-1">外部服务</h2>
              <p className="text-sm text-gray-400">配置 GitHub、搜索与消息平台的 API 密钥。</p>
            </div>
            {serviceKeys.map(renderKeyRow)}
          </div>
        )}

        {activeTab === 'servers' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold mb-1">SSH 服务器</h2>
                <p className="text-sm text-gray-400">管理智能体可连接并执行任务的远程服务器。</p>
              </div>
              <button onClick={() => setShowAddServer(true)} className="flex items-center gap-2 px-3 py-2 bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium">
                <Plus className="w-4 h-4" /> 添加服务器
              </button>
            </div>

            {showAddServer && (
              <div className="p-5 bg-dark-800 rounded-lg border border-primary-600/50">
                <h3 className="font-semibold mb-4">添加新服务器</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">名称</label>
                    <input value={newServer.name} onChange={e => setNewServer({ ...newServer, name: e.target.value })} placeholder="production-1" className="w-full p-2.5 rounded bg-dark-900 border border-gray-700 text-white text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">主机（IP / 域名）</label>
                    <input value={newServer.host} onChange={e => setNewServer({ ...newServer, host: e.target.value })} placeholder="1.2.3.4" className="w-full p-2.5 rounded bg-dark-900 border border-gray-700 text-white text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">端口</label>
                    <input type="number" value={newServer.port} onChange={e => setNewServer({ ...newServer, port: parseInt(e.target.value) || 22 })} className="w-full p-2.5 rounded bg-dark-900 border border-gray-700 text-white text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">用户名</label>
                    <input value={newServer.user} onChange={e => setNewServer({ ...newServer, user: e.target.value })} placeholder="root" className="w-full p-2.5 rounded bg-dark-900 border border-gray-700 text-white text-sm" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm text-gray-400 mb-1">认证方式</label>
                    <select value={newServer.authMethod} onChange={e => setNewServer({ ...newServer, authMethod: e.target.value as 'key' | 'password' })} className="w-full p-2.5 rounded bg-dark-900 border border-gray-700 text-white text-sm">
                      <option value="password">密码</option>
                      <option value="key">SSH 密钥</option>
                    </select>
                  </div>
                  {newServer.authMethod === 'password' ? (
                    <div className="md:col-span-2">
                      <label className="block text-sm text-gray-400 mb-1">密码</label>
                      <input type="password" value={newServer.password} onChange={e => setNewServer({ ...newServer, password: e.target.value })} placeholder="服务器密码" className="w-full p-2.5 rounded bg-dark-900 border border-gray-700 text-white text-sm" />
                    </div>
                  ) : (
                    <div className="md:col-span-2">
                      <label className="block text-sm text-gray-400 mb-1">SSH 密钥路径</label>
                      <input value={newServer.keyPath} onChange={e => setNewServer({ ...newServer, keyPath: e.target.value })} placeholder="~/.ssh/id_rsa" className="w-full p-2.5 rounded bg-dark-900 border border-gray-700 text-white text-sm font-mono" />
                    </div>
                  )}
                  <div className="md:col-span-2">
                    <label className="block text-sm text-gray-400 mb-1">标签（逗号分隔）</label>
                    <input value={newServer.tags} onChange={e => setNewServer({ ...newServer, tags: e.target.value })} placeholder="web, production" className="w-full p-2.5 rounded bg-dark-900 border border-gray-700 text-white text-sm" />
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={async () => {
                      if (!newServer.name || !newServer.host) return;
                      setServerLoading(true);
                      try {
                        await api.addServer({
                          name: newServer.name, host: newServer.host, port: newServer.port, user: newServer.user,
                          authMethod: newServer.authMethod, keyPath: newServer.keyPath || undefined, password: newServer.password || undefined,
                          tags: newServer.tags ? newServer.tags.split(',').map(t => t.trim()) : [],
                        });
                        setShowAddServer(false);
                        setNewServer({ name: '', host: '', port: 22, user: 'root', authMethod: 'password', keyPath: '', password: '', tags: '' });
                        const updated = await api.getServers();
                        setServers(updated);
                      } catch (err: any) {
                        alert(err.message);
                      }
                      setServerLoading(false);
                    }}
                    disabled={serverLoading || !newServer.name || !newServer.host}
                    className="flex items-center gap-2 px-4 py-2 bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 text-sm font-medium"
                  >
                    {serverLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} 保存服务器
                  </button>
                  <button onClick={() => setShowAddServer(false)} className="px-4 py-2 bg-dark-900 rounded-lg hover:bg-dark-800 text-gray-400 text-sm">取消</button>
                </div>
              </div>
            )}

            {servers.map(server => (
              <div key={server.id} className="p-4 bg-dark-800 rounded-lg border border-gray-800">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {server.status === 'online' ? <Wifi className="w-5 h-5 text-green-400" /> : <WifiOff className="w-5 h-5 text-gray-500" />}
                    <div>
                      <h3 className="font-medium">{server.name}</h3>
                      <p className="text-sm text-gray-400 font-mono">{server.user}@{server.host}:{server.port} ({server.authMethod})</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${server.status === 'online' ? 'bg-green-500/20 text-green-400' : server.status === 'offline' ? 'bg-red-500/20 text-red-400' : 'bg-gray-700 text-gray-400'}`}>
                      {server.status}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        setCheckingHealth(p => ({ ...p, [server.id]: true }));
                        try {
                          const health = await api.serverHealth(server.id);
                          const updated = await api.getServers();
                          setServers(updated);
                          if (health.status === 'online') alert(`服务器在线！\n${health.raw?.join('\n') ?? ''}`);
                          else alert(`服务器离线：${health.error}`);
                        } catch (err: any) { alert(err.message); }
                        setCheckingHealth(p => ({ ...p, [server.id]: false }));
                      }}
                      disabled={checkingHealth[server.id]}
                      className="px-3 py-1.5 text-xs bg-dark-900 border border-gray-700 rounded hover:bg-dark-700 disabled:opacity-50"
                    >
                      {checkingHealth[server.id] ? <Loader2 className="w-3 h-3 animate-spin" /> : '检测'}
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm(`确认移除服务器“${server.name}”？`)) return;
                        await api.removeServer(server.id);
                        setServers(await api.getServers());
                      }}
                      className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-dark-900 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {server.tags?.length > 0 && (
                  <div className="flex gap-1 mt-2">
                    {server.tags.map((t: string) => <span key={t} className="text-xs px-2 py-0.5 bg-dark-900 rounded text-gray-400">{t}</span>)}
                  </div>
                )}
                {server.lastChecked && <p className="text-xs text-gray-500 mt-1">上次检测：{new Date(server.lastChecked).toLocaleString()}</p>}
              </div>
            ))}
            {servers.length === 0 && !showAddServer && (
              <div className="text-center text-gray-500 py-12">
                <Server className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>尚未配置服务器</p>
                <p className="text-sm mt-1">添加 SSH 服务器后，智能体可远程管理它们</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'exchanges' && (
          <div className="space-y-4">
            <div className="mb-4">
              <h2 className="text-lg font-semibold mb-1">交易所 API 密钥</h2>
              <p className="text-sm text-gray-400">配置加密货币交易所 API 密钥。填写凭据后可开启实盘交易。</p>
            </div>
            {[
              { provider: 'binance', label: 'Binance', section: 'exchanges', keyField: 'apiKey', placeholder: 'Binance API Key' },
              { provider: 'binance_secret', label: 'Binance Secret', section: 'exchanges', keyField: 'apiSecret', placeholder: 'Binance API Secret' },
              { provider: 'okx', label: 'OKX', section: 'exchanges', keyField: 'apiKey', placeholder: 'OKX API Key' },
              { provider: 'okx_secret', label: 'OKX Secret', section: 'exchanges', keyField: 'apiSecret', placeholder: 'OKX API Secret' },
              { provider: 'okx_passphrase', label: 'OKX Passphrase', section: 'exchanges', keyField: 'passphrase', placeholder: 'OKX Passphrase' },
            ].map(renderKeyRow)}
            <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-lg">
              <p className="text-sm text-amber-400">提示：建议先在交易页启用模拟交易模式，先验证策略再上实盘。仅实盘交易需要交易所密钥。</p>
            </div>
          </div>
        )}

        {activeTab === 'budget' && (
          <div className="space-y-6">
            <div className="mb-4">
              <h2 className="text-lg font-semibold mb-1">预算与成本控制</h2>
              <p className="text-sm text-gray-400">设置 AI 模型使用的预算上限与偏好。</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-dark-800 rounded-lg border border-gray-800">
                <label className="block text-sm text-gray-400 mb-2">每日预算上限（$）</label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={settings?.budget?.dailyLimit ?? 5}
                  onChange={(e) => setSettings({ ...settings, budget: { ...settings?.budget, dailyLimit: parseFloat(e.target.value) } })}
                  className="w-full p-2.5 rounded bg-dark-900 border border-gray-700 text-white"
                />
              </div>
              <div className="p-4 bg-dark-800 rounded-lg border border-gray-800">
                <label className="block text-sm text-gray-400 mb-2">每月预算上限（$）</label>
                <input
                  type="number"
                  step="5"
                  min="0"
                  value={settings?.budget?.monthlyLimit ?? 100}
                  onChange={(e) => setSettings({ ...settings, budget: { ...settings?.budget, monthlyLimit: parseFloat(e.target.value) } })}
                  className="w-full p-2.5 rounded bg-dark-900 border border-gray-700 text-white"
                />
              </div>
            </div>
            <div className="p-4 bg-dark-800 rounded-lg border border-gray-800">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings?.budget?.preferFree ?? false}
                  onChange={(e) => setSettings({ ...settings, budget: { ...settings?.budget, preferFree: e.target.checked } })}
                  className="w-4 h-4 rounded border-gray-600 bg-dark-900 accent-primary-600"
                />
                <div>
                  <p className="font-medium">优先使用免费模型</p>
                  <p className="text-sm text-gray-400">在可能情况下，简单/中等任务优先使用 OpenRouter 免费模型</p>
                </div>
              </label>
            </div>
            <div className="p-4 bg-dark-800 rounded-lg border border-gray-800">
              <label className="block text-sm text-gray-400 mb-2">提供商模式</label>
              <select
                value={settings?.providerMode ?? 'balanced'}
                onChange={(e) => setSettings({ ...settings, providerMode: e.target.value })}
                className="w-full p-2.5 rounded bg-dark-900 border border-gray-700 text-white"
              >
                <option value="free">免费 —— 仅使用免费模型（OpenRouter :free）</option>
                <option value="cheap">低成本 —— 免费 + 经济模型（DeepSeek、Haiku）</option>
                <option value="balanced">均衡 —— 按复杂度智能路由</option>
                <option value="max">极致 —— 每次都用最强模型（Claude Code CLI）</option>
              </select>
            </div>
          </div>
        )}

        {activeTab === 'cli' && (
          <div className="space-y-6">
            <div className="mb-4">
              <h2 className="text-lg font-semibold mb-1">Claude Code CLI</h2>
              <p className="text-sm text-gray-400">通过 CLI 连接 Claude Max 订阅，免费无限使用 AI。</p>
            </div>

            {/* 状态 Card */}
            <div className={`p-5 rounded-lg border ${cliStatus?.authenticated ? 'bg-green-500/5 border-green-500/20' : 'bg-amber-500/5 border-amber-500/20'}`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${cliStatus?.authenticated ? 'bg-green-500/20' : 'bg-amber-500/20'}`}>
                    <Terminal className={`w-5 h-5 ${cliStatus?.authenticated ? 'text-green-400' : 'text-amber-400'}`} />
                  </div>
                  <div>
                    <p className="font-medium">{cliStatus?.authenticated ? 'CLI 已连接' : 'CLI 未连接'}</p>
                    <p className="text-xs text-gray-400">
                      {cliStatus?.authenticated
                        ? '正在使用 Claude Max 订阅（免费）'
                        : '点击“认证”后在浏览器完成连接'}
                    </p>
                  </div>
                </div>
                <span className={`text-xs px-3 py-1 rounded-full font-medium ${cliStatus?.authenticated ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'}`}>
                  {cliStatus?.authenticated ? '已连接' : '未连接'}
                </span>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    setCLILoading(true);
                    setCLIMessage('');
                    setCliAuthUrl(null);
                    try {
                      const result = await api.cliAuth();
                      setCLIMessage(result.message);
                      if (result.authUrl) {
                        setCliAuthUrl(result.authUrl);
                        // Start polling for successful auth
                        let attempts = 0;
                        const poller = setInterval(async () => {
                          attempts++;
                          try {
                            const status = await api.cliRecheck();
                            setCli状态(status);
                            if (status.authenticated) {
                              clearInterval(poller);
                              setCLILoading(false);
                              setCliAuthUrl(null);
                              setCLIMessage('连接成功！');
                            } else if (attempts >= 60) {
                              clearInterval(poller);
                              setCLILoading(false);
                              setCLIMessage('认证超时——请点击“认证”重试');
                            }
                          } catch {
                            if (attempts >= 60) { clearInterval(poller); setCLILoading(false); }
                          }
                        }, 3000);
                      } else {
                        setCLILoading(false);
                      }
                    } catch (err: any) {
                      setCLIMessage(err.message);
                      setCLILoading(false);
                    }
                  }}
                  disabled={cliLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 text-sm font-medium"
                >
                  {cliLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Terminal className="w-4 h-4" />}
                  {cliLoading ? '等待认证中...' : cliStatus?.authenticated ? '重新连接' : '认证'}
                </button>
                <button
                  onClick={async () => {
                    try {
                      const status = await api.cliRecheck();
                      setCli状态(status);
                      if (status.authenticated) {
                        setCLIMessage('已连接！');
                        setCliAuthUrl(null);
                      } else {
                        setCLIMessage('尚未认证');
                      }
                      setTimeout(() => setCLIMessage(''), 3000);
                    } catch {}
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-dark-800 border border-gray-700 rounded-lg hover:bg-dark-700 transition-colors text-sm"
                >
                  重新检测
                </button>
              </div>

              {/* Auth URL — clickable link for headless/VPS servers */}
              {cliAuthUrl && (
                <div className="mt-4 p-4 bg-dark-900 rounded-lg border border-primary-500/30">
                  <p className="text-sm text-gray-300 mb-2">请在浏览器打开以下链接完成登录：</p>
                  <a
                    href={cliAuthUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary-400 hover:text-primary-300 text-sm font-mono break-all underline"
                  >
                    {cliAuthUrl.length > 120 ? cliAuthUrl.slice(0, 120) + '...' : cliAuthUrl}
                  </a>
                  <button
                    onClick={() => { navigator.clipboard.writeText(cliAuthUrl); setCLIMessage('链接已复制！'); setTimeout(() => setCLIMessage(''), 2000); }}
                    className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-dark-800 border border-gray-700 rounded text-xs hover:bg-dark-700 transition-colors"
                  >
                    复制链接
                  </button>
                  <p className="text-xs text-gray-500 mt-3">登录后会自动更新连接状态；若未更新，请点击“重新检测”。</p>
                </div>
              )}

              {cliMessage && (
                <div className={`mt-3 flex items-center gap-2 text-sm ${cliMessage.includes('Success') || cliMessage.includes('Connected') || cliMessage.includes('copied') ? 'text-green-400' : 'text-gray-300'}`}>
                  {cliMessage.includes('Success') || cliMessage.includes('Connected') || cliMessage.includes('copied')
                    ? <CheckCircle className="w-4 h-4" />
                    : <Terminal className="w-4 h-4" />}
                  {cliMessage}
                </div>
              )}
            </div>

            {/* Details */}
            <div className="p-4 bg-dark-800 rounded-lg border border-gray-800">
              <h3 className="font-medium mb-3">连接详情</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">CLI 路径</span>
                  <span className="font-mono text-gray-300">{cliStatus?.cliPath ?? 'claude'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">可用</span>
                  <span className={cliStatus?.available ? 'text-green-400' : 'text-red-400'}>{cliStatus?.available ? '是' : '否'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">已认证</span>
                  <span className={cliStatus?.authenticated ? 'text-green-400' : 'text-red-400'}>{cliStatus?.authenticated ? '是' : '否'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">上次检测</span>
                  <span className="text-gray-300">{cliStatus?.lastCheckAt ? new Date(cliStatus.lastCheckAt).toLocaleTimeString() : '从未'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">费用</span>
                  <span className="text-green-400 font-medium">免费（Max 订阅）</span>
                </div>
              </div>
            </div>

            {/* How it works */}
            <div className="p-4 bg-dark-800 rounded-lg border border-gray-800">
              <h3 className="font-medium mb-3">工作原理</h3>
              <ol className="space-y-2 text-sm text-gray-400 list-decimal list-inside">
                <li>点击 <strong className="text-white">认证</strong> —— 下方会出现登录链接</li>
                <li>打开链接并使用 Anthropic 账号登录（需 Max 订阅）</li>
                <li>连接状态会自动更新 —— 或点击 <strong className="text-white">重新检测</strong></li>
                <li>所有 AI 请求都走你的 Max 订阅，<strong className="text-green-400">零额外费用</strong></li>
              </ol>
              <p className="text-xs text-gray-500 mt-3">若要断开，请点击“重新连接”——会清除旧凭据并生成新链接。</p>
            </div>
          </div>
        )}

        {activeTab === 'evolution' && (
          <div className="space-y-6">
            <div className="mb-4">
              <h2 className="text-lg font-semibold mb-1">更新与进化</h2>
              <p className="text-sm text-gray-400">控制系统如何发现并应用更新。可选择自动更新、仅通知或完全手动模式。</p>
            </div>

            {/* Evolution Mode */}
            <div className="p-4 bg-dark-800 rounded-lg border border-gray-800">
              <h3 className="font-medium mb-3">进化模式</h3>
              <div className="space-y-3">
                {[
                  { value: 'auto', label: '自动', desc: '系统发现并自动应用安全更新（技能、模型、工具）' },
                  { value: 'notify', label: '仅通知', desc: '系统发现更新后只发送通知，由你决定是否应用' },
                  { value: 'disabled', label: '关闭', desc: '不扫描、不通知——完全手动' },
                ].map(opt => (
                  <label key={opt.value} className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-dark-900 transition-colors">
                    <input
                      type="radio"
                      name="evolutionMode"
                      value={opt.value}
                      checked={(settings?.evolution?.evolutionMode ?? 'notify') === opt.value}
                      onChange={() => setSettings({ ...settings, evolution: { ...settings?.evolution, evolutionMode: opt.value } })}
                      className="mt-0.5 accent-primary-600"
                    />
                    <div>
                      <p className="font-medium text-sm">{opt.label}</p>
                      <p className="text-xs text-gray-500">{opt.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Notification Preferences */}
            <div className="p-4 bg-dark-800 rounded-lg border border-gray-800">
              <h3 className="font-medium mb-3">通知偏好</h3>
              <div className="space-y-3">
                {[
                  { key: 'notifyNewModels', label: '新模型', desc: '当有新 AI 模型发布时通知（Claude、GPT、Gemini 等）' },
                  { key: 'notifyPriceChanges', label: '价格变动', desc: '模型价格变化时通知' },
                  { key: 'notifyDeprecations', label: '弃用提醒', desc: '模型下线或弃用时通知' },
                  { key: 'autoUpdateSkills', label: '自动更新技能', desc: '自动从已配置来源安装新技能' },
                  { key: 'autoUpdateModels', label: '自动更新模型配置', desc: '发现更优模型时自动更新模型路由' },
                ].map(item => (
                  <label key={item.key} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings?.evolution?.[item.key] ?? (item.key === 'autoUpdateSkills' || item.key === 'notifyNewModels' || item.key === 'notifyDeprecations')}
                      onChange={(e) => setSettings({ ...settings, evolution: { ...settings?.evolution, [item.key]: e.target.checked } })}
                      className="w-4 h-4 rounded border-gray-600 bg-dark-900 accent-primary-600"
                    />
                    <div>
                      <p className="text-sm font-medium">{item.label}</p>
                      <p className="text-xs text-gray-500">{item.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Scan Intervals */}
            <div className="p-4 bg-dark-800 rounded-lg border border-gray-800">
              <h3 className="font-medium mb-3">扫描间隔</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">LLM 模型扫描（小时）</label>
                  <input
                    type="number"
                    min="1"
                    max="168"
                    value={settings?.evolution?.ecosystemScanIntervalHours ?? 6}
                    onChange={(e) => setSettings({ ...settings, evolution: { ...settings?.evolution, ecosystemScanIntervalHours: parseInt(e.target.value) || 6 } })}
                    className="w-full p-2.5 rounded bg-dark-900 border border-gray-700 text-white text-sm"
                  />
                  <p className="text-[11px] text-gray-600 mt-1">检查新模型与价格变化的频率</p>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">生态扫描（小时）</label>
                  <input
                    type="number"
                    min="1"
                    max="168"
                    value={settings?.evolution?.skillScanIntervalHours ?? 24}
                    onChange={(e) => setSettings({ ...settings, evolution: { ...settings?.evolution, skillScanIntervalHours: parseInt(e.target.value) || 24 } })}
                    className="w-full p-2.5 rounded bg-dark-900 border border-gray-700 text-white text-sm"
                  />
                  <p className="text-[11px] text-gray-600 mt-1">扫描 GitHub/npm 新工具与技能的频率</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'general' && (
          <div className="space-y-6">
            <div className="mb-4">
              <h2 className="text-lg font-semibold mb-1">通用设置</h2>
              <p className="text-sm text-gray-400">语言、行为与系统偏好设置。</p>
            </div>
            <div className="p-4 bg-dark-800 rounded-lg border border-gray-800">
              <label className="block text-sm text-gray-400 mb-2">语言</label>
              <select
                value={settings?.language ?? 'auto'}
                onChange={(e) => {
                  const language = e.target.value as UILanguage;
                  setSettings({ ...settings, language });
                  persistLanguageChoice(language);
                  applyLanguage(language);
                }}
                className="w-full p-2.5 rounded bg-dark-900 border border-gray-700 text-white"
              >
                <option value="auto">自动检测（中文/英文/希伯来语）</option>
                <option value="zh">中文</option>
                <option value="he">希伯来语</option>
                <option value="en">英语</option>
              </select>
              <p className="text-xs text-gray-500 mt-2">切换后立即生效；少量页面可能需要刷新一次。</p>
            </div>
            <div className="p-4 bg-dark-800 rounded-lg border border-gray-800">
              <h3 className="font-medium mb-3">系统信息</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-400">版本</span><span className="font-mono">6.0.0</span></div>
                <div className="flex justify-between"><span className="text-gray-400">仪表盘</span><span className="font-mono">React + Vite + Tailwind</span></div>
                <div className="flex justify-between"><span className="text-gray-400">后端</span><span className="font-mono">Node.js + Express + TypeScript</span></div>
              </div>
            </div>
          </div>
        )}

        <div className="border-t border-gray-800 pt-6 mt-8">
          <button
            onClick={() => { logout(); navigate('/login'); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-red-600/20 text-red-400 rounded-lg hover:bg-red-600/30 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            退出登录
          </button>
        </div>
      </div>
    </div>
  );
}
