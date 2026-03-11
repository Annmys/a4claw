import { and, asc, desc, eq, sql } from 'drizzle-orm';
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

export type CommandCenterTaskStatus = typeof COMMAND_CENTER_TASK_STATUSES[number];
export type CommandCenterTaskPriority = typeof COMMAND_CENTER_TASK_PRIORITIES[number];

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

export type CommandCenterSkillScopeType = typeof COMMAND_CENTER_SKILL_SCOPE_TYPES[number];
export type CommandCenterTaskRunStatus = typeof COMMAND_CENTER_TASK_RUN_STATUSES[number];

const SKILLS_DIR = join(process.cwd(), 'data', 'skills');

interface CommandCenterSkillCatalogItem {
  id: string;
  name: string;
  description: string;
  trigger: string;
  source: string;
  version: string;
}

export class CommandCenterBindingError extends Error {
  code: 'member_not_found' | 'member_already_bound';

  constructor(code: 'member_not_found' | 'member_already_bound', message: string) {
    super(message);
    this.code = code;
  }
}

let ensurePromise: Promise<void> | null = null;

export async function ensureCommandCenterSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    const db = getDb();

    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

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
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_centers_owner ON command_center_centers (owner_user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_centers_code ON command_center_centers (code)`);

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
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_departments_owner ON command_center_departments (owner_user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_departments_center ON command_center_departments (center_id)`);

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
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_members_owner ON command_center_members (owner_user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_members_center ON command_center_members (center_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_members_department ON command_center_members (department_id)`);

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
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_user_bindings_owner ON command_center_user_bindings (owner_user_id)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uidx_command_center_user_bindings_web_credential ON command_center_user_bindings (web_credential_id)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uidx_command_center_user_bindings_member ON command_center_user_bindings (member_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_user_bindings_status ON command_center_user_bindings (status)`);

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
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_skill_assignments_owner ON command_center_skill_assignments (owner_user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_skill_assignments_skill ON command_center_skill_assignments (skill_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_skill_assignments_scope ON command_center_skill_assignments (scope_type, scope_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_skill_assignments_status ON command_center_skill_assignments (status)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uidx_command_center_skill_assignments_scope_skill ON command_center_skill_assignments (scope_type, scope_id, skill_id)`);

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
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_tasks_owner ON command_center_tasks (owner_user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_tasks_center ON command_center_tasks (center_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_tasks_department ON command_center_tasks (department_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_tasks_assignee ON command_center_tasks (assignee_member_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_tasks_status ON command_center_tasks (status)`);

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
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_task_runs_owner ON command_center_task_runs (owner_user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_task_runs_task ON command_center_task_runs (task_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_task_runs_skill ON command_center_task_runs (skill_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_task_runs_executor ON command_center_task_runs (executor_member_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_task_runs_status ON command_center_task_runs (status)`);

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
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_task_events_owner ON command_center_task_events (owner_user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_task_events_task ON command_center_task_events (task_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_command_center_task_events_type ON command_center_task_events (event_type)`);
  })();

  return ensurePromise;
}

function loadCommandCenterSkillCatalog(): CommandCenterSkillCatalogItem[] {
  if (!existsSync(SKILLS_DIR)) return [];

  return readdirSync(SKILLS_DIR)
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
      } catch {
        return null;
      }
    })
    .filter((item): item is CommandCenterSkillCatalogItem => item !== null)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

export async function createCommandCenterCenter(
  ownerUserId: string,
  data: { name: string; code?: string; description?: string; metadata?: Record<string, unknown> },
) {
  await ensureCommandCenterSchema();
  const db = getDb();
  const [center] = await db.insert(commandCenterCenters).values({
    ownerUserId,
    name: data.name,
    code: data.code,
    description: data.description,
    metadata: data.metadata ?? {},
    updatedAt: new Date(),
  }).returning();
  return center;
}

export async function createCommandCenterDepartment(
  ownerUserId: string,
  data: { centerId: string; name: string; code?: string; description?: string; metadata?: Record<string, unknown> },
) {
  await ensureCommandCenterSchema();
  const db = getDb();
  const [department] = await db.insert(commandCenterDepartments).values({
    ownerUserId,
    centerId: data.centerId,
    name: data.name,
    code: data.code,
    description: data.description,
    metadata: data.metadata ?? {},
    updatedAt: new Date(),
  }).returning();
  return department;
}

export async function createCommandCenterMember(
  ownerUserId: string,
  data: {
    centerId: string;
    departmentId?: string | null;
    displayName: string;
    employeeCode?: string;
    roleTitle?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await ensureCommandCenterSchema();
  const db = getDb();
  const [member] = await db.insert(commandCenterMembers).values({
    ownerUserId,
    centerId: data.centerId,
    departmentId: data.departmentId ?? null,
    displayName: data.displayName,
    employeeCode: data.employeeCode,
    roleTitle: data.roleTitle,
    metadata: data.metadata ?? {},
    updatedAt: new Date(),
  }).returning();
  return member;
}

export async function listCommandCenterOrgOptions(ownerUserId: string) {
  await ensureCommandCenterSchema();
  const db = getDb();

  const [centers, departments, members] = await Promise.all([
    db.select().from(commandCenterCenters).where(eq(commandCenterCenters.ownerUserId, ownerUserId)).orderBy(asc(commandCenterCenters.createdAt)),
    db.select().from(commandCenterDepartments).where(eq(commandCenterDepartments.ownerUserId, ownerUserId)).orderBy(asc(commandCenterDepartments.createdAt)),
    db.select().from(commandCenterMembers).where(eq(commandCenterMembers.ownerUserId, ownerUserId)).orderBy(asc(commandCenterMembers.createdAt)),
  ]);

  return {
    centers,
    departments,
    members,
  };
}

export async function listCommandCenterUserBindings(ownerUserId: string) {
  await ensureCommandCenterSchema();
  const db = getDb();

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
  }).from(commandCenterUserBindings)
    .innerJoin(commandCenterMembers, eq(commandCenterUserBindings.memberId, commandCenterMembers.id))
    .leftJoin(commandCenterDepartments, eq(commandCenterMembers.departmentId, commandCenterDepartments.id))
    .innerJoin(commandCenterCenters, eq(commandCenterMembers.centerId, commandCenterCenters.id))
    .where(eq(commandCenterUserBindings.ownerUserId, ownerUserId))
    .orderBy(asc(commandCenterCenters.createdAt), asc(commandCenterMembers.createdAt));
}

async function validateScopeExists(
  ownerUserId: string,
  scopeType: CommandCenterSkillScopeType,
  scopeId: string,
) {
  const db = getDb();

  if (scopeType === 'center') {
    const [entity] = await db.select().from(commandCenterCenters).where(and(
      eq(commandCenterCenters.id, scopeId),
      eq(commandCenterCenters.ownerUserId, ownerUserId),
    )).limit(1);
    return entity ?? null;
  }

  if (scopeType === 'department') {
    const [entity] = await db.select().from(commandCenterDepartments).where(and(
      eq(commandCenterDepartments.id, scopeId),
      eq(commandCenterDepartments.ownerUserId, ownerUserId),
    )).limit(1);
    return entity ?? null;
  }

  const [entity] = await db.select().from(commandCenterMembers).where(and(
    eq(commandCenterMembers.id, scopeId),
    eq(commandCenterMembers.ownerUserId, ownerUserId),
  )).limit(1);
  return entity ?? null;
}

export async function listCommandCenterSkillAssignments(ownerUserId: string) {
  await ensureCommandCenterSchema();
  const db = getDb();

  const [assignments, centers, departments, members] = await Promise.all([
    db.select().from(commandCenterSkillAssignments)
      .where(eq(commandCenterSkillAssignments.ownerUserId, ownerUserId))
      .orderBy(asc(commandCenterSkillAssignments.scopeType), asc(commandCenterSkillAssignments.skillName)),
    db.select().from(commandCenterCenters).where(eq(commandCenterCenters.ownerUserId, ownerUserId)),
    db.select().from(commandCenterDepartments).where(eq(commandCenterDepartments.ownerUserId, ownerUserId)),
    db.select().from(commandCenterMembers).where(eq(commandCenterMembers.ownerUserId, ownerUserId)),
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
  await ensureCommandCenterSchema();
  const db = getDb();

  const scope = await validateScopeExists(ownerUserId, data.scopeType, data.scopeId);
  if (!scope) {
    throw new Error('Selected scope not found');
  }

  const skillCatalog = loadCommandCenterSkillCatalog();
  const skill = skillCatalog.find((item) => item.id === data.skillId);
  const skillName = skill?.name ?? data.skillId;
  const proficiency = Math.max(0, Math.min(100, Math.trunc(data.proficiency ?? 80)));
  const priority = Math.max(1, Math.min(999, Math.trunc(data.priority ?? 100)));
  const now = new Date();

  return db.transaction(async (tx) => {
    if (data.isPrimary) {
      await tx.update(commandCenterSkillAssignments).set({
        isPrimary: false,
        updatedAt: now,
      }).where(and(
        eq(commandCenterSkillAssignments.ownerUserId, ownerUserId),
        eq(commandCenterSkillAssignments.scopeType, data.scopeType),
        eq(commandCenterSkillAssignments.scopeId, data.scopeId),
      ));
    }

    const [existing] = await tx.select().from(commandCenterSkillAssignments).where(and(
      eq(commandCenterSkillAssignments.ownerUserId, ownerUserId),
      eq(commandCenterSkillAssignments.scopeType, data.scopeType),
      eq(commandCenterSkillAssignments.scopeId, data.scopeId),
      eq(commandCenterSkillAssignments.skillId, data.skillId),
    )).limit(1);

    if (existing) {
      const [assignment] = await tx.update(commandCenterSkillAssignments).set({
        skillName,
        proficiency,
        priority,
        isPrimary: Boolean(data.isPrimary),
        status: 'active',
        metadata: data.metadata ?? existing.metadata ?? {},
        updatedAt: now,
      }).where(eq(commandCenterSkillAssignments.id, existing.id)).returning();
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
    return assignment;
  });
}

export async function removeCommandCenterSkillAssignment(ownerUserId: string, assignmentId: string) {
  await ensureCommandCenterSchema();
  const db = getDb();

  const [assignment] = await db.delete(commandCenterSkillAssignments).where(and(
    eq(commandCenterSkillAssignments.ownerUserId, ownerUserId),
    eq(commandCenterSkillAssignments.id, assignmentId),
  )).returning();

  return assignment ?? null;
}

export async function upsertCommandCenterUserBinding(
  ownerUserId: string,
  data: {
    webCredentialId: string;
    memberId: string;
    title?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await ensureCommandCenterSchema();
  const db = getDb();

  return db.transaction(async (tx) => {
    const [member] = await tx.select().from(commandCenterMembers).where(and(
      eq(commandCenterMembers.id, data.memberId),
      eq(commandCenterMembers.ownerUserId, ownerUserId),
    )).limit(1);

    if (!member) {
      throw new CommandCenterBindingError('member_not_found', 'Selected member not found');
    }

    const [memberBinding] = await tx.select().from(commandCenterUserBindings).where(and(
      eq(commandCenterUserBindings.ownerUserId, ownerUserId),
      eq(commandCenterUserBindings.memberId, data.memberId),
    )).limit(1);

    if (memberBinding && memberBinding.webCredentialId !== data.webCredentialId) {
      throw new CommandCenterBindingError('member_already_bound', 'Selected member is already bound to another account');
    }

    const [existing] = await tx.select().from(commandCenterUserBindings).where(and(
      eq(commandCenterUserBindings.ownerUserId, ownerUserId),
      eq(commandCenterUserBindings.webCredentialId, data.webCredentialId),
    )).limit(1);

    const now = new Date();
    const title = data.title?.trim() || member.roleTitle || null;

    if (existing) {
      const [binding] = await tx.update(commandCenterUserBindings).set({
        memberId: data.memberId,
        title,
        status: 'active',
        isPrimary: true,
        metadata: data.metadata ?? existing.metadata ?? {},
        updatedAt: now,
      }).where(eq(commandCenterUserBindings.id, existing.id)).returning();
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
    return binding;
  });
}

export async function removeCommandCenterUserBinding(ownerUserId: string, webCredentialId: string) {
  await ensureCommandCenterSchema();
  const db = getDb();

  const [binding] = await db.delete(commandCenterUserBindings).where(and(
    eq(commandCenterUserBindings.ownerUserId, ownerUserId),
    eq(commandCenterUserBindings.webCredentialId, webCredentialId),
  )).returning();

  return binding ?? null;
}

export async function listCommandCenterTaskRuns(ownerUserId: string, taskId?: string) {
  await ensureCommandCenterSchema();
  const db = getDb();

  const whereClause = taskId
    ? and(
      eq(commandCenterTaskRuns.ownerUserId, ownerUserId),
      eq(commandCenterTaskRuns.taskId, taskId),
    )
    : eq(commandCenterTaskRuns.ownerUserId, ownerUserId);

  const runs = await db.select({
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
  }).from(commandCenterTaskRuns)
    .leftJoin(commandCenterMembers, eq(commandCenterTaskRuns.executorMemberId, commandCenterMembers.id))
    .where(whereClause)
    .orderBy(desc(commandCenterTaskRuns.createdAt));

  return runs;
}

export async function createCommandCenterTaskRun(
  ownerUserId: string,
  actorId: string,
  data: {
    taskId: string;
    skillId?: string | null;
    executorType?: string;
    executorMemberId?: string | null;
    inputSummary?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await ensureCommandCenterSchema();
  const db = getDb();

  return db.transaction(async (tx) => {
    const [task] = await tx.select().from(commandCenterTasks).where(and(
      eq(commandCenterTasks.id, data.taskId),
      eq(commandCenterTasks.ownerUserId, ownerUserId),
    )).limit(1);

    if (!task) return null;

    let executorMember = null as typeof commandCenterMembers.$inferSelect | null;
    if (data.executorMemberId) {
      const [member] = await tx.select().from(commandCenterMembers).where(and(
        eq(commandCenterMembers.id, data.executorMemberId),
        eq(commandCenterMembers.ownerUserId, ownerUserId),
      )).limit(1);
      if (!member) {
        throw new Error('Selected executor member not found');
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

    const nextTaskStatus = task.status === 'incoming' || task.status === 'triage' ? 'assigned' : task.status;
    if (nextTaskStatus !== task.status) {
      await tx.update(commandCenterTasks).set({
        status: nextTaskStatus,
        assigneeMemberId: executorMember?.id ?? task.assigneeMemberId,
        updatedAt: now,
      }).where(eq(commandCenterTasks.id, task.id));
    } else if (executorMember?.id && task.assigneeMemberId !== executorMember.id) {
      await tx.update(commandCenterTasks).set({
        assigneeMemberId: executorMember.id,
        updatedAt: now,
      }).where(eq(commandCenterTasks.id, task.id));
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
      metadata: {
        runId: run.id,
        skillId: run.skillId,
        executorMemberId: run.executorMemberId,
      },
    });

    return run;
  });
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
  await ensureCommandCenterSchema();
  const db = getDb();

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(commandCenterTaskRuns).where(and(
      eq(commandCenterTaskRuns.id, runId),
      eq(commandCenterTaskRuns.ownerUserId, ownerUserId),
    )).limit(1);

    if (!existing) return null;

    const [task] = await tx.select().from(commandCenterTasks).where(and(
      eq(commandCenterTasks.id, existing.taskId),
      eq(commandCenterTasks.ownerUserId, ownerUserId),
    )).limit(1);
    if (!task) return null;

    const now = new Date();
    const [run] = await tx.update(commandCenterTaskRuns).set({
      status: data.status,
      outputSummary: data.outputSummary?.trim() || existing.outputSummary,
      artifacts: data.artifacts ?? existing.artifacts ?? [],
      metadata: data.metadata ? { ...(existing.metadata ?? {}), ...data.metadata } : (existing.metadata ?? {}),
      startedAt: data.status === 'running' && !existing.startedAt ? now : existing.startedAt,
      completedAt: ['succeeded', 'failed', 'cancelled'].includes(data.status) ? now : null,
      updatedAt: now,
    }).where(eq(commandCenterTaskRuns.id, existing.id)).returning();

    let nextTaskStatus = task.status;
    if (data.status === 'running') nextTaskStatus = 'in_progress';
    if (data.status === 'succeeded') nextTaskStatus = 'review';
    if (data.status === 'failed') nextTaskStatus = 'blocked';

    if (nextTaskStatus !== task.status) {
      await tx.update(commandCenterTasks).set({
        status: nextTaskStatus,
        startedAt: nextTaskStatus === 'in_progress' && !task.startedAt ? now : task.startedAt,
        updatedAt: now,
      }).where(eq(commandCenterTasks.id, task.id));
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
      metadata: {
        runId: run.id,
        fromStatus: existing.status,
        toStatus: data.status,
      },
    });

    return run;
  });
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
  await ensureCommandCenterSchema();
  const db = getDb();
  const [event] = await db.insert(commandCenterTaskEvents).values({
    ownerUserId,
    taskId: data.taskId,
    eventType: data.eventType,
    content: data.content,
    actorType: data.actorType ?? 'user',
    actorId: data.actorId,
    metadata: data.metadata ?? {},
  }).returning();
  return event;
}

export async function createCommandCenterTask(
  ownerUserId: string,
  actorId: string,
  data: {
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
  },
) {
  await ensureCommandCenterSchema();
  const db = getDb();

  return db.transaction(async (tx) => {
    const [task] = await tx.insert(commandCenterTasks).values({
      ownerUserId,
      centerId: data.centerId,
      departmentId: data.departmentId ?? null,
      assigneeMemberId: data.assigneeMemberId ?? null,
      title: data.title,
      description: data.description,
      status: data.status ?? 'incoming',
      priority: data.priority ?? 'medium',
      source: data.source ?? 'manual',
      requestedBy: data.requestedBy,
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
      metadata: {
        status: task.status,
        priority: task.priority,
      },
    });

    return task;
  });
}

export async function updateCommandCenterTaskStatus(
  ownerUserId: string,
  taskId: string,
  data: { status: CommandCenterTaskStatus; actorId: string; note?: string },
) {
  await ensureCommandCenterSchema();
  const db = getDb();

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(commandCenterTasks).where(and(
      eq(commandCenterTasks.id, taskId),
      eq(commandCenterTasks.ownerUserId, ownerUserId),
    )).limit(1);

    if (!existing) return null;

    const now = new Date();
    const nextStatus = data.status;
    const [updated] = await tx.update(commandCenterTasks).set({
      status: nextStatus,
      startedAt: nextStatus === 'in_progress' && !existing.startedAt ? now : existing.startedAt,
      completedAt: nextStatus === 'done' ? now : null,
      updatedAt: now,
    }).where(eq(commandCenterTasks.id, taskId)).returning();

    await tx.insert(commandCenterTaskEvents).values({
      ownerUserId,
      taskId,
      eventType: 'status_changed',
      actorType: 'user',
      actorId: data.actorId,
      content: data.note?.trim()
        ? `状态变更为 ${nextStatus}：${data.note.trim()}`
        : `状态变更为 ${nextStatus}`,
      metadata: {
        fromStatus: existing.status,
        toStatus: nextStatus,
      },
    });

    return updated;
  });
}

export async function listCommandCenterOverview(ownerUserId: string) {
  await ensureCommandCenterSchema();
  const db = getDb();

  const [centers, departments, members, tasks, recentEvents, skillAssignments, taskRuns] = await Promise.all([
    db.select().from(commandCenterCenters).where(eq(commandCenterCenters.ownerUserId, ownerUserId)).orderBy(asc(commandCenterCenters.createdAt)),
    db.select().from(commandCenterDepartments).where(eq(commandCenterDepartments.ownerUserId, ownerUserId)).orderBy(asc(commandCenterDepartments.createdAt)),
    db.select().from(commandCenterMembers).where(eq(commandCenterMembers.ownerUserId, ownerUserId)).orderBy(asc(commandCenterMembers.createdAt)),
    db.select().from(commandCenterTasks).where(eq(commandCenterTasks.ownerUserId, ownerUserId)).orderBy(desc(commandCenterTasks.updatedAt)),
    db.select().from(commandCenterTaskEvents).where(eq(commandCenterTaskEvents.ownerUserId, ownerUserId)).orderBy(desc(commandCenterTaskEvents.createdAt)).limit(50),
    listCommandCenterSkillAssignments(ownerUserId),
    listCommandCenterTaskRuns(ownerUserId),
  ]);

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
    taskRuns: taskRuns.length,
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
  for (const run of taskRuns) {
    const status = run.status as CommandCenterTaskRunStatus;
    summary.byRunStatus[status] = (summary.byRunStatus[status] ?? 0) + 1;
  }

  return {
    skillCatalog: loadCommandCenterSkillCatalog(),
    centers,
    departments,
    members,
    skillAssignments,
    tasks: tasks.map((task) => ({
      ...task,
      latestEvent: latestEventByTaskId.get(task.id) ?? null,
    })),
    taskRuns: taskRuns.slice(0, 50),
    recentEvents,
    summary,
  };
}

export async function getCommandCenterTaskDetail(ownerUserId: string, taskId: string) {
  await ensureCommandCenterSchema();
  const db = getDb();

  const [task] = await db.select().from(commandCenterTasks).where(and(
    eq(commandCenterTasks.id, taskId),
    eq(commandCenterTasks.ownerUserId, ownerUserId),
  )).limit(1);

  if (!task) return null;

  const [events] = await Promise.all([
    db.select().from(commandCenterTaskEvents).where(and(
      eq(commandCenterTaskEvents.taskId, taskId),
      eq(commandCenterTaskEvents.ownerUserId, ownerUserId),
    )).orderBy(desc(commandCenterTaskEvents.createdAt)),
  ]);

  return {
    task,
    events,
    runs: await listCommandCenterTaskRuns(ownerUserId, taskId),
  };
}

export async function getCommandCenterTaskById(ownerUserId: string, taskId: string) {
  await ensureCommandCenterSchema();
  const db = getDb();
  const [task] = await db.select().from(commandCenterTasks).where(and(
    eq(commandCenterTasks.id, taskId),
    eq(commandCenterTasks.ownerUserId, ownerUserId),
  )).limit(1);
  return task ?? null;
}
