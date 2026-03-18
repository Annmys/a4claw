import { and, eq, sql, inArray } from 'drizzle-orm';
import { getDb } from '../database.js';
import { commandCenterTasks, commandCenterTaskEvents, commandCenterTaskRuns } from '../schema.js';
import logger from '../../utils/logger.js';

export type TaskDependencyType = 
  | 'finish_to_start'  // B can start after A finishes (default)
  | 'start_to_start'   // B can start after A starts
  | 'finish_to_finish' // B must finish after A finishes
  | 'start_to_finish'; // B must finish after A starts

export interface TaskDependency {
  id?: string;
  taskId: string;           // Current task
  dependsOnTaskId: string;  // Prerequisite task
  dependencyType: TaskDependencyType;
  lagMinutes?: number;      // Wait time after dependency satisfied
}

export interface TaskDAG {
  nodes: Array<{
    id: string;
    title: string;
    status: string;
    dependencies: TaskDependency[];
    dependents: TaskDependency[];
  }>;
  edges: Array<{
    from: string;
    to: string;
    type: TaskDependencyType;
  }>;
  isValid: boolean;
  cycles: string[][];       // List of cycles if any
}

// ============================================================================
// Dependency CRUD
// ============================================================================

export async function addTaskDependency(
  ownerUserId: string,
  taskId: string,
  dependsOnTaskId: string,
  dependencyType: TaskDependencyType = 'finish_to_start',
  lagMinutes: number = 0
): Promise<void> {
  const db = getDb();

  // Validate tasks exist and belong to user
  const [task, dependsOnTask] = await Promise.all([
    db.select().from(commandCenterTasks).where(and(
      eq(commandCenterTasks.id, taskId),
      eq(commandCenterTasks.ownerUserId, ownerUserId)
    )).limit(1),
    db.select().from(commandCenterTasks).where(and(
      eq(commandCenterTasks.id, dependsOnTaskId),
      eq(commandCenterTasks.ownerUserId, ownerUserId)
    )).limit(1),
  ]);

  if (!task[0]) throw new Error('Task not found');
  if (!dependsOnTask[0]) throw new Error('Prerequisite task not found');

  // Check for self-dependency
  if (taskId === dependsOnTaskId) {
    throw new Error('Task cannot depend on itself');
  }

  // Check if dependency already exists
  const existing = await db.select().from(commandCenterTasks).where(and(
    eq(commandCenterTasks.id, taskId),
    sql`${commandCenterTasks.metadata}->>'dependencies' LIKE ${`%"${dependsOnTaskId}"%`}`
  ));

  // Store dependency in task metadata (simplified approach)
  const metadata = task[0].metadata as Record<string, unknown> || {};
  const currentDeps: TaskDependency[] = (metadata.dependencies as TaskDependency[]) || [];
  
  if (currentDeps.some(d => d.dependsOnTaskId === dependsOnTaskId)) {
    throw new Error('Dependency already exists');
  }

  currentDeps.push({
    taskId,
    dependsOnTaskId,
    dependencyType,
    lagMinutes,
  });

  await db.update(commandCenterTasks).set({
    metadata: {
      ...metadata,
      dependencies: currentDeps,
    },
    updatedAt: new Date(),
  }).where(eq(commandCenterTasks.id, taskId));

  // Add event
  await db.insert(commandCenterTaskEvents).values({
    ownerUserId,
    taskId,
    eventType: 'dependency_added',
    content: `添加依赖：${dependsOnTask[0].title} (${dependencyType})`,
    actorType: 'system',
    actorId: 'system',
    metadata: { dependsOnTaskId, dependencyType },
  });

  logger.info('Task dependency added', { taskId, dependsOnTaskId, dependencyType });
}

export async function removeTaskDependency(
  ownerUserId: string,
  taskId: string,
  dependsOnTaskId: string
): Promise<void> {
  const db = getDb();

  const [task] = await db.select().from(commandCenterTasks).where(and(
    eq(commandCenterTasks.id, taskId),
    eq(commandCenterTasks.ownerUserId, ownerUserId)
  )).limit(1);

  if (!task) throw new Error('Task not found');

  const metadata = (task.metadata || {}) as Record<string, unknown>;
  const currentDeps: TaskDependency[] = (metadata.dependencies as TaskDependency[]) || [];
  const updatedDeps = currentDeps.filter(d => d.dependsOnTaskId !== dependsOnTaskId);

  if (currentDeps.length === updatedDeps.length) {
    throw new Error('Dependency not found');
  }

  await db.update(commandCenterTasks).set({
    metadata: {
      ...task.metadata,
      dependencies: updatedDeps,
    },
    updatedAt: new Date(),
  }).where(eq(commandCenterTasks.id, taskId));

  logger.info('Task dependency removed', { taskId, dependsOnTaskId });
}

// ============================================================================
// DAG Analysis
// ============================================================================

export async function buildTaskDAG(
  ownerUserId: string,
  centerId?: string
): Promise<TaskDAG> {
  const db = getDb();

  let query = db.select().from(commandCenterTasks)
    .where(eq(commandCenterTasks.ownerUserId, ownerUserId));
  
  if (centerId) {
    query = db.select().from(commandCenterTasks).where(and(
      eq(commandCenterTasks.ownerUserId, ownerUserId),
      eq(commandCenterTasks.centerId, centerId)
    ));
  }

  const tasks = await query;

  const nodes = tasks.map(task => ({
    id: task.id,
    title: task.title,
    status: task.status,
    dependencies: ((task.metadata as Record<string, unknown> | null)?.dependencies as TaskDependency[]) || [],
    dependents: [], // Will be populated
  }));

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const edges: TaskDAG['edges'] = [];

  // Build edges and dependents
  for (const node of nodes) {
    for (const dep of node.dependencies) {
      edges.push({
        from: dep.dependsOnTaskId,
        to: node.id,
        type: dep.dependencyType,
      });

      const parentNode = nodeMap.get(dep.dependsOnTaskId);
      if (parentNode) {
        parentNode.dependents.push(dep);
      }
    }
  }

  // Detect cycles
  const cycles = detectCycles(nodes);

  return {
    nodes,
    edges,
    isValid: cycles.length === 0,
    cycles,
  };
}

function detectCycles(nodes: TaskDAG['nodes']): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  function dfs(nodeId: string, path: string[]): void {
    if (recursionStack.has(nodeId)) {
      // Found cycle
      const cycleStart = path.indexOf(nodeId);
      cycles.push(path.slice(cycleStart));
      return;
    }

    if (visited.has(nodeId)) return;

    visited.add(nodeId);
    recursionStack.add(nodeId);
    path.push(nodeId);

    const node = nodeMap.get(nodeId);
    if (node) {
      for (const dep of node.dependencies) {
        dfs(dep.dependsOnTaskId, [...path]);
      }
    }

    recursionStack.delete(nodeId);
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id, []);
    }
  }

  return cycles;
}

// ============================================================================
// Dependency Resolution
// ============================================================================

export async function checkTaskDependenciesSatisfied(
  ownerUserId: string,
  taskId: string
): Promise<{
  satisfied: boolean;
  pendingDependencies: Array<{
    taskId: string;
    title: string;
    status: string;
    type: TaskDependencyType;
    lagMinutes: number;
  }>;
}> {
  const db = getDb();

  const [task] = await db.select().from(commandCenterTasks).where(and(
    eq(commandCenterTasks.id, taskId),
    eq(commandCenterTasks.ownerUserId, ownerUserId)
  )).limit(1);

  if (!task) throw new Error('Task not found');

  const metadata = (task.metadata || {}) as Record<string, unknown>;
  const dependencies: TaskDependency[] = (metadata.dependencies as TaskDependency[]) || [];
  
  if (dependencies.length === 0) {
    return { satisfied: true, pendingDependencies: [] };
  }

  // Get prerequisite tasks
  const prereqIds = dependencies.map(d => d.dependsOnTaskId);
  const prereqTasks = await db.select().from(commandCenterTasks).where(and(
    eq(commandCenterTasks.ownerUserId, ownerUserId),
    inArray(commandCenterTasks.id, prereqIds)
  ));

  const prereqMap = new Map(prereqTasks.map(t => [t.id, t]));
  const pendingDependencies: Array<{
    taskId: string;
    title: string;
    status: string;
    type: TaskDependencyType;
    lagMinutes: number;
  }> = [];

  for (const dep of dependencies) {
    const prereq = prereqMap.get(dep.dependsOnTaskId);
    if (!prereq) continue;

    const isSatisfied = checkDependencySatisfied(dep, prereq);
    
    if (!isSatisfied) {
      pendingDependencies.push({
        taskId: prereq.id,
        title: prereq.title,
        status: prereq.status,
        type: dep.dependencyType,
        lagMinutes: dep.lagMinutes || 0,
      });
    }
  }

  return {
    satisfied: pendingDependencies.length === 0,
    pendingDependencies,
  };
}

function checkDependencySatisfied(
  dependency: TaskDependency,
  prereqTask: { status: string; completedAt?: Date | null }
): boolean {
  switch (dependency.dependencyType) {
    case 'finish_to_start':
      return prereqTask.status === 'done' || 
             (prereqTask.status === 'review' && prereqTask.completedAt);
    
    case 'start_to_start':
      return ['in_progress', 'review', 'done'].includes(prereqTask.status);
    
    case 'finish_to_finish':
      return prereqTask.status === 'done' || prereqTask.completedAt != null || false;
    
    case 'start_to_finish':
      return ['in_progress', 'review', 'done'].includes(prereqTask.status);
    
    default:
      return false;
  }
}

// ============================================================================
// Topological Sort (Execution Order)
// ============================================================================

export async function getTaskExecutionOrder(
  ownerUserId: string,
  taskIds: string[]
): Promise<string[]> {
  const db = getDb();

  const tasks = await db.select().from(commandCenterTasks).where(and(
    eq(commandCenterTasks.ownerUserId, ownerUserId),
    inArray(commandCenterTasks.id, taskIds)
  ));

  // Build dependency graph
  const graph = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  for (const task of tasks) {
    graph.set(task.id, new Set());
    inDegree.set(task.id, 0);
  }

  for (const task of tasks) {
    const deps: TaskDependency[] = ((task.metadata as Record<string, unknown> | null)?.dependencies as TaskDependency[]) || [];
    for (const dep of deps) {
      if (taskIds.includes(dep.dependsOnTaskId)) {
        graph.get(dep.dependsOnTaskId)?.add(task.id);
        inDegree.set(task.id, (inDegree.get(task.id) || 0) + 1);
      }
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  const result: string[] = [];

  for (const [taskId, degree] of inDegree.entries()) {
    if (degree === 0) queue.push(taskId);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    const dependents = graph.get(current) || new Set();
    for (const dependent of dependents) {
      const newDegree = (inDegree.get(dependent) || 0) - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) {
        queue.push(dependent);
      }
    }
  }

  if (result.length !== tasks.length) {
    throw new Error('Circular dependency detected');
  }

  return result;
}

// ============================================================================
// Auto-unlock tasks when dependencies are satisfied
// ============================================================================

export async function unlockDependentTasks(
  ownerUserId: string,
  completedTaskId: string
): Promise<Array<{ taskId: string; title: string }>> {
  const db = getDb();

  // Find all tasks that depend on the completed task
  const allTasks = await db.select().from(commandCenterTasks).where(and(
    eq(commandCenterTasks.ownerUserId, ownerUserId),
    sql`${commandCenterTasks.metadata}->>'dependencies' LIKE ${`%"${completedTaskId}"%`}`
  ));

  const unlocked: Array<{ taskId: string; title: string }> = [];

  for (const task of allTasks) {
    if (task.status !== 'blocked') continue;

    const { satisfied } = await checkTaskDependenciesSatisfied(ownerUserId, task.id);
    
    if (satisfied) {
      // Update status to ready
      await db.update(commandCenterTasks).set({
        status: 'incoming', // Ready to be assigned
        updatedAt: new Date(),
      }).where(eq(commandCenterTasks.id, task.id));

      // Add event
      await db.insert(commandCenterTaskEvents).values({
        ownerUserId,
        taskId: task.id,
        eventType: 'dependencies_satisfied',
        content: `依赖任务已完成，任务已解锁`,
        actorType: 'system',
        actorId: 'system',
        metadata: { unblockedBy: completedTaskId },
      });

      unlocked.push({ taskId: task.id, title: task.title });
    }
  }

  return unlocked;
}
