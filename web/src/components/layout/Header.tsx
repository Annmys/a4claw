import { useEffect, useState, useCallback } from 'react';
import { useAuthStore } from '../../stores/auth';
import { api } from '../../api/client';
import { LogOut, Activity, Terminal, Loader2, CheckCircle } from 'lucide-react';
import NotificationBell from '../shared/NotificationBell';

interface CLIStatus {
  available: boolean;
  authenticated: boolean;
  cliPath: string;
  lastCheckAt: number;
}

export default function Header() {
  const logout = useAuthStore((s) => s.logout);
  const [uptime, setUptime] = useState('--');
  const [cli, setCli] = useState<CLIStatus | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState('');

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/status', {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        });
        if (res.ok) {
          const data = await res.json();
          const mins = Math.floor(data.uptime / 60);
          const hrs = Math.floor(mins / 60);
          setUptime(hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`);
        }
      } catch { /* ignore */ }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  // Poll CLI status
  useEffect(() => {
    const fetchCLI = async () => {
      try {
        const status = await api.cliStatus();
        setCli(status);
      } catch { /* ignore */ }
    };
    fetchCLI();
    const interval = setInterval(fetchCLI, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleAuth = useCallback(async () => {
    setAuthLoading(true);
    setAuthMessage('');
    try {
      const result = await api.cliAuth();
      setAuthMessage(result.message);

      // Poll recheck every 3s for up to 60s
      let attempts = 0;
      const poller = setInterval(async () => {
        attempts++;
        try {
          const status = await api.cliRecheck();
          setCli(status);
          if (status.authenticated || attempts >= 20) {
            clearInterval(poller);
            setAuthLoading(false);
            setAuthMessage(status.authenticated ? '已连接！' : '超时，请重试');
            setTimeout(() => setAuthMessage(''), 5000);
          }
        } catch {
          if (attempts >= 20) {
            clearInterval(poller);
            setAuthLoading(false);
          }
        }
      }, 3000);
    } catch (err: any) {
      setAuthMessage(err.message || '失败');
      setAuthLoading(false);
    }
  }, []);

  const handleRecheck = useCallback(async () => {
    try {
      const status = await api.cliRecheck();
      setCli(status);
    } catch { /* ignore */ }
  }, []);

  const isConnected = cli?.available && cli?.authenticated;

  return (
    <header className="h-14 border-b border-gray-800 flex items-center justify-between px-6">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-green-500" />
          <span className="text-sm text-gray-400">运行时长：{uptime}</span>
        </div>

        {/* CLI Status */}
        <div className="w-px h-5 bg-gray-700" />
        {cli && (
          isConnected ? (
            <button
              onClick={handleRecheck}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-green-500/10 border border-green-500/20 text-sm cursor-pointer hover:bg-green-500/20 transition-colors"
              title="Claude CLI 已连接（点击刷新）"
            >
              <CheckCircle className="w-3.5 h-3.5 text-green-400" />
              <span className="text-green-300 text-xs font-medium">CLI 已连接</span>
            </button>
          ) : (
            <button
              onClick={handleAuth}
              disabled={authLoading}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm hover:bg-amber-500/20 transition-colors disabled:opacity-60"
              title="点击通过浏览器完成 Claude CLI 认证"
            >
              {authLoading ? (
                <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
              ) : (
                <Terminal className="w-3.5 h-3.5 text-amber-400" />
              )}
              <span className="text-amber-300 text-xs font-medium">
                {authLoading ? '等待中...' : '连接 CLI'}
              </span>
            </button>
          )
        )}
        {authMessage && (
          <span className={`text-xs ${authMessage.includes('已连接') ? 'text-green-400' : 'text-gray-400'}`}>
            {authMessage}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <NotificationBell />
        <button onClick={logout} className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm">
          <LogOut className="w-4 h-4" />
          退出登录
        </button>
      </div>
    </header>
  );
}
