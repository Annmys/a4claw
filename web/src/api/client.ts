const BASE_URL = '/api';

export interface ChatArtifact {
  id: string;
  name: string;
  originalName?: string;
  mime?: string;
  size?: number;
  path?: string;
  url: string;
  userKey?: string;
  createdAt?: string;
}

export interface ConversationRuntime {
  model?: string;
  responseMode?: 'auto' | 'quick' | 'deep';
  interactionMode?: 'chat' | 'task';
  thinkingMode?: 'standard' | 'deep';
  verbosity?: 'concise' | 'balanced' | 'detailed';
  compactSummary?: string | null;
  compactedAt?: string | null;
  compactSourceMessages?: number | null;
  compactTokensSaved?: number | null;
}

export interface RoutePlanStep {
  id: string;
  title: string;
  detail: string;
  capability?: string;
  optional?: boolean;
}

export interface RoutePlan {
  intent: string;
  confidence: number;
  agentId: string;
  mode: 'quick' | 'auto' | 'deep';
  routeType: 'chat' | 'tool' | 'workflow' | 'command-center' | 'openclaw' | 'document';
  requiresTools: boolean;
  requiresFiles: boolean;
  requiresMemory: boolean;
  requiresOrganization: boolean;
  requiredCapabilities: string[];
  steps: RoutePlanStep[];
  reason: string;
  riskLevel: 'low' | 'medium' | 'high';
  fallback: string;
  forceMode?: 'quick' | 'auto' | 'deep';
}

export interface ArtifactPlan {
  requestedFormats: string[];
  generatedFormats: string[];
  unresolvedFormats: string[];
  primaryFormat: string;
  extensionMode: 'builtin-only' | 'external-fallback' | 'external-only';
  rationale: string;
}

export interface FileCapabilities {
  input: {
    supportedExtensions: string[];
    externalAdapterConfigured: boolean;
    externalHandlers?: string[];
  };
  output: {
    builtInFormats: string[];
    externalAdapterConfigured: boolean;
    externalHandlers?: string[];
  };
}

export interface WebUser {
  id: string;
  username: string;
  role: 'admin' | 'user';
  lastLogin: string | null;
  createdAt: string;
  binding: CommandCenterUserBinding | null;
}

export interface CommandCenterCenter {
  id: string;
  ownerUserId: string;
  name: string;
  code: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CommandCenterDepartment {
  id: string;
  ownerUserId: string;
  centerId: string;
  name: string;
  code: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CommandCenterMember {
  id: string;
  ownerUserId: string;
  centerId: string;
  departmentId: string | null;
  displayName: string;
  employeeCode: string | null;
  roleTitle: string | null;
  employmentStatus: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CommandCenterUserBinding {
  id: string;
  memberId: string;
  memberName: string;
  centerId: string;
  centerName: string;
  departmentId: string | null;
  departmentName: string | null;
  title: string | null;
  status: string;
  isPrimary: boolean;
  updatedAt: string;
}

export interface CommandCenterOrgOptions {
  centers: CommandCenterCenter[];
  departments: CommandCenterDepartment[];
  members: CommandCenterMember[];
}

export interface CommandCenterTaskEvent {
  id: string;
  ownerUserId: string;
  taskId: string;
  eventType: string;
  actorType: string;
  actorId: string | null;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CommandCenterTask {
  id: string;
  ownerUserId: string;
  centerId: string;
  departmentId: string | null;
  assigneeMemberId: string | null;
  title: string;
  description: string | null;
  status: 'incoming' | 'triage' | 'assigned' | 'in_progress' | 'review' | 'done' | 'blocked';
  priority: 'low' | 'medium' | 'high' | 'critical';
  source: string;
  requestedBy: string | null;
  dueAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  latestEvent?: CommandCenterTaskEvent | null;
}

export interface CommandCenterSkillAssignment {
  id: string;
  ownerUserId: string;
  skillId: string;
  skillName: string;
  scopeType: 'center' | 'department' | 'member';
  scopeId: string;
  scopeName?: string;
  centerId?: string | null;
  centerName?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
  memberId?: string | null;
  memberName?: string | null;
  proficiency: number;
  priority: number;
  isPrimary: boolean;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CommandCenterTaskRun {
  id: string;
  ownerUserId: string;
  taskId: string;
  skillId: string | null;
  skillName: string | null;
  executorType: string;
  executorMemberId: string | null;
  executorMemberName?: string | null;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  inputSummary: string | null;
  outputSummary: string | null;
  artifacts: Record<string, unknown>[];
  metadata: Record<string, unknown>;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommandCenterOverview {
  actorContext?: {
    binding: CommandCenterUserBinding | null;
    skillAssignments: CommandCenterSkillAssignment[];
  };
  skillCatalog?: Array<{ id: string; name: string; description: string; category?: string }>;
  centers: CommandCenterCenter[];
  departments: CommandCenterDepartment[];
  members: CommandCenterMember[];
  skillAssignments?: CommandCenterSkillAssignment[];
  tasks: CommandCenterTask[];
  taskRuns?: CommandCenterTaskRun[];
  recentEvents: CommandCenterTaskEvent[];
  summary: {
    centers: number;
    departments: number;
    members: number;
    skillAssignments?: number;
    tasks: number;
    taskRuns?: number;
    byStatus: Record<CommandCenterTask['status'], number>;
    byRunStatus?: Record<CommandCenterTaskRun['status'], number>;
  };
}

export interface CommandCenterTaskDetail {
  task: CommandCenterTask;
  events: CommandCenterTaskEvent[];
  runs?: CommandCenterTaskRun[];
}

export interface TaskExecutorAuditItem {
  id: string;
  userId: string | null;
  action: string;
  resource: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  platform: string | null;
  createdAt: string;
}

export interface AgentRuntimeToolStatus {
  name: string;
  status: 'ready' | 'partial' | 'blocked';
  detail: string;
}

export interface AgentRuntimeStatus {
  id: string;
  name: string;
  status: 'ready' | 'partial' | 'blocked';
  executionLevel: 'full' | 'limited' | 'none';
  summary: string;
  evidence: string[];
  missing: string[];
  availableTools: string[];
  unavailableTools: string[];
  toolStatus: AgentRuntimeToolStatus[];
}

export interface CapabilitySkillItem {
  id: string;
  name: string;
  description: string;
  trigger: string;
  prompt?: string;
  examples: string[];
  version: string;
  source: string;
  sourceLabel: string;
  type: 'skill' | 'plugin-tool';
  status: 'ready' | 'partial' | 'blocked';
  editable: boolean;
  pluginName?: string;
  pluginVersion?: string;
  pluginAuthor?: string;
}

export interface CapabilitySnapshot {
  summary: {
    skills: number;
    pluginTools: number;
    plugins: number;
    loadedPlugins: number;
    ready: number;
    partial: number;
    blocked: number;
  };
  skills: CapabilitySkillItem[];
  subsystems: {
    plugins: {
      status: 'ready' | 'partial' | 'blocked';
      detail: string;
      count: number;
      loadedCount: number;
      failedCount: number;
      items: Array<{
        name: string;
        version: string;
        author: string;
        description: string;
        loaded: boolean;
        error?: string;
        toolCount: number;
      }>;
    };
    memory: {
      status: 'ready' | 'partial' | 'blocked';
      detail: string;
      documents: number;
      chunks: number;
    };
    openclaw: {
      status: 'ready' | 'partial' | 'blocked';
      detail: string;
    };
  };
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('token');
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    // Auto-logout on 401 (expired/invalid token after server restart)
    if (response.status === 401 && !path.startsWith('/auth/')) {
      localStorage.removeItem('token');
      window.location.href = '/login';
      throw new Error('Session expired');
    }
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error ?? `HTTP ${response.status}`);
  }

  return response.json();
}

// File upload helper (multipart/form-data — no Content-Type header, browser sets it)
export async function uploadRequest<T>(path: string, formData: FormData): Promise<T> {
  const token = localStorage.getItem('token');
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) {
      localStorage.removeItem('token');
      window.location.href = '/login';
      throw new Error('Session expired');
    }
    const error = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(error.error ?? `HTTP ${response.status}`);
  }

  return response.json();
}

export const api = {
  // Auth
  login: (username: string, password: string) => apiRequest<{ token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  register: (username: string, password: string) => apiRequest<{ token: string }>('/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }),

  // User Management (Admin)
  getUsers: () => apiRequest<{ users: WebUser[] }>('/users'),
  getUserOrgOptions: () => apiRequest<CommandCenterOrgOptions>('/users/org-options'),
  createUser: (data: { username: string; password: string; role?: 'admin' | 'user' }) =>
    apiRequest<{ user: WebUser }>('/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUserRole: (id: string, role: 'admin' | 'user') =>
    apiRequest<{ success: boolean; user: WebUser }>(`/users/${id}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
  resetUserPassword: (id: string, password: string) =>
    apiRequest<{ success: boolean }>(`/users/${id}/password`, { method: 'PUT', body: JSON.stringify({ password }) }),
  updateUserBinding: (id: string, data: { memberId?: string | null; title?: string }) =>
    apiRequest<{ success: boolean; user: WebUser }>(`/users/${id}/binding`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUser: (id: string) =>
    apiRequest<{ success: boolean }>(`/users/${id}`, { method: 'DELETE' }),

  // Command Center
  commandCenterOverview: () => apiRequest<CommandCenterOverview>('/command-center/overview'),
  commandCenterCreateCenter: (data: { name: string; code?: string; description?: string }) =>
    apiRequest<{ center: CommandCenterCenter }>('/command-center/centers', { method: 'POST', body: JSON.stringify(data) }),
  commandCenterCreateDepartment: (data: { centerId: string; name: string; code?: string; description?: string }) =>
    apiRequest<{ department: CommandCenterDepartment }>('/command-center/departments', { method: 'POST', body: JSON.stringify(data) }),
  commandCenterCreateMember: (data: { centerId: string; departmentId?: string | null; displayName: string; employeeCode?: string; roleTitle?: string }) =>
    apiRequest<{ member: CommandCenterMember }>('/command-center/members', { method: 'POST', body: JSON.stringify(data) }),
  commandCenterCreateTask: (data: {
    centerId: string;
    departmentId?: string | null;
    assigneeMemberId?: string | null;
    title: string;
    description?: string;
    status?: CommandCenterTask['status'];
    priority?: CommandCenterTask['priority'];
    dueAt?: string | null;
    requestedBy?: string;
    tags?: string[];
  }) => apiRequest<{ task: CommandCenterTask }>('/command-center/tasks', { method: 'POST', body: JSON.stringify(data) }),
  commandCenterTaskDetail: (id: string) => apiRequest<CommandCenterTaskDetail>(`/command-center/tasks/${id}`),
  commandCenterAutoDispatchTask: (id: string) => apiRequest<{ run: CommandCenterTaskRun; recommendation: { reason: string; executorMember: { id: string; displayName: string } | null; skillAssignment: { skillId: string; skillName: string; scopeType: 'center' | 'department' | 'member' } | null } }>(`/command-center/tasks/${id}/auto-dispatch`, { method: 'POST' }),
  commandCenterUpdateTaskStatus: (id: string, status: CommandCenterTask['status'], note?: string) =>
    apiRequest<{ task: CommandCenterTask }>(`/command-center/tasks/${id}/status`, { method: 'POST', body: JSON.stringify({ status, note }) }),
  commandCenterAddTaskEvent: (id: string, content: string, eventType = 'note') =>
    apiRequest<{ event: CommandCenterTaskEvent }>(`/command-center/tasks/${id}/events`, { method: 'POST', body: JSON.stringify({ content, eventType }) }),

  // Chat
  chat: (text: string, conversationId?: string, responseMode?: string, model?: string, interactionMode?: 'chat' | 'task') => apiRequest<{ message: string; thinking?: string; artifacts?: ChatArtifact[]; agent: string; provider?: string; model?: string; tokens?: { input: number; output: number }; skillUsed?: string; pluginUsed?: string[]; executionPath?: string[]; memoryHits?: number; routePlan?: RoutePlan; routingReason?: string; requiredCapabilities?: string[]; artifactPlan?: ArtifactPlan; elapsed?: number }>('/chat', { method: 'POST', body: JSON.stringify({ text, conversationId, responseMode, model, interactionMode }) }),
  chatWithFile: (text: string, file: File, conversationId?: string, responseMode?: string, model?: string, interactionMode?: 'chat' | 'task') => {
    const formData = new FormData();
    formData.append('text', text);
    formData.append('file', file);
    if (conversationId) formData.append('conversationId', conversationId);
    if (responseMode) formData.append('responseMode', responseMode);
    if (model) formData.append('model', model);
    if (interactionMode) formData.append('interactionMode', interactionMode);
    return uploadRequest<{ message: string; thinking?: string; artifacts?: ChatArtifact[]; agent: string; provider?: string; model?: string; tokens?: { input: number; output: number }; skillUsed?: string; pluginUsed?: string[]; executionPath?: string[]; memoryHits?: number; routePlan?: RoutePlan; routingReason?: string; requiredCapabilities?: string[]; artifactPlan?: ArtifactPlan; elapsed?: number }>('/chat', formData);
  },
  status: () => apiRequest<{ status: string; uptime: number; memory: number }>('/status'),

  // Settings
  getSettings: () => apiRequest<any>('/settings'),
  updateSettings: (data: any) => apiRequest<any>('/settings', { method: 'PUT', body: JSON.stringify(data) }),
  testKey: (provider: string, key: string) => apiRequest<{ valid: boolean; message: string; provider: string }>('/settings/test-key', { method: 'POST', body: JSON.stringify({ provider, key }) }),

  // Skills
  getSkills: () => apiRequest<CapabilitySkillItem[]>('/skills'),
  createSkill: (data: any) => apiRequest<any>('/skills', { method: 'POST', body: JSON.stringify(data) }),
  updateSkill: (id: string, data: any) => apiRequest<any>(`/skills/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSkill: (id: string) => apiRequest<any>(`/skills/${id}`, { method: 'DELETE' }),

  // Servers
  getServers: () => apiRequest<any[]>('/servers'),
  addServer: (data: any) => apiRequest<any>('/servers', { method: 'POST', body: JSON.stringify(data) }),
  removeServer: (id: string) => apiRequest<any>(`/servers/${id}`, { method: 'DELETE' }),
  execOnServer: (id: string, command: string) => apiRequest<any>(`/servers/${id}/exec`, { method: 'POST', body: JSON.stringify({ command }) }),
  serverHealth: (id: string) => apiRequest<any>(`/servers/${id}/health`),

  // Logs
  getLogs: (params?: { level?: string; limit?: number; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.level) qs.set('level', params.level);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.search) qs.set('search', params.search);
    return apiRequest<any>(`/logs?${qs.toString()}`);
  },
  getTaskExecutorAuditTrail: (limit = 30) =>
    apiRequest<{ items: TaskExecutorAuditItem[] }>(`/logs/task-executor?limit=${limit}`),

  // Costs
  getCostsToday: () => apiRequest<any>('/costs/today'),
  getCostsHistory: () => apiRequest<any>('/costs/history'),
  getCostsBreakdown: () => apiRequest<any>('/costs/breakdown'),

  // Cron
  getCronTasks: () => apiRequest<any[]>('/cron'),
  createCronTask: (data: any) => apiRequest<any>('/cron', { method: 'POST', body: JSON.stringify(data) }),
  deleteCronTask: (id: string) => apiRequest<any>(`/cron/${id}`, { method: 'DELETE' }),
  toggleCronTask: (id: string) => apiRequest<any>(`/cron/${id}/toggle`, { method: 'POST' }),

  // Conversations / History
  getConversations: (params?: { platform?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.platform) qs.set('platform', params.platform);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    return apiRequest<{ conversations: Array<{ id: string; title: string | null; platform: string; messageCount: number; lastMessage: { content: string; role: string; createdAt: string } | null; runtime?: ConversationRuntime | null; createdAt: string; updatedAt: string }> }>(`/history?${qs.toString()}`);
  },
  getConversation: (id: string) => apiRequest<{ id: string; runtime?: ConversationRuntime | null; messages: Array<{ id: string; role: string; content: string; agent?: string; artifacts?: ChatArtifact[]; skillUsed?: string; pluginUsed?: string[]; executionPath?: string[]; memoryHits?: number; routePlan?: RoutePlan; routingReason?: string; requiredCapabilities?: string[]; artifactPlan?: ArtifactPlan; createdAt: string }> }>(`/history/${id}`),
  getConversationRuntime: (id: string) => apiRequest<{ id: string; runtime?: ConversationRuntime | null }>(`/history/${id}/runtime`),
  updateConversationRuntime: (id: string, runtime: Partial<ConversationRuntime>) => apiRequest<{ ok: boolean; runtime: ConversationRuntime }>(`/history/${id}/runtime`, { method: 'PUT', body: JSON.stringify(runtime) }),
  compactConversation: (id: string) => apiRequest<{ ok: boolean; runtime: ConversationRuntime; summary: string; sourceMessages: number; tokensSaved: number }>(`/history/${id}/compact`, { method: 'POST' }),
  createConversationOnServer: (conversationId: string, title?: string) => apiRequest<{ id: string; ok: boolean }>('/history', { method: 'POST', body: JSON.stringify({ conversationId, title }) }),
  renameConversationOnServer: (id: string, title: string) => apiRequest<{ ok: boolean }>(`/history/${id}`, { method: 'PUT', body: JSON.stringify({ title }) }),
  deleteConversationOnServer: (id: string) => apiRequest<{ ok: boolean }>(`/history/${id}`, { method: 'DELETE' }),
  // Legacy alias
  getHistory: (params?: { platform?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.platform) qs.set('platform', params.platform);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    return apiRequest<any>(`/history?${qs.toString()}`);
  },

  // RAG (Knowledge Base)
  ragUpload: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return uploadRequest<{ success: boolean; source: string; type: string; chunks: number }>('/rag/upload', formData);
  },
  ragIngestUrl: (url: string) => apiRequest<{ success: boolean; source: string; chunks: number }>('/rag/ingest-url', { method: 'POST', body: JSON.stringify({ url }) }),
  ragQuery: (question: string, topK?: number) => apiRequest<{ question: string; answer: string; documentsSearched: number }>('/rag/query', { method: 'POST', body: JSON.stringify({ question, topK }) }),
  ragDocuments: () => apiRequest<{ documents: string[]; totalChunks: number }>('/rag/documents'),
  ragDeleteDocument: (source: string) => apiRequest<{ success: boolean }>(`/rag/documents/${encodeURIComponent(source)}`, { method: 'DELETE' }),
  ragStats: () => apiRequest<{ documents: number; chunks: number }>('/rag/stats'),

  // Dashboard
  dashboardStatus: () => apiRequest<any>('/dashboard/status'),
  dashboardCosts: () => apiRequest<any>('/dashboard/costs'),
  dashboardCron: () => apiRequest<any>('/dashboard/cron'),
  dashboardActivity: () => apiRequest<any[]>('/dashboard/activity'),
  graphData: () => apiRequest<any>('/dashboard/graph'),
  dashboardHeatmap: () => apiRequest<{ grid: number[][]; period: string }>('/dashboard/heatmap'),
  dashboardKanban: () => apiRequest<{ columns: Record<string, any[]>; total: number }>('/dashboard/kanban'),
  dashboardApprovals: () => apiRequest<{ pending: any[]; stats: { pending: number; approvedToday: number; deniedToday: number } }>('/dashboard/approvals'),
  dashboardAgentReality: () => apiRequest<{ items: AgentRuntimeStatus[]; summary: { total: number; ready: number; partial: number; blocked: number }; providers: string[]; capabilities?: CapabilitySnapshot }>('/dashboard/agent-reality'),
  approveAction: (id: string) => apiRequest<{ ok: boolean }>(`/dashboard/approvals/${id}/approve`, { method: 'POST' }),
  denyAction: (id: string) => apiRequest<{ ok: boolean }>(`/dashboard/approvals/${id}/deny`, { method: 'POST' }),

  // Claude CLI
  cliStatus: () => apiRequest<{ available: boolean; authenticated: boolean; cliPath: string; lastCheckAt: number }>('/cli/status'),
  cliAuth: () => apiRequest<{ ok: boolean; authUrl: string | null; message: string }>('/cli/auth', { method: 'POST' }),
  cliRecheck: () => apiRequest<{ available: boolean; authenticated: boolean; cliPath: string; lastCheckAt: number }>('/cli/recheck', { method: 'POST' }),

  // WhatsApp
  whatsappQR: () => apiRequest<{ qr: string | null; qrDataUrl: string | null; status: string }>('/whatsapp/qr'),
  whatsappStatus: () => apiRequest<{ status: string }>('/whatsapp/status'),

  // Models
  getModels: () => apiRequest<{ models: Array<{ id: string; name: string; provider: string; tier: string; supportsHebrew?: boolean; supportsVision?: boolean }> }>('/models'),

  // OpenClaw (direct chat)
  openclawChat: (text: string) => apiRequest<{ message: string; success: boolean }>('/openclaw/chat', { method: 'POST', body: JSON.stringify({ text }) }),
  openclawStatus: () => apiRequest<{ status: string; connected: boolean; data?: any; error?: string; scope?: { sessionKey: string; agentId: string } }>('/openclaw/status'),
  openclawHistory: (limit = 100) => apiRequest<{
    success: boolean;
    scope: { sessionKey: string; agentId: string };
    sessionKey: string;
    sessionId: string | null;
    messages: Array<{
      role: 'user' | 'assistant' | 'system';
      content?: Array<{ type?: string; text?: string }>;
      timestamp?: number;
      provider?: string;
      model?: string;
    }>;
  }>(`/openclaw/history?limit=${limit}`),
  openclawContext: () => apiRequest<{
    userId: string;
    role: 'admin' | 'user';
    scope: { sessionKey: string; agentId: string };
    permissions: { canUseRaw: boolean; canViewAllSessions: boolean };
    limits: { chatPerMinute: number; agentPerMinute: number };
  }>('/openclaw/context'),

  // Evolution
  evolutionStatus: () => apiRequest<any>('/evolution/status'),
  evolutionModels: (params?: { provider?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.provider) qs.set('provider', params.provider);
    if (params?.limit) qs.set('limit', String(params.limit));
    return apiRequest<any>(`/evolution/models?${qs.toString()}`);
  },
  evolutionDiscovered: (limit?: number) => apiRequest<any>(`/evolution/discovered?limit=${limit || 50}`),
  evolutionTrigger: (full?: boolean) => apiRequest<any>('/evolution/trigger', { method: 'POST', body: JSON.stringify({ full: !!full }) }),
  evolutionScanModels: () => apiRequest<any>('/evolution/scan-models', { method: 'POST' }),
  evolutionScanEcosystem: () => apiRequest<any>('/evolution/scan-ecosystem', { method: 'POST' }),

  // Browser View
  browserSessions: () => apiRequest<{ sessions: any[] }>('/browser/sessions'),
  browserCreateSession: (url?: string, withVnc = true) => apiRequest<any>('/browser/sessions', { method: 'POST', body: JSON.stringify({ url, withVnc }) }),
  browserCloseSession: (id: string) => apiRequest<{ ok: boolean }>(`/browser/sessions/${id}`, { method: 'DELETE' }),
  browserNavigate: (id: string, url: string) => apiRequest<{ ok: boolean; url?: string; title?: string }>(`/browser/sessions/${id}/navigate`, { method: 'POST', body: JSON.stringify({ url }) }),
  browserAttachVnc: (id: string) => apiRequest<{ ok: boolean; wsPort: number; display: number }>(`/browser/sessions/${id}/attach-vnc`, { method: 'POST' }),
  browserDetachVnc: (id: string) => apiRequest<{ ok: boolean }>(`/browser/sessions/${id}/detach-vnc`, { method: 'POST' }),
  browserVncKeepalive: (id: string) => apiRequest<{ ok: boolean }>(`/browser/sessions/${id}/vnc-keepalive`, { method: 'POST' }),
  browserAiAction: (id: string, instruction: string) => apiRequest<{ result: string; url?: string; title?: string }>(`/browser/sessions/${id}/ai-action`, { method: 'POST', body: JSON.stringify({ instruction }) }),
  browserSnapshot: (id: string) => apiRequest<{ snapshot: any; url: string; title: string }>(`/browser/sessions/${id}/snapshot`),
  browserClick: (id: string, selector: string) => apiRequest<{ ok: boolean; url: string; title: string }>(`/browser/sessions/${id}/click`, { method: 'POST', body: JSON.stringify({ selector }) }),
  browserType: (id: string, selector: string, text: string, submit?: boolean) => apiRequest<{ ok: boolean }>(`/browser/sessions/${id}/type`, { method: 'POST', body: JSON.stringify({ selector, text, submit }) }),
  browserEvaluate: (id: string, script: string) => apiRequest<{ ok: boolean; result: any }>(`/browser/sessions/${id}/evaluate`, { method: 'POST', body: JSON.stringify({ script }) }),
  browserScreenshot: (id: string) => `/api/browser/sessions/${id}/screenshot`,
  browserResources: () => apiRequest<any>('/browser/resources'),

  // Facebook Accounts
  facebookAccounts: () => apiRequest<{ accounts: any[] }>('/facebook/accounts'),
  facebookAddAccount: (name: string, cookies: string) => apiRequest<any>('/facebook/accounts', { method: 'POST', body: JSON.stringify({ name, cookies }) }),
  facebookDeleteAccount: (id: string) => apiRequest<{ ok: boolean }>(`/facebook/accounts/${id}`, { method: 'DELETE' }),
  facebookUpdateCookies: (id: string, cookies: string) => apiRequest<any>(`/facebook/accounts/${id}/cookies`, { method: 'PUT', body: JSON.stringify({ cookies }) }),
  facebookVerify: (id: string) => apiRequest<{ success: boolean; sessionId: string; profileName?: string; error?: string }>(`/facebook/accounts/${id}/verify`, { method: 'POST' }),
  facebookLaunch: (id: string, withVnc = true) => apiRequest<{ sessionId: string; url: string }>(`/facebook/accounts/${id}/launch`, { method: 'POST', body: JSON.stringify({ withVnc }) }),
  facebookParsePreview: (cookies: string) => apiRequest<{ valid: boolean; format: string; cookieCount: number; cookieNames: string[]; userId?: string; missing: string[]; warnings: string[]; error?: string }>('/facebook/parse-preview', { method: 'POST', body: JSON.stringify({ cookies }) }),

  // Facebook Agent (Autonomous)
  fbAgentList: () => apiRequest<{ agents: any[] }>('/facebook-agent/agents'),
  fbAgentStatus: (accountId: string) => apiRequest<any>(`/facebook-agent/agents/${accountId}`),
  fbAgentStart: (accountId: string, config?: any) => apiRequest<{ ok: boolean; status: any }>('/facebook-agent/agents', { method: 'POST', body: JSON.stringify({ accountId, config }) }),
  fbAgentStop: (accountId: string) => apiRequest<{ ok: boolean }>(`/facebook-agent/agents/${accountId}/stop`, { method: 'POST' }),
  fbAgentPause: (accountId: string) => apiRequest<{ ok: boolean; status: any }>(`/facebook-agent/agents/${accountId}/pause`, { method: 'POST' }),
  fbAgentResume: (accountId: string) => apiRequest<{ ok: boolean; status: any }>(`/facebook-agent/agents/${accountId}/resume`, { method: 'POST' }),
  fbAgentConfig: (accountId: string) => apiRequest<any>(`/facebook-agent/agents/${accountId}/config`),
  fbAgentUpdateConfig: (accountId: string, config: any) => apiRequest<{ ok: boolean; config: any }>(`/facebook-agent/agents/${accountId}/config`, { method: 'PUT', body: JSON.stringify(config) }),
  fbAgentLogs: (accountId: string, limit?: number) => apiRequest<{ logs: any[] }>(`/facebook-agent/agents/${accountId}/logs?limit=${limit || 50}`),

  // Generic helpers
  fileCapabilities: () => apiRequest<FileCapabilities>('/files/capabilities'),
  get: <T = any>(path: string) => apiRequest<T>(path),
  post: <T = any>(path: string, body?: any) => apiRequest<T>(path, { method: 'POST', body: body != null ? JSON.stringify(body) : undefined }),
  delete: <T = any>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),

  // Approval Gates (Phase 2)
  listApprovalGates: (centerId?: string) => {
    const qs = centerId ? `?centerId=${encodeURIComponent(centerId)}` : '';
    return apiRequest<{ gates: any[] }>(`/command-center/approval-gates${qs}`);
  },
  createApprovalGate: (gate: { name: string; gateType: string; description: string; approverMemberIds: string[]; autoApproveConditions?: any; requireAllApprovers?: boolean; timeoutHours?: number; enabled?: boolean; centerId?: string }) =>
    apiRequest<{ id: string }>('/command-center/approval-gates', { method: 'POST', body: JSON.stringify(gate) }),
  updateApprovalGate: (id: string, updates: Partial<{ name: string; description: string; approverMemberIds: string[]; autoApproveConditions?: any; requireAllApprovers?: boolean; timeoutHours?: number; enabled?: boolean }>) =>
    apiRequest<{ success: boolean }>(`/command-center/approval-gates/${id}`, { method: 'PATCH', body: JSON.stringify(updates) }),
  deleteApprovalGate: (id: string) =>
    apiRequest<void>(`/command-center/approval-gates/${id}`, { method: 'DELETE' }),
  checkNeedsApproval: (gateType: string, payload: any, centerId?: string) =>
    apiRequest<{ needsApproval: boolean; matchingGates: any[] }>('/command-center/approval-gates/check', { method: 'POST', body: JSON.stringify({ gateType, payload, centerId }) }),
  getPendingApprovals: () =>
    apiRequest<{ requests: any[] }>('/command-center/approvals/pending'),
  getApprovalRequest: (id: string) =>
    apiRequest<{ request: any }>(`/command-center/approvals/${id}`),
  makeApprovalDecision: (id: string, decision: 'approved' | 'rejected', comment?: string) =>
    apiRequest<{ success: boolean }>(`/command-center/approvals/${id}/decide`, { method: 'POST', body: JSON.stringify({ decision, comment }) }),
};
