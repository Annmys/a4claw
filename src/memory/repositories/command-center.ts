import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { getDb } from '../database.js';
import {
  commandCenterCenters,
  commandCenterDepartments,
  commandCenterMembers,
  commandCenterSkillAssignments,
  commandCenterTaskEvents,
  commandCenterTaskRuns,
  commandCenterTasks,
  commandCenterUserBindings,
} from '../schema.js';
import logger from '../../utils/logger.js';

// ============================================================================
// Constants & Types
// ============================================================================

export const COMMAND_CENTER_TASK_STATUSES = [
  'incoming',
  'triage',
  'assigned',
  'in_progress',
  'review',
  'done',
  'blocked',
] as const;

export const COMMAND_CENTER_TASK_PRIORITIES = [
  'low',
  'medium',
  'high',
  'critical',
] as const;

export const COMMAND_CENTER_SKILL_SCOPE_TYPES = [
  'center',
  'department',
  'member',
] as const;

export const COMMAND_CENTER_TASK_RUN_STATUSES = [
  'pending',
  'ready',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;

export type CommandCenterTaskStatus = typeof COMMAND_CENTER_TASK_STATUSES[number];
export type CommandCenterTaskPriority = typeof COMMAND_CENTER_TASK_PRIORITIES[number];
export type CommandCenterSkillScopeType = typeof COMMAND_CENTER_SKILL_SCOPE_TYPES[number];
export type CommandCenterTaskRunStatus = typeof COMMAND_CENTER_TASK_RUN_STATUSES[number];

const SKILLS_DIR = join(process.cwd(), 'data', 'skills');
const MAX_TASKS_PER_PAGE = 100;
const CACHE_TTL_MS = 60000; // 1 minute cache

// ============================================================================
// Type Definitions
// ============================================================================

interface CommandCenterSkillCatalogItem {
  id: string;
  name: string;
  description: string;
  trigger: string;
  source: string;
  version: string;
}

interface CreateCenterData {
  name: string;
  code?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

interface CreateDepartmentData {
  centerId: string;
  name: string;
  code?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

interface CreateMemberData {
  centerId: string;
  departmentId?: string | null;
  displayName: string;
  employeeCode?: string;
  roleTitle?: string;
  employmentStatus?: string;
  metadata?: Record<string, unknown>;
}

interface CreateTaskData {
  centerId: string;
  departmentId?: string | null;
  assigneeMemberId?: string | null;
  title: string;
  description?: string;
  status?: CommandCenterTaskStatus;
  priority?: CommandCenterTaskPriority;
  source?: string;
  requestedBy?: string;
  dueAt?: Date | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

interface CreateTaskRunData {
  taskId: string;
  skillId?: string | null;
  executorType?: string;
  executorMemberId?: string | null;
  inputSummary?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Custom Errors
// ============================================================================

export class CommandCenterError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'CommandCenterError';
  }
}

export class CommandCenterBindingError extends CommandCenterError {
  constructor(
    code: 'member_not_found' | 'member_already_bound',
    message: string
  ) {
    super(message, code, 400);
    this.name = 'CommandCenterBindingError';
  }
}

export class ValidationError extends CommandCenterError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
  }
}

// ============================================================================
// Schema Cache
// ============================================================================

let ensurePromise: Promise<void> | null = null;
let schemaInitialized = false;

export async function ensureCommandCenterSchema(): Promise<void> {
  if (schemaInitialized) return;
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    const startTime = Date.now();
    const db = getDb();

    try {
      await db.execute(sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

      // Create tables with IF NOT EXISTS
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS command_center_centers (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name varchar(120) NOT NULL,
          code varchar(60),
          description text,
          metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
          created_at timestamp DEFAULT now() NOT NULL,
          updated_at timestamp DEFAULT now() NOT NULL
        )
      `);
      
      // Create indexes concurrently if possible
      await Promise.all([
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_centers_owner ON command_center_centers (owner_user_id)`),
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_centers_code ON command_center_centers (code)`),
      ]);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS command_center_departments (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          center_id uuid NOT NULL REFERENCES command_center_centers(id) ON DELETE CASCADE,
          name varchar(120) NOT NULL,
          code varchar(60),
          description text,
          metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
          created_at timestamp DEFAULT now() NOT NULL,
          updated_at timestamp DEFAULT now() NOT NULL
        )
      `);
      
      await Promise.all([
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_departments_owner ON command_center_departments (owner_user_id)`),
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_departments_center ON command_center_departments (center_id)`),
      ]);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS command_center_members (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          center_id uuid NOT NULL REFERENCES command_center_centers(id) ON DELETE CASCADE,
          department_id uuid REFERENCES command_center_departments(id) ON DELETE SET NULL,
          display_name varchar(120) NOT NULL,
          employee_code varchar(60),
          role_title varchar(120),
          employment_status varchar(30) DEFAULT 'active' NOT NULL,
          metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
          created_at timestamp DEFAULT now() NOT NULL,
          updated_at timestamp DEFAULT now() NOT NULL
        )
      `);
      
      await Promise.all([
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_members_owner ON command_center_members (owner_user_id)`),
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_members_center ON command_center_members (center_id)`),
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_members_department ON command_center_members (department_id)`),
      ]);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS command_center_user_bindings (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          web_credential_id uuid NOT NULL REFERENCES web_credentials(id) ON DELETE CASCADE,
          member_id uuid NOT NULL REFERENCES command_center_members(id) ON DELETE CASCADE,
          title varchar(120),
          is_primary boolean DEFAULT true NOT NULL,
          status varchar(30) DEFAULT 'active' NOT NULL,
          metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
          created_at timestamp DEFAULT now() NOT NULL,
          updated_at timestamp DEFAULT now() NOT NULL
        )
      `);
      
      await Promise.all([
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_user_bindings_owner ON command_center_user_bindings (owner_user_id)`),
        db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uidx_command_center_user_bindings_web_credential ON command_center_user_bindings (web_credential_id)`),
        db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uidx_command_center_user_bindings_member ON command_center_user_bindings (member_id)`),
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_user_bindings_status ON command_center_user_bindings (status)`),
      ]);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS command_center_skill_assignments (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          skill_id varchar(160) NOT NULL,
          skill_name varchar(160) NOT NULL,
          scope_type varchar(30) NOT NULL,
          scope_id uuid NOT NULL,
          proficiency integer DEFAULT 80 NOT NULL,
          priority integer DEFAULT 100 NOT NULL,
          is_primary boolean DEFAULT false NOT NULL,
          status varchar(30) DEFAULT 'active' NOT NULL,
          metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
          created_at timestamp DEFAULT now() NOT NULL,
          updated_at timestamp DEFAULT now() NOT NULL
        )
      `);
      
      await Promise.all([
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_skill_assignments_owner ON command_center_skill_assignments (owner_user_id)`),
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_skill_assignments_skill ON command_center_skill_assignments (skill_id)`),
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_skill_assignments_scope ON command_center_skill_assignments (scope_type, scope_id)`),
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_skill_assignments_status ON command_center_skill_assignments (status)`),
        db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uidx_command_center_skill_assignments_scope_skill ON command_center_skill_assignments (scope_type, scope_id, skill_id)`),
      ]);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS command_center_tasks (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          center_id uuid NOT NULL REFERENCES command_center_centers(id) ON DELETE CASCADE,
          department_id uuid REFERENCES command_center_departments(id) ON DELETE SET NULL,
          assignee_member_id uuid REFERENCES command_center_members(id) ON DELETE SET NULL,
          title varchar(200) NOT NULL,
          description text,
          status varchar(30) DEFAULT 'incoming' NOT NULL,
          priority varchar(20) DEFAULT 'medium' NOT NULL,
          source varchar(40) DEFAULT 'manual' NOT NULL,
          requested_by varchar(120),
          due_at timestamp,
          started_at timestamp,
          completed_at timestamp,
          tags jsonb DEFAULT '[]'::jsonb NOT NULL,
          metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
          created_at timestamp DEFAULT now() NOT NULL,
          updated_at timestamp DEFAULT now() NOT NULL
        )
      `);
      
      await Promise.all([
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_tasks_owner ON command_center_tasks (owner_user_id)`),
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_tasks_center ON command_center_tasks (center_id)`),
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_tasks_department ON command_center_tasks (department_id)`),
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_tasks_assignee ON command_center_tasks (assignee_member_id)`),
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_tasks_status ON command_center_tasks (status)`),
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_tasks_due_at ON command_center_tasks (due_at)`),
      ]);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS command_center_task_runs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          task_id uuid NOT NULL REFERENCES command_center_tasks(id) ON DELETE CASCADE,
          skill_id varchar(160),
          skill_name varchar(160),
          executor_type varchar(30) DEFAULT 'member' NOT NULL,
          executor_member_id uuid REFERENCES command_center_members(id) ON DELETE SET NULL,
          status varchar(30) DEFAULT 'pending' NOT NULL,
          input_summary text,
          output_summary text,
          artifacts jsonb DEFAULT '[]'::jsonb NOT NULL,
          metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
          started_at timestamp,
          completed_at timestamp,
          created_at timestamp DEFAULT now() NOT NULL,
          updated_at timestamp DEFAULT now() NOT NULL
        )
      `);
      
      await Promise.all([
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_task_runs_owner ON command_center_task_runs (owner_user_id)`),
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_task_runs_task ON command_center_task_runs (task_id)`),
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_task_runs_skill ON command_center_task_runs (skill_id)`),
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_task_runs_executor ON command_center_task_runs (executor_member_id)`),
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_task_runs_status ON command_center_task_runs (status)`),
      ]);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS command_center_task_events (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          task_id uuid NOT NULL REFERENCES command_center_tasks(id) ON DELETE CASCADE,
          event_type varchar(40) NOT NULL,
          actor_type varchar(30) DEFAULT 'user' NOT NULL,
          actor_id varchar(120),
          content text NOT NULL,
          metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
          created_at timestamp DEFAULT now() NOT NULL
        )
      `);
      
      await Promise.all([
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_task_events_owner ON command_center_task_events (owner_user_id)`),
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_task_events_task ON command_center_task_events (task_id)`),
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_task_events_type ON command_center_task_events (event_type)`),
        db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_task_events_created ON command_center_task_events (created_at)`),
      ]);

      schemaInitialized = true;
      logger.info('Command center schema ensured', { durationMs: Date.now() - startTime });
    } catch (error) {
      logger.error('Failed to ensure command center schema', { error });
      throw new CommandCenterError(
        'Failed to initialize database schema',
        'SCHEMA_INIT_FAILED',
        500
      );
    }
  })();

  return ensurePromise;
}

// ============================================================================
// Skill Catalog
// ============================================================================

let skillCatalogCache: CommandCenterSkillCatalogItem[] | null = null;
let skillCatalogCacheTime = 0;

function loadCommandCenterSkillCatalog(): CommandCenterSkillCatalogItem[] {
  const now = Date.now();
  if (skillCatalogCache && now - skillCatalogCacheTime < CACHE_TTL_MS) {
    return skillCatalogCache;
  }

  if (!existsSync(SKILLS_DIR)) {
    skillCatalogCache = [];
    skillCatalogCacheTime = now;
    return skillCatalogCache;
  }

  try {
    skillCatalogCache = readdirSync(SKILLS_DIR)
      .filter((file) => file.endsWith('.json'))
      .map((file) => {
        try {
          const raw = JSON.parse(readFileSync(join(SKILLS_DIR, file), 'utf-8')) as Record<string, unknown>;
          const id = typeof raw.id === 'string' ? raw.id : file.replace(/\.json$/i, '');
          const name = typeof raw.name === 'string' ? raw.name : id;
          return {
            id,
            name,
            description: typeof raw.description === 'string' ? raw.description : '',
            trigger: typeof raw.trigger === 'string' ? raw.trigger : '',
            source: typeof raw.source === 'string' ? raw.source : 'unknown',
            version: String(raw.version ?? '1'),
          };
        } catch (err) {
          logger.warn('Failed to parse skill file', { file, error: err });
          return null;
        }
      })
      .filter((item): item is CommandCenterSkillCatalogItem => item !== null)
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    
    skillCatalogCacheTime = now;
  } catch (error) {
    logger.error('Failed to load skill catalog', { error });
    skillCatalogCache = [];
  }

  return skillCatalogCache;
}

// ============================================================================
// Validation Helpers
// ============================================================================

function validateNonEmptyString(value: string, fieldName: string, maxLength?: number): void {
  if (!value || typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${fieldName} is required`);
  }
  if (maxLength && value.length > maxLength) {
    throw new ValidationError(`${fieldName} must be less than ${maxLength} characters`);
  }
}

function validateUUID(value: string, fieldName: string): void {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(value)) {
    throw new ValidationError(`${fieldName} must be a valid UUID`);
  }
}

function sanitizeString(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, maxLength);
}

// ============================================================================
// Center Operations
// ============================================================================

export async function createCommandCenterCenter(
  ownerUserId: string,
  data: CreateCenterData
) {
  try {
    validateNonEmptyString(data.name, 'name', 120);
    if (data.code) validateNonEmptyString(data.code, 'code', 60);

    await ensureCommandCenterSchema();
    const db = getDb();
    
    const [center] = await db.insert(commandCenterCenters).values({
      ownerUserId,
      name: data.name.trim(),
      code: sanitizeString(data.code, 60),
      description: sanitizeString(data.description, 2000),
      metadata: data.metadata ?? {},
      updatedAt: new Date(),
    }).returning();

    logger.info('Center created', { centerId: center.id, ownerUserId });
    return center;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    logger.error('Failed to create center', { error, ownerUserId });
    throw new CommandCenterError('Failed to create center', 'CREATE_CENTER_FAILED', 500);
  }
}

// ============================================================================
// Department Operations
// ============================================================================

export async function createCommandCenterDepartment(
  ownerUserId: string,
  data: CreateDepartmentData
) {
  try {
    validateNonEmptyString(data.name, 'name', 120);
    validateUUID(data.centerId, 'centerId');

    await ensureCommandCenterSchema();
    const db = getDb();

    // Verify center exists and belongs to owner
    const [center] = await db.select()
      .from(commandCenterCenters)
      .where(and(
        eq(commandCenterCenters.id, data.centerId),
        eq(commandCenterCenters.ownerUserId, ownerUserId)
      ))
      .limit(1);

    if (!center) {
      throw new CommandCenterError('Center not found', 'CENTER_NOT_FOUND', 404);
    }

    const [department] = await db.insert(commandCenterDepartments).values({
      ownerUserId,
      centerId: data.centerId,
      name: data.name.trim(),
      code: sanitizeString(data.code, 60),
      description: sanitizeString(data.description, 2000),
      metadata: data.metadata ?? {},
      updatedAt: new Date(),
    }).returning();

    logger.info('Department created', { departmentId: department.id, centerId: data.centerId });
    return department;
  } catch (error) {
    if (error instanceof CommandCenterError) throw error;
    logger.error('Failed to create department', { error, ownerUserId });
    throw new CommandCenterError('Failed to create department', 'CREATE_DEPARTMENT_FAILED', 500);
  }
}

// ============================================================================
// Member Operations
// ============================================================================

export async function createCommandCenterMember(
  ownerUserId: string,
  data: CreateMemberData
) {
  try {
    validateNonEmptyString(data.displayName, 'displayName', 120);
    validateUUID(data.centerId, 'centerId');

    await ensureCommandCenterSchema();
    const db = getDb();

    // Verify center exists
    const [center] = await db.select()
      .from(commandCenterCenters)
      .where(and(
        eq(commandCenterCenters.id, data.centerId),
        eq(commandCenterCenters.ownerUserId, ownerUserId)
      ))
      .limit(1);

    if (!center) {
      throw new CommandCenterError('Center not found', 'CENTER_NOT_FOUND', 404);
    }

    // Verify department if provided
    if (data.departmentId) {
      const [dept] = await db.select()
        .from(commandCenterDepartments)
        .where(and(
          eq(commandCenterDepartments.id, data.departmentId),
          eq(commandCenterDepartments.ownerUserId, ownerUserId)
        ))
        .limit(1);

      if (!dept) {
        throw new CommandCenterError('Department not found', 'DEPARTMENT_NOT_FOUND', 404);
      }
    }

    const [member] = await db.insert(commandCenterMembers).values({
      ownerUserId,
      centerId: data.centerId,
      departmentId: data.departmentId ?? null,
      displayName: data.displayName.trim(),
      employeeCode: sanitizeString(data.employeeCode, 60),
      roleTitle: sanitizeString(data.roleTitle, 120),
      employmentStatus: data.employmentStatus ?? 'active',
      metadata: data.metadata ?? {},
      updatedAt: new Date(),
    }).returning();

    logger.info('Member created', { memberId: member.id, centerId: data.centerId });
    return member;
  } catch (error) {
    if (error instanceof CommandCenterError) throw error;
    logger.error('Failed to create member', { error, ownerUserId });
    throw new CommandCenterError('Failed to create member', 'CREATE_MEMBER_FAILED', 500);
  }
}

// ============================================================================
// Organization Query Operations
// ============================================================================

export async function listCommandCenterOrgOptions(ownerUserId: string) {
  await ensureCommandCenterSchema();
  const db = getDb();

  try {
    const [centers, departments, members] = await Promise.all([
      db.select()
        .from(commandCenterCenters)
        .where(eq(commandCenterCenters.ownerUserId, ownerUserId))
        .orderBy(asc(commandCenterCenters.createdAt)),
      db.select()
        .from(commandCenterDepartments)
        .where(eq(commandCenterDepartments.ownerUserId, ownerUserId))
        .orderBy(asc(commandCenterDepartments.createdAt)),
      db.select()
        .from(commandCenterMembers)
        .where(eq(commandCenterMembers.ownerUserId, ownerUserId))
        .orderBy(asc(commandCenterMembers.createdAt)),
    ]);

    return { centers, departments, members };
  } catch (error) {
    logger.error('Failed to list org options', { error, ownerUserId });
    throw new CommandCenterError('Failed to fetch organization data', 'FETCH_ORG_FAILED', 500);
  }
}

export async function listCommandCenterUserBindings(ownerUserId: string) {
  await ensureCommandCenterSchema();
  const db = getDb();

  try {
    return db.select({
      id: commandCenterUserBindings.id,
      ownerUserId: commandCenterUserBindings.ownerUserId,
      webCredentialId: commandCenterUserBindings.webCredentialId,
      memberId: commandCenterUserBindings.memberId,
      title: commandCenterUserBindings.title,
      status: commandCenterUserBindings.status,
      isPrimary: commandCenterUserBindings.isPrimary,
      metadata: commandCenterUserBindings.metadata,
      createdAt: commandCenterUserBindings.createdAt,
      updatedAt: commandCenterUserBindings.updatedAt,
      memberName: commandCenterMembers.displayName,
      memberRoleTitle: commandCenterMembers.roleTitle,
      departmentId: commandCenterDepartments.id,
      departmentName: commandCenterDepartments.name,
      centerId: commandCenterCenters.id,
      centerName: commandCenterCenters.name,
    })
    .from(commandCenterUserBindings)
    .innerJoin(commandCenterMembers, eq(commandCenterUserBindings.memberId, commandCenterMembers.id))
    .leftJoin(commandCenterDepartments, eq(commandCenterMembers.departmentId, commandCenterDepartments.id))
    .innerJoin(commandCenterCenters, eq(commandCenterMembers.centerId, commandCenterCenters.id))
    .where(eq(commandCenterUserBindings.ownerUserId, ownerUserId))
    .orderBy(
      asc(commandCenterCenters.createdAt),
      asc(commandCenterMembers.createdAt)
    );
  } catch (error) {
    logger.error('Failed to list user bindings', { error, ownerUserId });
    throw new CommandCenterError('Failed to fetch user bindings', 'FETCH_BINDINGS_FAILED', 500);
  }
}

export async function getCommandCenterUserBindingByWebCredential(
  ownerUserId: string,
  webCredentialId: string
) {
  try {
    validateUUID(webCredentialId, 'webCredentialId');
    const bindings = await listCommandCenterUserBindings(ownerUserId);
    return bindings.find((binding) => binding.webCredentialId === webCredentialId) ?? null;
  } catch (error) {
    logger.error('Failed to get binding by web credential', { error, ownerUserId, webCredentialId });
    return null;
  }
}

// ============================================================================
// Skill Assignment Operations
// ============================================================================

async function validateScopeExists(
  ownerUserId: string,
  scopeType: CommandCenterSkillScopeType,
  scopeId: string,
) {
  const db = getDb();

  const validators: Record<CommandCenterSkillScopeType, () => Promise<boolean>> = {
    center: async () => {
      const [entity] = await db.select()
        .from(commandCenterCenters)
        .where(and(
          eq(commandCenterCenters.id, scopeId),
          eq(commandCenterCenters.ownerUserId, ownerUserId),
        ))
        .limit(1);
      return !!entity;
    },
    department: async () => {
      const [entity] = await db.select()
        .from(commandCenterDepartments)
        .where(and(
          eq(commandCenterDepartments.id, scopeId),
          eq(commandCenterDepartments.ownerUserId, ownerUserId),
        ))
        .limit(1);
      return !!entity;
    },
    member: async () => {
      const [entity] = await db.select()
        .from(commandCenterMembers)
        .where(and(
          eq(commandCenterMembers.id, scopeId),
          eq(commandCenterMembers.ownerUserId, ownerUserId),
        ))
        .limit(1);
      return !!entity;
    },
  };

  return validators[scopeType]();
}

export async function listCommandCenterSkillAssignments(ownerUserId: string) {
  await ensureCommandCenterSchema();
  const db = getDb();

  try {
    const [assignments, centers, departments, members] = await Promise.all([
      db.select()
        .from(commandCenterSkillAssignments)
        .where(eq(commandCenterSkillAssignments.ownerUserId, ownerUserId))
        .orderBy(
          asc(commandCenterSkillAssignments.scopeType),
          asc(commandCenterSkillAssignments.skillName)
        ),
      db.select()
        .from(commandCenterCenters)
        .where(eq(commandCenterCenters.ownerUserId, ownerUserId)),
      db.select()
        .from(commandCenterDepartments)
        .where(eq(commandCenterDepartments.ownerUserId, ownerUserId)),
      db.select()
        .from(commandCenterMembers)
        .where(eq(commandCenterMembers.ownerUserId, ownerUserId)),
    ]);

    const centerMap = new Map(centers.map((item) => [item.id, item]));
    const departmentMap = new Map(departments.map((item) => [item.id, item]));
    const memberMap = new Map(members.map((item) => [item.id, item]));

    return assignments.map((assignment) => {
      let scopeName = assignment.scopeId;
      let centerId: string | null = null;
      let centerName: string | null = null;
      let departmentId: string | null = null;
      let departmentName: string | null = null;
      let memberId: string | null = null;
      let memberName: string | null = null;

      if (assignment.scopeType === 'center') {
        const center = centerMap.get(assignment.scopeId);
        scopeName = center?.name ?? scopeName;
        centerId = center?.id ?? null;
        centerName = center?.name ?? null;
      } else if (assignment.scopeType === 'department') {
        const department = departmentMap.get(assignment.scopeId);
        const center = department ? centerMap.get(department.centerId) : null;
        scopeName = department?.name ?? scopeName;
        centerId = center?.id ?? null;
        centerName = center?.name ?? null;
        departmentId = department?.id ?? null;
        departmentName = department?.name ?? null;
      } else {
        const member = memberMap.get(assignment.scopeId);
        const center = member ? centerMap.get(member.centerId) : null;
        const department = member?.departmentId ? departmentMap.get(member.departmentId) : null;
        scopeName = member?.displayName ?? scopeName;
        centerId = center?.id ?? null;
        centerName = center?.name ?? null;
        departmentId = department?.id ?? null;
        departmentName = department?.name ?? null;
        memberId = member?.id ?? null;
        memberName = member?.displayName ?? null;
      }

      return {
        ...assignment,
        scopeName,
        centerId,
        centerName,
        departmentId,
        departmentName,
        memberId,
        memberName,
      };
    });
  } catch (error) {
    logger.error('Failed to list skill assignments', { error, ownerUserId });
    throw new CommandCenterError('Failed to fetch skill assignments', 'FETCH_ASSIGNMENTS_FAILED', 500);
  }
}

export async function getCommandCenterActorContext(ownerUserId: string, webCredentialId: string) {
  try {
    const binding = await getCommandCenterUserBindingByWebCredential(ownerUserId, webCredentialId);
    if (!binding) {
      return { binding: null, skillAssignments: [] };
    }

    const allAssignments = await listCommandCenterSkillAssignments(ownerUserId);
    const scopedAssignments = allAssignments
      .filter((assignment) => {
        if (assignment.scopeType === 'member') {
          return assignment.memberId === binding.memberId;
        }
        if (assignment.scopeType === 'department') {
          return Boolean(binding.departmentId) && assignment.departmentId === binding.departmentId;
        }
        return assignment.centerId === binding.centerId;
      })
      .sort((a, b) => {
        const scopeWeight: Record<CommandCenterSkillScopeType, number> = { 
          member: 3, 
          department: 2, 
          center: 1 
        };
        const weightDiff = scopeWeight[b.scopeType as CommandCenterSkillScopeType] - 
                          scopeWeight[a.scopeType as CommandCenterSkillScopeType];
        if (weightDiff !== 0) return weightDiff;
        const primaryDiff = Number(Boolean(b.isPrimary)) - Number(Boolean(a.isPrimary));
        if (primaryDiff !== 0) return primaryDiff;
        return (b.priority ?? 0) - (a.priority ?? 0);
      });

    return { binding, skillAssignments: scopedAssignments };
  } catch (error) {
    logger.error('Failed to get actor context', { error, ownerUserId, webCredentialId });
    return { binding: null, skillAssignments: [] };
  }
}

export async function upsertCommandCenterSkillAssignment(
  ownerUserId: string,
  data: {
    skillId: string;
    scopeType: CommandCenterSkillScopeType;
    scopeId: string;
    proficiency?: number;
    priority?: number;
    isPrimary?: boolean;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    validateNonEmptyString(data.skillId, 'skillId', 160);
    validateUUID(data.scopeId, 'scopeId');

    await ensureCommandCenterSchema();
    const db = getDb();

    const scopeExists = await validateScopeExists(ownerUserId, data.scopeType, data.scopeId);
    if (!scopeExists) {
      throw new CommandCenterError('Selected scope not found', 'SCOPE_NOT_FOUND', 404);
    }

    const skillCatalog = loadCommandCenterSkillCatalog();
    const skill = skillCatalog.find((item) => item.id === data.skillId);
    const skillName = skill?.name ?? data.skillId;
    const proficiency = Math.max(0, Math.min(100, Math.trunc(data.proficiency ?? 80)));
    const priority = Math.max(1, Math.min(999, Math.trunc(data.priority ?? 100)));
    const now = new Date();

    return db.transaction(async (tx) => {
      if (data.isPrimary) {
        await tx.update(commandCenterSkillAssignments)
          .set({ isPrimary: false, updatedAt: now })
          .where(and(
            eq(commandCenterSkillAssignments.ownerUserId, ownerUserId),
            eq(commandCenterSkillAssignments.scopeType, data.scopeType),
            eq(commandCenterSkillAssignments.scopeId, data.scopeId),
          ));
      }

      const [existing] = await tx.select()
        .from(commandCenterSkillAssignments)
        .where(and(
          eq(commandCenterSkillAssignments.ownerUserId, ownerUserId),
          eq(commandCenterSkillAssignments.scopeType, data.scopeType),
          eq(commandCenterSkillAssignments.scopeId, data.scopeId),
          eq(commandCenterSkillAssignments.skillId, data.skillId),
        ))
        .limit(1);

      if (existing) {
        const [assignment] = await tx.update(commandCenterSkillAssignments)
          .set({
            skillName,
            proficiency,
            priority,
            isPrimary: Boolean(data.isPrimary),
            status: 'active',
            metadata: data.metadata ?? existing.metadata ?? {},
            updatedAt: now,
          })
          .where(eq(commandCenterSkillAssignments.id, existing.id))
          .returning();
        
        logger.info('Skill assignment updated', { assignmentId: assignment.id });
        return assignment;
      }

      const [assignment] = await tx.insert(commandCenterSkillAssignments).values({
        ownerUserId,
        skillId: data.skillId,
        skillName,
        scopeType: data.scopeType,
        scopeId: data.scopeId,
        proficiency,
        priority,
        isPrimary: Boolean(data.isPrimary),
        status: 'active',
        metadata: data.metadata ?? {},
        createdAt: now,
        updatedAt: now,
      }).returning();

      logger.info('Skill assignment created', { assignmentId: assignment.id });
      return assignment;
    });
  } catch (error) {
    if (error instanceof CommandCenterError) throw error;
    logger.error('Failed to upsert skill assignment', { error, ownerUserId });
    throw new CommandCenterError('Failed to save skill assignment', 'UPSERT_ASSIGNMENT_FAILED', 500);
  }
}

export async function removeCommandCenterSkillAssignment(ownerUserId: string, assignmentId: string) {
  try {
    validateUUID(assignmentId, 'assignmentId');
    await ensureCommandCenterSchema();
    const db = getDb();

    const [assignment] = await db.delete(commandCenterSkillAssignments)
      .where(and(
        eq(commandCenterSkillAssignments.ownerUserId, ownerUserId),
        eq(commandCenterSkillAssignments.id, assignmentId),
      ))
      .returning();

    if (assignment) {
      logger.info('Skill assignment removed', { assignmentId });
    }

    return assignment ?? null;
  } catch (error) {
    logger.error('Failed to remove skill assignment', { error, ownerUserId, assignmentId });
    throw new CommandCenterError('Failed to remove skill assignment', 'REMOVE_ASSIGNMENT_FAILED', 500);
  }
}

// ============================================================================
// User Binding Operations
// ============================================================================

export async function upsertCommandCenterUserBinding(
  ownerUserId: string,
  data: {
    webCredentialId: string;
    memberId: string;
    title?: string;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    validateUUID(data.webCredentialId, 'webCredentialId');
    validateUUID(data.memberId, 'memberId');

    await ensureCommandCenterSchema();
    const db = getDb();

    return db.transaction(async (tx) => {
      const [member] = await tx.select()
        .from(commandCenterMembers)
        .where(and(
          eq(commandCenterMembers.id, data.memberId),
          eq(commandCenterMembers.ownerUserId, ownerUserId),
        ))
        .limit(1);

      if (!member) {
        throw new CommandCenterBindingError('member_not_found', 'Selected member not found');
      }

      const [memberBinding] = await tx.select()
        .from(commandCenterUserBindings)
        .where(and(
          eq(commandCenterUserBindings.ownerUserId, ownerUserId),
          eq(commandCenterUserBindings.memberId, data.memberId),
        ))
        .limit(1);

      if (memberBinding && memberBinding.webCredentialId !== data.webCredentialId) {
        throw new CommandCenterBindingError(
          'member_already_bound',
          'Selected member is already bound to another account'
        );
      }

      const [existing] = await tx.select()
        .from(commandCenterUserBindings)
        .where(and(
          eq(commandCenterUserBindings.ownerUserId, ownerUserId),
          eq(commandCenterUserBindings.webCredentialId, data.webCredentialId),
        ))
        .limit(1);

      const now = new Date();
      const title = data.title?.trim() || member.roleTitle || null;

      if (existing) {
        const [binding] = await tx.update(commandCenterUserBindings)
          .set({
            memberId: data.memberId,
            title,
            status: 'active',
            isPrimary: true,
            metadata: data.metadata ?? existing.metadata ?? {},
            updatedAt: now,
          })
          .where(eq(commandCenterUserBindings.id, existing.id))
          .returning();
        
        logger.info('User binding updated', { bindingId: binding.id });
        return binding;
      }

      const [binding] = await tx.insert(commandCenterUserBindings).values({
        ownerUserId,
        webCredentialId: data.webCredentialId,
        memberId: data.memberId,
        title,
        isPrimary: true,
        status: 'active',
        metadata: data.metadata ?? {},
        createdAt: now,
        updatedAt: now,
      }).returning();

      logger.info('User binding created', { bindingId: binding.id });
      return binding;
    });
  } catch (error) {
    if (error instanceof CommandCenterBindingError) throw error;
    logger.error('Failed to upsert user binding', { error, ownerUserId });
    throw new CommandCenterError('Failed to save user binding', 'UPSERT_BINDING_FAILED', 500);
  }
}

export async function removeCommandCenterUserBinding(ownerUserId: string, webCredentialId: string) {
  try {
    validateUUID(webCredentialId, 'webCredentialId');
    await ensureCommandCenterSchema();
    const db = getDb();

    const [binding] = await db.delete(commandCenterUserBindings)
      .where(and(
        eq(commandCenterUserBindings.ownerUserId, ownerUserId),
        eq(commandCenterUserBindings.webCredentialId, webCredentialId),
      ))
      .returning();

    if (binding) {
      logger.info('User binding removed', { bindingId: binding.id });
    }

    return binding ?? null;
  } catch (error) {
    logger.error('Failed to remove user binding', { error, ownerUserId, webCredentialId });
    throw new CommandCenterError('Failed to remove user binding', 'REMOVE_BINDING_FAILED', 500);
  }
}

// ============================================================================
// Task Run Operations
// ============================================================================

export async function listCommandCenterTaskRuns(
  ownerUserId: string,
  taskId?: string,
  options?: { page?: number; pageSize?: number }
) {
  try {
    await ensureCommandCenterSchema();
    const db = getDb();

    const page = Math.max(1, options?.page ?? 1);
    const pageSize = Math.min(MAX_TASKS_PER_PAGE, Math.max(1, options?.pageSize ?? 50));
    const offset = (page - 1) * pageSize;

    let whereClause: SQL | undefined = eq(commandCenterTaskRuns.ownerUserId, ownerUserId);
    
    if (taskId) {
      validateUUID(taskId, 'taskId');
      whereClause = and(whereClause, eq(commandCenterTaskRuns.taskId, taskId));
    }

    const [runs, countResult] = await Promise.all([
      db.select({
        id: commandCenterTaskRuns.id,
        ownerUserId: commandCenterTaskRuns.ownerUserId,
        taskId: commandCenterTaskRuns.taskId,
        skillId: commandCenterTaskRuns.skillId,
        skillName: commandCenterTaskRuns.skillName,
        executorType: commandCenterTaskRuns.executorType,
        executorMemberId: commandCenterTaskRuns.executorMemberId,
        status: commandCenterTaskRuns.status,
        inputSummary: commandCenterTaskRuns.inputSummary,
        outputSummary: commandCenterTaskRuns.outputSummary,
        artifacts: commandCenterTaskRuns.artifacts,
        metadata: commandCenterTaskRuns.metadata,
        startedAt: commandCenterTaskRuns.startedAt,
        completedAt: commandCenterTaskRuns.completedAt,
        createdAt: commandCenterTaskRuns.createdAt,
        updatedAt: commandCenterTaskRuns.updatedAt,
        executorMemberName: commandCenterMembers.displayName,
      })
      .from(commandCenterTaskRuns)
      .leftJoin(commandCenterMembers, eq(commandCenterTaskRuns.executorMemberId, commandCenterMembers.id))
      .where(whereClause)
      .orderBy(desc(commandCenterTaskRuns.createdAt))
      .limit(pageSize)
      .offset(offset),
      
      db.select({ count: sql<number>`count(*)` })
        .from(commandCenterTaskRuns)
        .where(whereClause),
    ]);

    return {
      runs,
      pagination: {
        page,
        pageSize,
        total: countResult[0]?.count ?? 0,
        totalPages: Math.ceil((countResult[0]?.count ?? 0) / pageSize),
      },
    };
  } catch (error) {
    logger.error('Failed to list task runs', { error, ownerUserId, taskId });
    throw new CommandCenterError('Failed to fetch task runs', 'FETCH_RUNS_FAILED', 500);
  }
}

export async function createCommandCenterTaskRun(
  ownerUserId: string,
  actorId: string,
  data: CreateTaskRunData,
) {
  try {
    validateUUID(data.taskId, 'taskId');
    if (data.executorMemberId) validateUUID(data.executorMemberId, 'executorMemberId');

    await ensureCommandCenterSchema();
    const db = getDb();

    return db.transaction(async (tx) => {
      const [task] = await tx.select()
        .from(commandCenterTasks)
        .where(and(
          eq(commandCenterTasks.id, data.taskId),
          eq(commandCenterTasks.ownerUserId, ownerUserId),
        ))
        .limit(1);

      if (!task) {
        throw new CommandCenterError('Task not found', 'TASK_NOT_FOUND', 404);
      }

      let executorMember: typeof commandCenterMembers.$inferSelect | null = null;
      if (data.executorMemberId) {
        const [member] = await tx.select()
          .from(commandCenterMembers)
          .where(and(
            eq(commandCenterMembers.id, data.executorMemberId),
            eq(commandCenterMembers.ownerUserId, ownerUserId),
          ))
          .limit(1);
        if (!member) {
          throw new CommandCenterError('Executor member not found', 'MEMBER_NOT_FOUND', 404);
        }
        executorMember = member;
      }

      const skillCatalog = loadCommandCenterSkillCatalog();
      const skill = data.skillId ? skillCatalog.find((item) => item.id === data.skillId) : null;
      const now = new Date();

      const [run] = await tx.insert(commandCenterTaskRuns).values({
        ownerUserId,
        taskId: task.id,
        skillId: data.skillId ?? null,
        skillName: skill?.name ?? data.skillId ?? null,
        executorType: data.executorType ?? 'member',
        executorMemberId: executorMember?.id ?? null,
        status: 'pending',
        inputSummary: data.inputSummary?.trim() || null,
        metadata: data.metadata ?? {},
        artifacts: [],
        createdAt: now,
        updatedAt: now,
      }).returning();

      const nextTaskStatus = task.status === 'incoming' || task.status === 'triage' 
        ? 'assigned' 
        : task.status;
        
      if (nextTaskStatus !== task.status) {
        await tx.update(commandCenterTasks)
          .set({
            status: nextTaskStatus,
            assigneeMemberId: executorMember?.id ?? task.assigneeMemberId,
            updatedAt: now,
          })
          .where(eq(commandCenterTasks.id, task.id));
      } else if (executorMember?.id && task.assigneeMemberId !== executorMember.id) {
        await tx.update(commandCenterTasks)
          .set({ assigneeMemberId: executorMember.id, updatedAt: now })
          .where(eq(commandCenterTasks.id, task.id));
      }

      await tx.insert(commandCenterTaskEvents).values({
        ownerUserId,
        taskId: task.id,
        eventType: 'run_created',
        actorType: 'user',
        actorId,
        content: [
          '创建执行单',
          skill?.name ? `技能：${skill.name}` : null,
          executorMember?.displayName ? `执行人：${executorMember.displayName}` : null,
        ].filter(Boolean).join('，'),
        metadata: { runId: run.id, skillId: run.skillId, executorMemberId: run.executorMemberId },
      });

      logger.info('Task run created', { runId: run.id, taskId: task.id });
      return run;
    });
  } catch (error) {
    if (error instanceof CommandCenterError) throw error;
    logger.error('Failed to create task run', { error, ownerUserId });
    throw new CommandCenterError('Failed to create task run', 'CREATE_RUN_FAILED', 500);
  }
}

export async function updateCommandCenterTaskRunStatus(
  ownerUserId: string,
  runId: string,
  data: {
    status: CommandCenterTaskRunStatus;
    actorId: string;
    outputSummary?: string;
    artifacts?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    validateUUID(runId, 'runId');
    if (!COMMAND_CENTER_TASK_RUN_STATUSES.includes(data.status)) {
      throw new ValidationError(`Invalid status: ${data.status}`);
    }

    await ensureCommandCenterSchema();
    const db = getDb();

    return db.transaction(async (tx) => {
      const [existing] = await tx.select()
        .from(commandCenterTaskRuns)
        .where(and(
          eq(commandCenterTaskRuns.id, runId),
          eq(commandCenterTaskRuns.ownerUserId, ownerUserId),
        ))
        .limit(1);

      if (!existing) {
        throw new CommandCenterError('Task run not found', 'RUN_NOT_FOUND', 404);
      }

      const [task] = await tx.select()
        .from(commandCenterTasks)
        .where(and(
          eq(commandCenterTasks.id, existing.taskId),
          eq(commandCenterTasks.ownerUserId, ownerUserId),
        ))
        .limit(1);
        
      if (!task) {
        throw new CommandCenterError('Task not found', 'TASK_NOT_FOUND', 404);
      }

      const now = new Date();
      const [run] = await tx.update(commandCenterTaskRuns)
        .set({
          status: data.status,
          outputSummary: data.outputSummary?.trim() || existing.outputSummary,
          artifacts: data.artifacts ?? existing.artifacts ?? [],
          metadata: data.metadata ? { ...(existing.metadata ?? {}), ...data.metadata } : (existing.metadata ?? {}),
          startedAt: data.status === 'running' && !existing.startedAt ? now : existing.startedAt,
          completedAt: ['succeeded', 'failed', 'cancelled'].includes(data.status) ? now : null,
          updatedAt: now,
        })
        .where(eq(commandCenterTaskRuns.id, existing.id))
        .returning();

      let nextTaskStatus = task.status;
      if (data.status === 'running') nextTaskStatus = 'in_progress';
      if (data.status === 'succeeded') nextTaskStatus = 'review';
      if (data.status === 'failed') nextTaskStatus = 'blocked';

      if (nextTaskStatus !== task.status) {
        await tx.update(commandCenterTasks)
          .set({
            status: nextTaskStatus,
            startedAt: nextTaskStatus === 'in_progress' && !task.startedAt ? now : task.startedAt,
            updatedAt: now,
          })
          .where(eq(commandCenterTasks.id, task.id));
      }

      await tx.insert(commandCenterTaskEvents).values({
        ownerUserId,
        taskId: task.id,
        eventType: 'run_status_changed',
        actorType: 'user',
        actorId: data.actorId,
        content: data.outputSummary?.trim()
          ? `执行单状态变更为 ${data.status}：${data.outputSummary.trim()}`
          : `执行单状态变更为 ${data.status}`,
        metadata: { runId: run.id, fromStatus: existing.status, toStatus: data.status },
      });

      logger.info('Task run status updated', { runId, status: data.status });
      return run;
    });
  } catch (error) {
    if (error instanceof CommandCenterError) throw error;
    logger.error('Failed to update task run status', { error, ownerUserId, runId });
    throw new CommandCenterError('Failed to update task run status', 'UPDATE_RUN_FAILED', 500);
  }
}

// ============================================================================
// Task Operations
// ============================================================================

export async function createCommandCenterTask(
  ownerUserId: string,
  actorId: string,
  data: CreateTaskData,
) {
  try {
    validateNonEmptyString(data.title, 'title', 200);
    validateUUID(data.centerId, 'centerId');
    
    if (data.priority && !COMMAND_CENTER_TASK_PRIORITIES.includes(data.priority)) {
      throw new ValidationError(`Invalid priority: ${data.priority}`);
    }
    if (data.status && !COMMAND_CENTER_TASK_STATUSES.includes(data.status)) {
      throw new ValidationError(`Invalid status: ${data.status}`);
    }

    await ensureCommandCenterSchema();
    const db = getDb();

    return db.transaction(async (tx) => {
      const [center] = await tx.select()
        .from(commandCenterCenters)
        .where(and(
          eq(commandCenterCenters.id, data.centerId),
          eq(commandCenterCenters.ownerUserId, ownerUserId),
        ))
        .limit(1);
        
      if (!center) {
        throw new CommandCenterError('Center not found', 'CENTER_NOT_FOUND', 404);
      }

      let departmentId: string | null = data.departmentId ?? null;
      if (departmentId) {
        const [department] = await tx.select()
          .from(commandCenterDepartments)
          .where(and(
            eq(commandCenterDepartments.id, departmentId),
            eq(commandCenterDepartments.ownerUserId, ownerUserId),
          ))
          .limit(1);
          
        if (!department) {
          throw new CommandCenterError('Department not found', 'DEPARTMENT_NOT_FOUND', 404);
        }
        if (department.centerId !== center.id) {
          throw new CommandCenterError('Department does not belong to center', 'INVALID_DEPARTMENT', 400);
        }
      }

      let assigneeMemberId: string | null = data.assigneeMemberId ?? null;
      if (assigneeMemberId) {
        const [member] = await tx.select()
          .from(commandCenterMembers)
          .where(and(
            eq(commandCenterMembers.id, assigneeMemberId),
            eq(commandCenterMembers.ownerUserId, ownerUserId),
          ))
          .limit(1);
          
        if (!member) {
          throw new CommandCenterError('Member not found', 'MEMBER_NOT_FOUND', 404);
        }
        if (member.centerId !== center.id) {
          throw new CommandCenterError('Member does not belong to center', 'INVALID_MEMBER', 400);
        }
        if (departmentId && member.departmentId !== departmentId) {
          throw new CommandCenterError('Member does not belong to department', 'INVALID_MEMBER_DEPT', 400);
        }
        if (!departmentId && member.departmentId) {
          departmentId = member.departmentId;
        }
      }

      const [task] = await tx.insert(commandCenterTasks).values({
        ownerUserId,
        centerId: data.centerId,
        departmentId,
        assigneeMemberId,
        title: data.title.trim(),
        description: sanitizeString(data.description, 5000),
        status: data.status ?? 'incoming',
        priority: data.priority ?? 'medium',
        source: data.source ?? 'manual',
        requestedBy: sanitizeString(data.requestedBy, 120),
        dueAt: data.dueAt ?? null,
        tags: data.tags ?? [],
        metadata: data.metadata ?? {},
        updatedAt: new Date(),
      }).returning();

      await tx.insert(commandCenterTaskEvents).values({
        ownerUserId,
        taskId: task.id,
        eventType: 'created',
        actorType: 'user',
        actorId,
        content: `创建任务：${task.title}`,
        metadata: { status: task.status, priority: task.priority },
      });

      logger.info('Task created', { taskId: task.id, title: task.title });
      return task;
    });
  } catch (error) {
    if (error instanceof CommandCenterError) throw error;
    logger.error('Failed to create task', { error, ownerUserId });
    throw new CommandCenterError('Failed to create task', 'CREATE_TASK_FAILED', 500);
  }
}

export async function updateCommandCenterTaskStatus(
  ownerUserId: string,
  taskId: string,
  data: { status: CommandCenterTaskStatus; actorId: string; note?: string }
) {
  try {
    validateUUID(taskId, 'taskId');
    if (!COMMAND_CENTER_TASK_STATUSES.includes(data.status)) {
      throw new ValidationError(`Invalid status: ${data.status}`);
    }

    await ensureCommandCenterSchema();
    const db = getDb();

    return db.transaction(async (tx) => {
      const [existing] = await tx.select()
        .from(commandCenterTasks)
        .where(and(
          eq(commandCenterTasks.id, taskId),
          eq(commandCenterTasks.ownerUserId, ownerUserId),
        ))
        .limit(1);

      if (!existing) {
        throw new CommandCenterError('Task not found', 'TASK_NOT_FOUND', 404);
      }

      const now = new Date();
      const [updated] = await tx.update(commandCenterTasks)
        .set({
          status: data.status,
          startedAt: data.status === 'in_progress' && !existing.startedAt ? now : existing.startedAt,
          completedAt: data.status === 'done' ? now : null,
          updatedAt: now,
        })
        .where(eq(commandCenterTasks.id, taskId))
        .returning();

      await tx.insert(commandCenterTaskEvents).values({
        ownerUserId,
        taskId,
        eventType: 'status_changed',
        actorType: 'user',
        actorId: data.actorId,
        content: data.note?.trim()
          ? `状态变更为 ${data.status}：${data.note.trim()}`
          : `状态变更为 ${data.status}`,
        metadata: { fromStatus: existing.status, toStatus: data.status },
      });

      logger.info('Task status updated', { taskId, status: data.status });
      return updated;
    });
  } catch (error) {
    if (error instanceof CommandCenterError) throw error;
    logger.error('Failed to update task status', { error, ownerUserId, taskId });
    throw new CommandCenterError('Failed to update task status', 'UPDATE_TASK_FAILED', 500);
  }
}

export async function appendCommandCenterTaskEvent(
  ownerUserId: string,
  data: {
    taskId: string;
    eventType: string;
    content: string;
    actorType?: string;
    actorId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    validateUUID(data.taskId, 'taskId');
    validateNonEmptyString(data.content, 'content', 5000);
    validateNonEmptyString(data.eventType, 'eventType', 40);

    await ensureCommandCenterSchema();
    const db = getDb();

    const [event] = await db.insert(commandCenterTaskEvents).values({
      ownerUserId,
      taskId: data.taskId,
      eventType: data.eventType,
      content: data.content.trim(),
      actorType: data.actorType ?? 'user',
      actorId: data.actorId,
      metadata: data.metadata ?? {},
    }).returning();

    return event;
  } catch (error) {
    logger.error('Failed to append task event', { error, ownerUserId, taskId: data.taskId });
    throw new CommandCenterError('Failed to append task event', 'APPEND_EVENT_FAILED', 500);
  }
}

export async function listCommandCenterOverview(
  ownerUserId: string,
  webCredentialId?: string
) {
  try {
    await ensureCommandCenterSchema();
    const db = getDb();

    const [centers, departments, members, tasks, recentEvents, skillAssignments, taskRuns] = await Promise.all([
      db.select().from(commandCenterCenters).where(eq(commandCenterCenters.ownerUserId, ownerUserId)),
      db.select().from(commandCenterDepartments).where(eq(commandCenterDepartments.ownerUserId, ownerUserId)),
      db.select().from(commandCenterMembers).where(eq(commandCenterMembers.ownerUserId, ownerUserId)),
      db.select().from(commandCenterTasks).where(eq(commandCenterTasks.ownerUserId, ownerUserId)),
      db.select().from(commandCenterTaskEvents)
        .where(eq(commandCenterTaskEvents.ownerUserId, ownerUserId))
        .orderBy(desc(commandCenterTaskEvents.createdAt))
        .limit(50),
      listCommandCenterSkillAssignments(ownerUserId).catch(() => []),
      listCommandCenterTaskRuns(ownerUserId).catch(() => ({ runs: [], pagination: { total: 0 } })),
    ]);

    const actorContext = webCredentialId
      ? await getCommandCenterActorContext(ownerUserId, webCredentialId)
      : { binding: null, skillAssignments: [] };

    const latestEventByTaskId = new Map<string, typeof recentEvents[number]>();
    for (const event of recentEvents) {
      if (!latestEventByTaskId.has(event.taskId)) {
        latestEventByTaskId.set(event.taskId, event);
      }
    }

    const summary = {
      centers: centers.length,
      departments: departments.length,
      members: members.length,
      skillAssignments: skillAssignments.length,
      tasks: tasks.length,
      taskRuns: taskRuns.pagination?.total ?? 0,
      byStatus: Object.fromEntries(COMMAND_CENTER_TASK_STATUSES.map((status) => [status, 0])),
      byRunStatus: Object.fromEntries(COMMAND_CENTER_TASK_RUN_STATUSES.map((status) => [status, 0])),
    } as {
      centers: number;
      departments: number;
      members: number;
      skillAssignments: number;
      tasks: number;
      taskRuns: number;
      byStatus: Record<CommandCenterTaskStatus, number>;
      byRunStatus: Record<CommandCenterTaskRunStatus, number>;
    };

    for (const task of tasks) {
      const status = task.status as CommandCenterTaskStatus;
      summary.byStatus[status] = (summary.byStatus[status] ?? 0) + 1;
    }

    return {
      skillCatalog: loadCommandCenterSkillCatalog(),
      actorContext,
      centers,
      departments,
      members,
      skillAssignments,
      tasks: tasks.map((task) => ({
        ...task,
        latestEvent: latestEventByTaskId.get(task.id) ?? null,
      })),
      taskRuns: taskRuns.runs?.slice(0, 50) ?? [],
      recentEvents,
      summary,
    };
  } catch (error) {
    logger.error('Failed to get overview', { error, ownerUserId });
    throw new CommandCenterError('Failed to fetch overview', 'FETCH_OVERVIEW_FAILED', 500);
  }
}

export async function getCommandCenterTaskDetail(ownerUserId: string, taskId: string) {
  try {
    validateUUID(taskId, 'taskId');
    await ensureCommandCenterSchema();
    const db = getDb();

    const [task] = await db.select()
      .from(commandCenterTasks)
      .where(and(
        eq(commandCenterTasks.id, taskId),
        eq(commandCenterTasks.ownerUserId, ownerUserId),
      ))
      .limit(1);

    if (!task) return null;

    const [events] = await Promise.all([
      db.select()
        .from(commandCenterTaskEvents)
        .where(and(
          eq(commandCenterTaskEvents.taskId, taskId),
          eq(commandCenterTaskEvents.ownerUserId, ownerUserId),
        ))
        .orderBy(desc(commandCenterTaskEvents.createdAt)),
    ]);

    const taskRuns = await listCommandCenterTaskRuns(ownerUserId, taskId);

    return { task, events, runs: taskRuns.runs };
  } catch (error) {
    logger.error('Failed to get task detail', { error, ownerUserId, taskId });
    return null;
  }
}

export async function getCommandCenterTaskById(ownerUserId: string, taskId: string) {
  try {
    validateUUID(taskId, 'taskId');
    await ensureCommandCenterSchema();
    const db = getDb();

    const [task] = await db.select()
      .from(commandCenterTasks)
      .where(and(
        eq(commandCenterTasks.id, taskId),
        eq(commandCenterTasks.ownerUserId, ownerUserId),
      ))
      .limit(1);

    return task ?? null;
  } catch (error) {
    logger.error('Failed to get task by id', { error, ownerUserId, taskId });
    return null;
  }
}

export async function listCommandCenterTasksForMember(ownerUserId: string, memberId: string) {
  try {
    validateUUID(memberId, 'memberId');
    await ensureCommandCenterSchema();
    const db = getDb();

    return db.select()
      .from(commandCenterTasks)
      .where(and(
        eq(commandCenterTasks.ownerUserId, ownerUserId),
        eq(commandCenterTasks.assigneeMemberId, memberId),
      ))
      .orderBy(desc(commandCenterTasks.updatedAt));
  } catch (error) {
    logger.error('Failed to list tasks for member', { error, ownerUserId, memberId });
    return [];
  }
}

// ============================================================================
// Task Dispatch Planning
// ============================================================================

export async function planCommandCenterTaskDispatch(
  ownerUserId: string,
  taskId: string,
  options?: { preferredMemberId?: string | null }
) {
  try {
    validateUUID(taskId, 'taskId');
    if (options?.preferredMemberId) validateUUID(options.preferredMemberId, 'preferredMemberId');

    await ensureCommandCenterSchema();
    const db = getDb();

    const [task, members, assignments] = await Promise.all([
      getCommandCenterTaskById(ownerUserId, taskId),
      db.select().from(commandCenterMembers).where(eq(commandCenterMembers.ownerUserId, ownerUserId)),
      listCommandCenterSkillAssignments(ownerUserId).catch(() => []),
    ]);

    if (!task) {
      throw new CommandCenterError('Task not found', 'TASK_NOT_FOUND', 404);
    }

    const activeMembers = members.filter((member) =>
      member.employmentStatus === 'active'
      && member.centerId === task.centerId
      && (!task.departmentId || member.departmentId === task.departmentId)
    );
    
    const memberMap = new Map(members.map((member) => [member.id, member]));
    const candidateMemberIds = new Set(activeMembers.map((member) => member.id));

    const preferredMember = options?.preferredMemberId ? memberMap.get(options.preferredMemberId) ?? null : null;
    const assignedMember = task.assigneeMemberId ? memberMap.get(task.assigneeMemberId) ?? null : null;

    let executorMember = assignedMember && candidateMemberIds.has(assignedMember.id)
      ? assignedMember
      : preferredMember && candidateMemberIds.has(preferredMember.id)
        ? preferredMember
        : null;

    const relevantAssignments = assignments.filter((assignment) => {
      if (assignment.status !== 'active') return false;
      if (assignment.scopeType === 'member') {
        return assignment.memberId ? candidateMemberIds.has(assignment.memberId) : false;
      }
      if (assignment.scopeType === 'department') {
        return Boolean(task.departmentId) && assignment.departmentId === task.departmentId;
      }
      return assignment.centerId === task.centerId;
    });

    if (!executorMember) {
      const memberScoped = relevantAssignments.find((assignment) =>
        assignment.scopeType === 'member'
        && assignment.memberId
        && candidateMemberIds.has(assignment.memberId)
      );
      executorMember = memberScoped?.memberId ? memberMap.get(memberScoped.memberId) ?? null : null;
    }

    if (!executorMember && activeMembers.length > 0) {
      executorMember = activeMembers[0] ?? null;
    }

    const scopeWeight: Record<CommandCenterSkillScopeType, number> = { 
      member: 3, 
      department: 2, 
      center: 1 
    };
    
    const sortedAssignments = [...relevantAssignments].sort((a, b) => {
      const executorBoostA = executorMember && a.scopeType === 'member' && a.memberId === executorMember.id ? 1000 : 0;
      const executorBoostB = executorMember && b.scopeType === 'member' && b.memberId === executorMember.id ? 1000 : 0;
      const scoreA = executorBoostA + (scopeWeight[a.scopeType as CommandCenterSkillScopeType] * 100) + (a.isPrimary ? 25 : 0) + (a.priority ?? 0);
      const scoreB = executorBoostB + (scopeWeight[b.scopeType as CommandCenterSkillScopeType] * 100) + (b.isPrimary ? 25 : 0) + (b.priority ?? 0);
      return scoreB - scoreA;
    });

    const skillAssignment = sortedAssignments[0] ?? null;
    const reasons = [
      assignedMember ? `任务当前执行人：${assignedMember.displayName}` : null,
      preferredMember && (!assignedMember || preferredMember.id !== assignedMember.id) 
        ? `当前操作者绑定员工：${preferredMember.displayName}` 
        : null,
      skillAssignment ? `匹配技能：${skillAssignment.skillName}（${skillAssignment.scopeType}）` : null,
      executorMember ? `推荐执行人：${executorMember.displayName}` : '未找到可执行员工',
    ].filter(Boolean) as string[];

    return { task, executorMember, skillAssignment, reason: reasons.join('；') };
  } catch (error) {
    if (error instanceof CommandCenterError) throw error;
    logger.error('Failed to plan task dispatch', { error, ownerUserId, taskId });
    throw new CommandCenterError('Failed to plan task dispatch', 'PLAN_DISPATCH_FAILED', 500);
  }
}

// ============================================================================
// Retry Wrapper for Critical Operations
// ============================================================================

export async function withRetry<T>(
  operation: () => Promise<T>,
  options?: { maxRetries?: number; delayMs?: number; onRetry?: (error: Error, attempt: number) => void }
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const delayMs = options?.delayMs ?? 1000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      if (error instanceof CommandCenterError && error.statusCode < 500) throw error;
      
      options?.onRetry?.(error as Error, attempt);
      await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
    }
  }

  throw new Error('Retry exhausted');
}
