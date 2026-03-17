import { pgTable, text, timestamp, integer, boolean, jsonb, uuid, varchar, index, serial, real, doublePrecision, uniqueIndex } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  platformId: varchar('platform_id', { length: 100 }).notNull(),
  platform: varchar('platform', { length: 20 }).notNull(),
  name: varchar('name', { length: 200 }),
  role: varchar('role', { length: 20 }).default('user').notNull(),
  masterUserId: uuid('master_user_id'),
  preferences: jsonb('preferences').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_users_platform').on(table.platform, table.platformId),
  index('idx_users_master').on(table.masterUserId),
]);

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  platform: varchar('platform', { length: 20 }).notNull(),
  title: varchar('title', { length: 200 }),
  isActive: boolean('is_active').default(true).notNull(),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_conversations_user').on(table.userId),
]);

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').references(() => conversations.id).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  role: varchar('role', { length: 20 }).notNull(),
  content: text('content').notNull(),
  agentId: varchar('agent_id', { length: 50 }),
  intent: varchar('intent', { length: 50 }),
  tokensUsed: jsonb('tokens_used'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_messages_conversation').on(table.conversationId),
  index('idx_messages_user').on(table.userId),
]);

export const knowledge = pgTable('knowledge', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  key: varchar('key', { length: 200 }).notNull(),
  value: text('value').notNull(),
  category: varchar('category', { length: 50 }).default('general'),
  confidence: integer('confidence').default(80),
  source: varchar('source', { length: 100 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_knowledge_user').on(table.userId),
]);

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description'),
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  priority: varchar('priority', { length: 5 }).default('p2').notNull(),
  dueDate: timestamp('due_date'),
  completedAt: timestamp('completed_at'),
  tags: jsonb('tags').default([]),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_tasks_user').on(table.userId),
  index('idx_tasks_status').on(table.status),
]);

export const servers = pgTable('servers', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  host: varchar('host', { length: 200 }).notNull(),
  port: integer('port').default(22).notNull(),
  username: varchar('username', { length: 100 }).notNull(),
  authMethod: varchar('auth_method', { length: 20 }).default('key').notNull(),
  encryptedCredential: text('encrypted_credential'),
  status: varchar('status', { length: 20 }).default('unknown'),
  lastChecked: timestamp('last_checked'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_servers_user').on(table.userId),
]);

export const cronTasks = pgTable('cron_tasks', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  expression: text('expression').notNull(),
  action: text('action').notNull(),
  actionData: text('action_data').default('{}'),
  platform: text('platform').default('telegram'),
  enabled: boolean('enabled').default(true),
  lastRun: timestamp('last_run'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const documentChunks = pgTable('document_chunks', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  text: text('text').notNull(),
  source: text('source').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  embedding: text('embedding').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const usageLogs = pgTable('usage_logs', {
  id: serial('id').primaryKey(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').default(0),
  outputTokens: integer('output_tokens').default(0),
  cost: real('cost').default(0),
  userId: text('user_id').notNull(),
  action: text('action').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// ---------------------------------------------------------------------------
// Crypto Trading tables
// ---------------------------------------------------------------------------

export const exchangeConfigs = pgTable('exchange_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  exchange: varchar('exchange', { length: 50 }).notNull(),      // binance, okx
  encryptedApiKey: text('encrypted_api_key').notNull(),
  encryptedApiSecret: text('encrypted_api_secret').notNull(),
  encryptedPassphrase: text('encrypted_passphrase'),             // OKX only
  isActive: boolean('is_active').default(true).notNull(),
  label: varchar('label', { length: 100 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_exchange_configs_user').on(table.userId),
]);

export const trades = pgTable('trades', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  exchange: varchar('exchange', { length: 50 }).notNull(),
  symbol: varchar('symbol', { length: 30 }).notNull(),           // BTC/USDT
  side: varchar('side', { length: 10 }).notNull(),               // buy, sell
  type: varchar('type', { length: 20 }).default('market'),       // market, limit
  price: doublePrecision('price').notNull(),
  amount: doublePrecision('amount').notNull(),
  cost: doublePrecision('cost').notNull(),                       // price * amount
  fee: doublePrecision('fee').default(0),
  stopLoss: doublePrecision('stop_loss'),
  takeProfit: doublePrecision('take_profit'),
  pnl: doublePrecision('pnl'),                                  // realized P&L
  pnlPercent: doublePrecision('pnl_percent'),
  strategy: varchar('strategy', { length: 50 }),                 // scalping, day-trading, swing, dca
  status: varchar('status', { length: 20 }).default('open').notNull(), // open, closed, cancelled
  isPaper: boolean('is_paper').default(true).notNull(),
  closedAt: timestamp('closed_at'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_trades_user').on(table.userId),
  index('idx_trades_symbol').on(table.symbol),
  index('idx_trades_status').on(table.status),
]);

export const portfolios = pgTable('portfolios', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  exchange: varchar('exchange', { length: 50 }).notNull(),
  asset: varchar('asset', { length: 20 }).notNull(),             // BTC, ETH, USDT
  amount: doublePrecision('amount').default(0).notNull(),
  avgEntryPrice: doublePrecision('avg_entry_price'),
  currentPrice: doublePrecision('current_price'),
  unrealizedPnl: doublePrecision('unrealized_pnl'),
  isPaper: boolean('is_paper').default(true).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_portfolios_user').on(table.userId),
]);

export const tradingSignals = pgTable('trading_signals', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),
  symbol: varchar('symbol', { length: 30 }).notNull(),
  timeframe: varchar('timeframe', { length: 10 }).notNull(),     // 1m, 5m, 15m, 1h, 4h, 1d
  direction: varchar('direction', { length: 10 }).notNull(),     // long, short, neutral
  confidence: doublePrecision('confidence').notNull(),            // 0-100
  strategy: varchar('strategy', { length: 50 }).notNull(),
  entryPrice: doublePrecision('entry_price'),
  stopLoss: doublePrecision('stop_loss'),
  takeProfit: doublePrecision('take_profit'),
  indicators: jsonb('indicators').default({}),                   // RSI, MACD values etc
  outcome: varchar('outcome', { length: 20 }),                   // win, loss, expired, null
  isActive: boolean('is_active').default(true).notNull(),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_signals_symbol').on(table.symbol),
  index('idx_signals_active').on(table.isActive),
]);

export const tradingRiskConfig = pgTable('trading_risk_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  paperMode: boolean('paper_mode').default(true).notNull(),
  maxPositionPercent: doublePrecision('max_position_percent').default(5),
  maxOpenPositions: integer('max_open_positions').default(3),
  maxDailyLossPercent: doublePrecision('max_daily_loss_percent').default(3),
  maxDailyLossUsd: doublePrecision('max_daily_loss_usd').default(100),
  defaultSlPercent: doublePrecision('default_sl_percent').default(2),
  defaultTpPercent: doublePrecision('default_tp_percent').default(4),
  cooldownMinutes: integer('cooldown_minutes').default(5),
  maxLeverage: doublePrecision('max_leverage').default(2),
  allowedPairs: jsonb('allowed_pairs').default([]),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_risk_config_user').on(table.userId),
]);

// ---------------------------------------------------------------------------
// Persistent Memory tables (Cross-Session Memory — AGI 2026)
// ---------------------------------------------------------------------------

export const memoryEntries = pgTable('memory_entries', {
  id: text('id').primaryKey(),
  layer: varchar('layer', { length: 30 }).notNull(),         // execution, infrastructure, strategic, skill, error
  key: varchar('key', { length: 500 }).notNull(),
  value: text('value').notNull(),
  tags: jsonb('tags').default([]),
  impact: doublePrecision('impact').default(0.5),
  accessCount: integer('access_count').default(0),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastAccessed: timestamp('last_accessed').defaultNow().notNull(),
}, (table) => [
  index('idx_memory_layer').on(table.layer),
  index('idx_memory_impact').on(table.impact),
]);

export const failurePatterns = pgTable('failure_patterns', {
  id: uuid('id').primaryKey().defaultRandom(),
  errorType: varchar('error_type', { length: 200 }).notNull(),
  context: text('context').notNull(),
  count: integer('count').default(1).notNull(),
  resolution: text('resolution'),
  resolved: boolean('resolved').default(false).notNull(),
  lastSeen: timestamp('last_seen').defaultNow().notNull(),
}, (table) => [
  index('idx_failure_error_type').on(table.errorType),
  index('idx_failure_resolved').on(table.resolved),
]);

export const experienceRecords = pgTable('experience_records', {
  id: text('id').primaryKey(),
  taskType: varchar('task_type', { length: 100 }).notNull(),
  input: text('input').notNull(),
  output: text('output').notNull(),
  success: boolean('success').default(false).notNull(),
  agentUsed: varchar('agent_used', { length: 50 }).notNull(),
  toolsUsed: jsonb('tools_used').default([]),
  duration: integer('duration').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_experience_task_type').on(table.taskType),
  index('idx_experience_success').on(table.success),
]);

export const webCredentials = pgTable('web_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: varchar('username', { length: 100 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: varchar('role', { length: 20 }).default('user').notNull(),
  lastLogin: timestamp('last_login'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_web_credentials_username').on(table.username),
]);

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),
  action: varchar('action', { length: 100 }).notNull(),
  resource: varchar('resource', { length: 100 }),
  details: jsonb('details').default({}),
  ip: varchar('ip', { length: 50 }),
  platform: varchar('platform', { length: 20 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_audit_user').on(table.userId),
  index('idx_audit_action').on(table.action),
]);

export const commandCenterCenters = pgTable('command_center_centers', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id').references(() => users.id).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  code: varchar('code', { length: 60 }),
  description: text('description'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_command_center_centers_owner').on(table.ownerUserId),
  index('idx_command_center_centers_code').on(table.code),
]);

export const commandCenterDepartments = pgTable('command_center_departments', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id').references(() => users.id).notNull(),
  centerId: uuid('center_id').references(() => commandCenterCenters.id).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  code: varchar('code', { length: 60 }),
  description: text('description'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_command_center_departments_owner').on(table.ownerUserId),
  index('idx_command_center_departments_center').on(table.centerId),
]);

export const commandCenterMembers = pgTable('command_center_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id').references(() => users.id).notNull(),
  centerId: uuid('center_id').references(() => commandCenterCenters.id).notNull(),
  departmentId: uuid('department_id').references(() => commandCenterDepartments.id),
  displayName: varchar('display_name', { length: 120 }).notNull(),
  employeeCode: varchar('employee_code', { length: 60 }),
  roleTitle: varchar('role_title', { length: 120 }),
  employmentStatus: varchar('employment_status', { length: 30 }).default('active').notNull(),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_command_center_members_owner').on(table.ownerUserId),
  index('idx_command_center_members_center').on(table.centerId),
  index('idx_command_center_members_department').on(table.departmentId),
]);

export const commandCenterUserBindings = pgTable('command_center_user_bindings', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id').references(() => users.id).notNull(),
  webCredentialId: uuid('web_credential_id').references(() => webCredentials.id).notNull(),
  memberId: uuid('member_id').references(() => commandCenterMembers.id).notNull(),
  title: varchar('title', { length: 120 }),
  isPrimary: boolean('is_primary').default(true).notNull(),
  status: varchar('status', { length: 30 }).default('active').notNull(),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_command_center_user_bindings_owner').on(table.ownerUserId),
  uniqueIndex('uidx_command_center_user_bindings_web_credential').on(table.webCredentialId),
  uniqueIndex('uidx_command_center_user_bindings_member').on(table.memberId),
  index('idx_command_center_user_bindings_status').on(table.status),
]);

export const commandCenterSkillAssignments = pgTable('command_center_skill_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id').references(() => users.id).notNull(),
  skillId: varchar('skill_id', { length: 160 }).notNull(),
  skillName: varchar('skill_name', { length: 160 }).notNull(),
  scopeType: varchar('scope_type', { length: 30 }).notNull(),
  scopeId: uuid('scope_id').notNull(),
  proficiency: integer('proficiency').default(80).notNull(),
  priority: integer('priority').default(100).notNull(),
  isPrimary: boolean('is_primary').default(false).notNull(),
  status: varchar('status', { length: 30 }).default('active').notNull(),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_command_center_skill_assignments_owner').on(table.ownerUserId),
  index('idx_command_center_skill_assignments_skill').on(table.skillId),
  index('idx_command_center_skill_assignments_scope').on(table.scopeType, table.scopeId),
  index('idx_command_center_skill_assignments_status').on(table.status),
  uniqueIndex('uidx_command_center_skill_assignments_scope_skill').on(table.scopeType, table.scopeId, table.skillId),
]);

export const commandCenterTasks = pgTable('command_center_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id').references(() => users.id).notNull(),
  centerId: uuid('center_id').references(() => commandCenterCenters.id).notNull(),
  departmentId: uuid('department_id').references(() => commandCenterDepartments.id),
  assigneeMemberId: uuid('assignee_member_id').references(() => commandCenterMembers.id),
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description'),
  status: varchar('status', { length: 30 }).default('incoming').notNull(),
  priority: varchar('priority', { length: 20 }).default('medium').notNull(),
  source: varchar('source', { length: 40 }).default('manual').notNull(),
  requestedBy: varchar('requested_by', { length: 120 }),
  dueAt: timestamp('due_at'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  tags: jsonb('tags').default([]),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_command_center_tasks_owner').on(table.ownerUserId),
  index('idx_command_center_tasks_center').on(table.centerId),
  index('idx_command_center_tasks_department').on(table.departmentId),
  index('idx_command_center_tasks_assignee').on(table.assigneeMemberId),
  index('idx_command_center_tasks_status').on(table.status),
]);

export const commandCenterTaskRuns = pgTable('command_center_task_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id').references(() => users.id).notNull(),
  taskId: uuid('task_id').references(() => commandCenterTasks.id).notNull(),
  skillId: varchar('skill_id', { length: 160 }),
  skillName: varchar('skill_name', { length: 160 }),
  executorType: varchar('executor_type', { length: 30 }).default('member').notNull(),
  executorMemberId: uuid('executor_member_id').references(() => commandCenterMembers.id),
  status: varchar('status', { length: 30 }).default('pending').notNull(),
  inputSummary: text('input_summary'),
  outputSummary: text('output_summary'),
  artifacts: jsonb('artifacts').default([]).notNull(),
  metadata: jsonb('metadata').default({}),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_command_center_task_runs_owner').on(table.ownerUserId),
  index('idx_command_center_task_runs_task').on(table.taskId),
  index('idx_command_center_task_runs_skill').on(table.skillId),
  index('idx_command_center_task_runs_executor').on(table.executorMemberId),
  index('idx_command_center_task_runs_status').on(table.status),
]);

export const commandCenterTaskEvents = pgTable('command_center_task_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id').references(() => users.id).notNull(),
  taskId: uuid('task_id').references(() => commandCenterTasks.id).notNull(),
  eventType: varchar('event_type', { length: 40 }).notNull(),
  actorType: varchar('actor_type', { length: 30 }).default('user').notNull(),
  actorId: varchar('actor_id', { length: 120 }),
  content: text('content').notNull(),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_command_center_task_events_owner').on(table.ownerUserId),
  index('idx_command_center_task_events_task').on(table.taskId),
  index('idx_command_center_task_events_type').on(table.eventType),
]);

// ============================================================================
// Approval Gate System (Phase 2)
// ============================================================================

export const approvalGates = pgTable('approval_gates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  gateType: varchar('gate_type', { length: 40 }).notNull(), // skill_execution, high_cost_operation, destructive_action, external_api_call, custom
  description: text('description'),
  approverMemberIds: text('approver_member_ids').notNull(), // JSON array of member IDs
  autoApproveConditions: jsonb('auto_approve_conditions'), // { maxCost, trustedSkills, maxDuration }
  requireAllApprovers: integer('require_all_approvers').default(0).notNull(), // 0=any, 1=all
  timeoutHours: integer('timeout_hours').default(24).notNull(),
  enabled: integer('enabled').default(1).notNull(),
  centerId: uuid('center_id').references(() => commandCenterCenters.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_approval_gates_type').on(table.gateType),
  index('idx_approval_gates_center').on(table.centerId),
  index('idx_approval_gates_enabled').on(table.enabled),
]);

export const approvalRequests = pgTable('approval_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  gateId: uuid('gate_id').references(() => approvalGates.id).notNull(),
  taskId: uuid('task_id').references(() => commandCenterTasks.id).notNull(),
  requesterId: varchar('requester_id', { length: 120 }).notNull(),
  requesterMemberId: uuid('requester_member_id').references(() => commandCenterMembers.id),
  payload: jsonb('payload').notNull(), // { action, details, estimatedCost, estimatedDuration, skills }
  status: varchar('status', { length: 30 }).default('pending').notNull(), // pending, approved, rejected, expired, auto_approved
  decisions: jsonb('decisions').default([]).notNull(), // Array of { approverId, decision, comment, decidedAt }
  requestedAt: timestamp('requested_at').defaultNow().notNull(),
  decidedAt: timestamp('decided_at'),
  expiresAt: timestamp('expires_at').notNull(),
}, (table) => [
  index('idx_approval_requests_gate').on(table.gateId),
  index('idx_approval_requests_task').on(table.taskId),
  index('idx_approval_requests_status').on(table.status),
  index('idx_approval_requests_requester').on(table.requesterId),
  index('idx_approval_requests_expires').on(table.expiresAt),
]);

// Approval Gate System (Phase 2)
export const approvalGates = pgTable('approval_gates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  gateType: varchar('gate_type', { length: 40 }).notNull(), // skill_execution, high_cost_operation, destructive_action, external_api_call, custom
  description: text('description'),
  approverMemberIds: text('approver_member_ids').notNull(), // JSON array of member IDs
  autoApproveConditions: jsonb('auto_approve_conditions'), // { maxCost, trustedSkills, maxDuration }
  requireAllApprovers: integer('require_all_approvers').default(0).notNull(), // 0=any, 1=all
  timeoutHours: integer('timeout_hours').default(24).notNull(),
  enabled: integer('enabled').default(1).notNull(),
  centerId: uuid('center_id').references(() => commandCenterCenters.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_approval_gates_type').on(table.gateType),
  index('idx_approval_gates_center').on(table.centerId),
  index('idx_approval_gates_enabled').on(table.enabled),
]);

export const approvalRequests = pgTable('approval_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  gateId: uuid('gate_id').references(() => approvalGates.id).notNull(),
  taskId: uuid('task_id').references(() => commandCenterTasks.id).notNull(),
  requesterId: varchar('requester_id', { length: 120 }).notNull(),
  requesterMemberId: uuid('requester_member_id').references(() => commandCenterMembers.id),
  payload: jsonb('payload').notNull(), // { action, details, estimatedCost, estimatedDuration, skills }
  status: varchar('status', { length: 30 }).default('pending').notNull(), // pending, approved, rejected, expired, auto_approved
  decisions: text('decisions').default('[]').notNull(), // JSON array of { approverId, decision, comment, decidedAt }
  requestedAt: timestamp('requested_at').defaultNow().notNull(),
  decidedAt: timestamp('decided_at'),
  expiresAt: timestamp('expires_at').notNull(),
}, (table) => [
  index('idx_approval_requests_gate').on(table.gateId),
  index('idx_approval_requests_task').on(table.taskId),
  index('idx_approval_requests_status').on(table.status),
  index('idx_approval_requests_requester').on(table.requesterId),
  index('idx_approval_requests_expires').on(table.expiresAt),
]);

export type ApprovalGateType = 'skill_execution' | 'high_cost_operation' | 'destructive_action' | 'external_api_call' | 'custom';
export type ApprovalRequestStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'auto_approved';
