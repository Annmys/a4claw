import { create } from 'zustand';
import { api, apiRequest } from '../api/client';

export interface SystemNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
  source: string;
  createdAt: number;
  readAt?: number;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
}

interface NotificationsState {
  notifications: SystemNotification[];
  unreadCount: number;
  loading: boolean;

  fetchAll: (opts?: { unreadOnly?: boolean; limit?: number }) => Promise<void>;
  fetchUnreadCount: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  addFromWebSocket: (notification: SystemNotification) => void;
}

export const useNotificationsStore = create<NotificationsState>((set, _get) => ({
  notifications: [],
  unreadCount: 0,
  loading: false,

  fetchAll: async (opts) => {
    set({ loading: true });
    try {
      const params = new URLSearchParams();
      if (opts?.unreadOnly) params.set('unread', 'true');
      if (opts?.limit) params.set('limit', String(opts.limit));
      const data = await api.get<{
        notifications: SystemNotification[];
        unreadCount: number;
        total: number;
      }>(`/evolution/notifications?${params.toString()}`);
      set({ notifications: data.notifications, unreadCount: data.unreadCount });
    } catch { /* ignore */ }
    set({ loading: false });
  },

  fetchUnreadCount: async () => {
    try {
      const data = await api.get<{ count: number }>('/evolution/notifications/unread-count');
      set({ unreadCount: data.count });
    } catch { /* ignore */ }
  },

  markRead: async (id: string) => {
    try {
      await apiRequest(`/evolution/notifications/${id}/read`, { method: 'POST' });
      set(s => ({
        notifications: s.notifications.map(n => n.id === id ? { ...n, readAt: Date.now() } : n),
        unreadCount: Math.max(0, s.unreadCount - 1),
      }));
    } catch { /* ignore */ }
  },

  markAllRead: async () => {
    try {
      await apiRequest('/evolution/notifications/read-all', { method: 'POST' });
      set(s => ({
        notifications: s.notifications.map(n => ({ ...n, readAt: n.readAt || Date.now() })),
        unreadCount: 0,
      }));
    } catch { /* ignore */ }
  },

  addFromWebSocket: (notification: SystemNotification) => {
    set(s => ({
      notifications: [notification, ...s.notifications].slice(0, 50),
      unreadCount: s.unreadCount + 1,
    }));
  },
}));
