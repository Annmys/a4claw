import { create } from 'zustand';
import { api } from '../api/client';
import type { ChatArtifact } from '../api/client';

export interface ProgressEntry {
  type: string;
  message: string;
  agent?: string;
  tool?: string;
  time: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  artifacts?: ChatArtifact[];
  thinking?: string;
  agent?: string;
  provider?: string;
  model?: string;
  tokens?: { input: number; output: number; total: number };
  elapsed?: number;
  progressLog?: ProgressEntry[];
  timestamp: Date;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

interface SerializedConversation {
  id: string;
  title: string;
  messages: Array<Omit<Message, 'timestamp'> & { timestamp: string }>;
  createdAt: string;
  updatedAt: string;
}

interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  loadingConversationId: string | null;
  synced: boolean;
  storageKey: string;

  // Derived
  isLoading: boolean;

  // Actions
  getMessages: () => Message[];
  newConversation: () => string;
  switchConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  addMessage: (msg: Omit<Message, 'id' | 'timestamp'>) => void;
  addMessageTo: (conversationId: string, msg: Omit<Message, 'id' | 'timestamp'>) => void;
  setLoading: (loading: boolean) => void;
  setConversationLoading: (conversationId: string | null) => void;
  isConversationLoading: (conversationId: string) => boolean;
  clear: () => void;
  hydrateForCurrentUser: () => void;
  syncWithServer: () => Promise<void>;
  loadConversationFromServer: (id: string) => Promise<void>;
}

const STORAGE_KEY_PREFIX = 'a4claw-conversations';

function generateId(): string {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUUID) return randomUUID();
  const rand = Math.random().toString(36).slice(2, 10);
  return `id_${Date.now()}_${rand}`;
}

function decodeJwtUserId(token: string | null): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const parsed = JSON.parse(atob(padded)) as { userId?: string };
    return typeof parsed.userId === 'string' && parsed.userId ? parsed.userId : null;
  } catch {
    return null;
  }
}

function getCurrentStorageKey(): string {
  const userId = decodeJwtUserId(localStorage.getItem('token')) ?? 'guest';
  return `${STORAGE_KEY_PREFIX}:${userId}`;
}

function saveToStorage(storageKey: string, conversations: Conversation[]) {
  try {
    const data: SerializedConversation[] = conversations.map(c => ({
      ...c,
      messages: c.messages.map(m => ({ ...m, timestamp: m.timestamp.toISOString() })),
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    }));
    localStorage.setItem(storageKey, JSON.stringify(data));
  } catch { /* storage full or unavailable */ }
}

function loadFromStorage(storageKey: string): Conversation[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const data: SerializedConversation[] = JSON.parse(raw);
    return data.map(c => ({
      ...c,
      messages: c.messages.map(m => ({ ...m, timestamp: new Date(m.timestamp) })),
      createdAt: new Date(c.createdAt),
      updatedAt: new Date(c.updatedAt),
    }));
  } catch {
    return [];
  }
}

function generateTitle(text: string): string {
  // Take first ~40 chars of the first user message as title
  const clean = text.replace(/\n/g, ' ').trim();
  return clean.length > 40 ? clean.slice(0, 40) + '...' : clean;
}

function createConversation(): Conversation {
  return {
    id: generateId(),
    title: 'New Chat',
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function addMessageToConversation(
  conversations: Conversation[],
  conversationId: string,
  msg: Omit<Message, 'id' | 'timestamp'>,
): Conversation[] {
  const newMessage: Message = { ...msg, id: generateId(), timestamp: new Date() };
  return conversations.map(c => {
    if (c.id !== conversationId) return c;
    const messages = [...c.messages, newMessage];
    const title = c.messages.length === 0 && msg.role === 'user'
      ? generateTitle(msg.content)
      : c.title;
    return { ...c, messages, title, updatedAt: new Date() };
  });
}

const initialStorageKey = getCurrentStorageKey();
const initialConversations = loadFromStorage(initialStorageKey);
const initialActive = initialConversations.length > 0 ? initialConversations[0].id : null;

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: initialConversations,
  activeConversationId: initialActive,
  loadingConversationId: null,
  synced: false,
  storageKey: initialStorageKey,
  isLoading: false,

  getMessages: () => {
    const state = get();
    const conv = state.conversations.find(c => c.id === state.activeConversationId);
    return conv?.messages ?? [];
  },

  newConversation: () => {
    const conv = createConversation();
    set(state => {
      const updated = [conv, ...state.conversations];
      saveToStorage(state.storageKey, updated);
      return { conversations: updated, activeConversationId: conv.id };
    });
    // Sync to server in background (fire-and-forget)
    api.createConversationOnServer(conv.id, 'New Chat').catch(() => {});
    return conv.id;
  },

  switchConversation: (id) => set(state => {
    return {
      activeConversationId: id,
      isLoading: state.loadingConversationId === id,
    };
  }),

  deleteConversation: (id) => {
    set(state => {
      const updated = state.conversations.filter(c => c.id !== id);
      saveToStorage(state.storageKey, updated);
      const newActive = state.activeConversationId === id
        ? (updated[0]?.id ?? null)
        : state.activeConversationId;
      return { conversations: updated, activeConversationId: newActive };
    });
    // Sync delete to server
    api.deleteConversationOnServer(id).catch(() => {});
  },

  renameConversation: (id, title) => {
    set(state => {
      const updated = state.conversations.map(c =>
        c.id === id ? { ...c, title } : c
      );
      saveToStorage(state.storageKey, updated);
      return { conversations: updated };
    });
    // Sync rename to server
    api.renameConversationOnServer(id, title).catch(() => {});
  },

  // Add message to active conversation
  addMessage: (msg) => set(state => {
    let { activeConversationId, conversations } = state;

    // Auto-create conversation if none exists
    if (!activeConversationId || !conversations.find(c => c.id === activeConversationId)) {
      const conv = createConversation();
      conversations = [conv, ...conversations];
      activeConversationId = conv.id;
      // Sync new conversation to server
      api.createConversationOnServer(conv.id, 'New Chat').catch(() => {});
    }

    const updated = addMessageToConversation(conversations, activeConversationId, msg);
    saveToStorage(state.storageKey, updated);

    // If first user message, sync the auto-generated title to server
    const conv = updated.find(c => c.id === activeConversationId);
    if (conv && conv.messages.length === 1 && msg.role === 'user') {
      api.renameConversationOnServer(activeConversationId, conv.title).catch(() => {});
    }

    return { conversations: updated, activeConversationId };
  }),

  // Add message to a SPECIFIC conversation (even if not active)
  addMessageTo: (conversationId, msg) => set(state => {
    let conversations = state.conversations;

    // If conversation is missing locally (e.g. WS response after reconnect), create it first.
    if (!conversations.find(c => c.id === conversationId)) {
      const conv: Conversation = {
        id: conversationId,
        title: 'New Chat',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      conversations = [conv, ...conversations];
      api.createConversationOnServer(conversationId, conv.title).catch(() => {});
    }

    const updated = addMessageToConversation(conversations, conversationId, msg);
    saveToStorage(state.storageKey, updated);
    return {
      conversations: updated,
      activeConversationId: state.activeConversationId ?? conversationId,
    };
  }),

  // Set loading for active conversation (backward compat)
  setLoading: (loading) => set(state => ({
    isLoading: loading && state.loadingConversationId === state.activeConversationId,
    loadingConversationId: loading ? (state.loadingConversationId ?? state.activeConversationId) : null,
  })),

  // Set loading for a specific conversation
  setConversationLoading: (conversationId) => set(state => ({
    loadingConversationId: conversationId,
    isLoading: conversationId === state.activeConversationId,
  })),

  isConversationLoading: (conversationId) => {
    return get().loadingConversationId === conversationId;
  },

  clear: () => set(state => {
    const updated = state.conversations.map(c =>
      c.id === state.activeConversationId
        ? { ...c, messages: [], title: 'New Chat', updatedAt: new Date() }
        : c
    );
    saveToStorage(state.storageKey, updated);
    return { conversations: updated };
  }),

  hydrateForCurrentUser: () => {
    const storageKey = getCurrentStorageKey();
    const conversations = loadFromStorage(storageKey);
    const activeConversationId = conversations[0]?.id ?? null;
    set({
      storageKey,
      conversations,
      activeConversationId,
      loadingConversationId: null,
      synced: false,
      isLoading: false,
    });
  },

  // Sync conversations from server — merges with localStorage
  syncWithServer: async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return; // Not logged in

      const { conversations: serverConvs } = await api.getConversations({ limit: 100 });
      const state = get();
      const localConvs = state.conversations;

      // Build a map of local conversations by ID
      const localMap = new Map(localConvs.map(c => [c.id, c]));

      // Merge: server conversations that don't exist locally get added (with empty messages — loaded on demand)
      const newFromServer: Conversation[] = [];
      for (const sc of serverConvs) {
        if (!localMap.has(sc.id) && sc.messageCount > 0) {
          newFromServer.push({
            id: sc.id,
            title: sc.title ?? (sc.lastMessage?.content.slice(0, 40) ?? 'Conversation'),
            messages: [], // Loaded on demand when user switches to this conversation
            createdAt: new Date(sc.createdAt),
            updatedAt: new Date(sc.updatedAt),
          });
        }
      }

      if (newFromServer.length > 0) {
        set(state => {
          // Sort all by updatedAt desc
          const merged = [...state.conversations, ...newFromServer]
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
          saveToStorage(state.storageKey, merged);
          return { conversations: merged, synced: true };
        });
      } else {
        set({ synced: true });
      }

      // Also sync local conversations that server doesn't know about
      const serverIds = new Set(serverConvs.map(c => c.id));
      for (const local of localConvs) {
        if (!serverIds.has(local.id) && local.messages.length > 0) {
          api.createConversationOnServer(local.id, local.title).catch(() => {});
        }
      }
    } catch {
      // Server not available — continue with localStorage only
      set({ synced: true });
    }
  },

  // Load messages for a conversation from server (when switching to a server-synced conv with empty messages)
  loadConversationFromServer: async (id: string) => {
    try {
      const state = get();
      const conv = state.conversations.find(c => c.id === id);
      if (!conv || conv.messages.length > 0) return; // Already has messages

      const data = await api.getConversation(id);
      if (data.messages.length === 0) return;

      const messages: Message[] = data.messages.map(m => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        agent: m.agent,
        artifacts: m.artifacts,
        timestamp: new Date(m.createdAt),
      }));

      set(state => {
        const updated = state.conversations.map(c =>
          c.id === id ? { ...c, messages } : c
        );
        saveToStorage(state.storageKey, updated);
        return { conversations: updated };
      });
    } catch {
      // Silently fail — conversation might not exist on server
    }
  },
}));
