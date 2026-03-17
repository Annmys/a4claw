import { useState, useEffect, useCallback } from 'react';
import { X, AlertTriangle, Info, AlertCircle } from 'lucide-react';

export interface Toast {
  id: string;
  title: string;
  body?: string;
  severity: 'info' | 'warning' | 'critical';
}

const severityStyles: Record<string, { bg: string; border: string; icon: typeof Info }> = {
  critical: { bg: 'bg-red-500/10', border: 'border-red-500/30', icon: AlertCircle },
  warning: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', icon: AlertTriangle },
  info: { bg: 'bg-blue-500/10', border: 'border-blue-500/30', icon: Info },
};

let addToastGlobal: ((toast: Omit<Toast, 'id'>) => void) | null = null;

/** Push a toast from anywhere (outside React tree) */
export function pushToast(toast: Omit<Toast, 'id'>) {
  addToastGlobal?.(toast);
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts(prev => [...prev, { ...toast, id }].slice(-5));
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 6000);
  }, []);

  // Register global handler
  useEffect(() => {
    addToastGlobal = addToast;
    return () => { addToastGlobal = null; };
  }, [addToast]);

  const dismiss = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-80 pointer-events-none">
      {toasts.map(toast => {
        const style = severityStyles[toast.severity] || severityStyles.info;
        const Icon = style.icon;
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto ${style.bg} border ${style.border} rounded-lg p-3 shadow-lg backdrop-blur-sm animate-slide-in`}
          >
            <div className="flex items-start gap-2.5">
              <Icon className="w-4 h-4 mt-0.5 flex-shrink-0 opacity-80" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-100 truncate">{toast.title}</p>
                {toast.body && <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{toast.body}</p>}
              </div>
              <button onClick={() => dismiss(toast.id)} className="text-gray-500 hover:text-gray-300 flex-shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
