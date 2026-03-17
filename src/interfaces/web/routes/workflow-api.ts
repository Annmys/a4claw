import { Router, Request, Response } from 'express';
import { audit } from '../../../security/audit-log.js';
import logger from '../../../utils/logger.js';
import {
  addTaskDependency,
  removeTaskDependency,
  buildTaskDAG,
  checkTaskDependenciesSatisfied,
  getTaskExecutionOrder,
  unlockDependentTasks,
  type TaskDependencyType,
} from '../../../memory/repositories/task-dependencies.js';
import { workflowEngine, type WorkflowDefinition } from '../../../core/workflow-engine.js';
import { multiAgentCoordinator, planMultiAgentCollaboration } from '../../../core/multi-agent-collaboration.js';

const router = Router();

// ============================================================================
// Task Dependencies
// ============================================================================

// Add dependency
router.post('/tasks/:taskId/dependencies', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { dependsOnTaskId, dependencyType = 'finish_to_start', lagMinutes = 0 } = req.body;
    const ownerUserId = (req as any).user.userId;

    if (!dependsOnTaskId) {
      return res.status(400).json({ error: 'Missing dependsOnTaskId' });
    }

    await addTaskDependency(ownerUserId, taskId, dependsOnTaskId, dependencyType as TaskDependencyType, lagMinutes);
    await audit(ownerUserId, 'task.dependency.added', { taskId, dependsOnTaskId }, 'web');
    
    res.json({ success: true, message: 'Dependency added' });
  } catch (err: any) {
    logger.error('Failed to add dependency', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Remove dependency
router.delete('/tasks/:taskId/dependencies/:dependsOnTaskId', async (req: Request, res: Response) => {
  try {
    const { taskId, dependsOnTaskId } = req.params;
    const ownerUserId = (req as any).user.userId;

    await removeTaskDependency(ownerUserId, taskId, dependsOnTaskId);
    await audit(ownerUserId, 'task.dependency.removed', { taskId, dependsOnTaskId }, 'web');
    
    res.json({ success: true, message: 'Dependency removed' });
  } catch (err: any) {
    logger.error('Failed to remove dependency', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Get task DAG
router.get('/dag', async (req: Request, res: Response) => {
  try {
    const ownerUserId = (req as any).user.userId;
    const { centerId } = req.query;

    const dag = await buildTaskDAG(ownerUserId, centerId as string | undefined);
    res.json(dag);
  } catch (err: any) {
    logger.error('Failed to build DAG', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Check dependencies
router.get('/tasks/:taskId/dependencies/status', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const ownerUserId = (req as any).user.userId;

    const status = await checkTaskDependenciesSatisfied(ownerUserId, taskId);
    res.json(status);
  } catch (err: any) {
    logger.error('Failed to check dependencies', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Get execution order
router.post('/execution-order', async (req: Request, res: Response) => {
  try {
    const { taskIds } = req.body;
    const ownerUserId = (req as any).user.userId;

    if (!Array.isArray(taskIds)) {
      return res.status(400).json({ error: 'taskIds must be an array' });
    }

    const order = await getTaskExecutionOrder(ownerUserId, taskIds);
    res.json({ order });
  } catch (err: any) {
    logger.error('Failed to get execution order', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Unlock dependent tasks
router.post('/tasks/:taskId/unlock-dependents', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const ownerUserId = (req as any).user.userId;

    const unlocked = await unlockDependentTasks(ownerUserId, taskId);
    res.json({ unlocked, count: unlocked.length });
  } catch (err: any) {
    logger.error('Failed to unlock dependents', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// Workflows
// ============================================================================

// List workflows
router.get('/workflows', async (req: Request, res: Response) => {
  try {
    const workflows = workflowEngine.getWorkflows();
    res.json({ workflows });
  } catch (err: any) {
    logger.error('Failed to list workflows', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Register workflow
router.post('/workflows', async (req: Request, res: Response) => {
  try {
    const definition: WorkflowDefinition = req.body;
    workflowEngine.registerWorkflow(definition);
    await audit((req as any).user.userId, 'workflow.registered', { workflowId: definition.id }, 'web');
    res.json({ success: true });
  } catch (err: any) {
    logger.error('Failed to register workflow', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Start workflow
router.post('/workflows/:workflowId/start', async (req: Request, res: Response) => {
  try {
    const { workflowId } = req.params;
    const { variables } = req.body;
    const ownerUserId = (req as any).user.userId;

    const instance = await workflowEngine.startWorkflow(workflowId, ownerUserId, variables);
    res.json({ instance });
  } catch (err: any) {
    logger.error('Failed to start workflow', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Get workflow instance
router.get('/workflow-instances/:instanceId', async (req: Request, res: Response) => {
  try {
    const { instanceId } = req.params;
    const instance = workflowEngine.getInstance(instanceId);
    
    if (!instance) {
      return res.status(404).json({ error: 'Instance not found' });
    }
    
    res.json({ instance });
  } catch (err: any) {
    logger.error('Failed to get workflow instance', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Cancel workflow
router.post('/workflow-instances/:instanceId/cancel', async (req: Request, res: Response) => {
  try {
    const { instanceId } = req.params;
    const success = workflowEngine.cancelWorkflow(instanceId);
    
    if (!success) {
      return res.status(400).json({ error: 'Cannot cancel instance' });
    }
    
    await audit((req as any).user.userId, 'workflow.cancelled', { instanceId }, 'web');
    res.json({ success: true });
  } catch (err: any) {
    logger.error('Failed to cancel workflow', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// Multi-Agent Collaboration
// ============================================================================

// Plan collaboration
router.post('/collaborations/plan', async (req: Request, res: Response) => {
  try {
    const { task, availableAgents } = req.body;
    
    const plan = await planMultiAgentCollaboration(task, availableAgents);
    res.json({ plan });
  } catch (err: any) {
    logger.error('Failed to plan collaboration', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Get collaboration status
router.get('/collaborations/:collaborationId', async (req: Request, res: Response) => {
  try {
    const { collaborationId } = req.params;
    const execution = multiAgentCoordinator.getExecution(collaborationId);
    
    if (!execution) {
      return res.status(404).json({ error: 'Collaboration not found' });
    }
    
    res.json({ execution });
  } catch (err: any) {
    logger.error('Failed to get collaboration', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

export default router;
