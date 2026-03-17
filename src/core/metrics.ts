import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import logger from '../utils/logger.js';

// ============================================================================
// Prometheus Metrics Collection
// ============================================================================

class MetricsCollector {
  private registry: Registry;
  private initialized = false;

  // Task metrics
  public taskCreatedCounter: Counter;
  public taskCompletedCounter: Counter;
  public taskFailedCounter: Counter;
  public taskDurationHistogram: Histogram;
  public activeTasksGauge: Gauge;

  // Workflow metrics
  public workflowStartedCounter: Counter;
  public workflowCompletedCounter: Counter;
  public workflowFailedCounter: Counter;
  public workflowDurationHistogram: Histogram;
  public activeWorkflowsGauge: Gauge;

  // Skill execution metrics
  public skillExecutionCounter: Counter;
  public skillExecutionDuration: Histogram;
  public skillExecutionErrors: Counter;

  // Approval gate metrics
  public approvalRequestCounter: Counter;
  public approvalDecisionCounter: Counter;
  public approvalDurationHistogram: Histogram;

  // Database metrics
  public dbQueryDuration: Histogram;
  public dbQueryErrors: Counter;
  public dbConnectionsGauge: Gauge;

  // Multi-agent collaboration metrics
  public collaborationStartedCounter: Counter;
  public collaborationCompletedCounter: Counter;
  public collaborationFailedCounter: Counter;
  public agentExecutionDuration: Histogram;

  // System metrics
  public memoryUsageGauge: Gauge;
  public cpuUsageGauge: Gauge;
  public eventLoopLagGauge: Gauge;
  public httpRequestDuration: Histogram;
  public httpRequestErrors: Counter;

  constructor() {
    this.registry = new Registry();
    this.initializeMetrics();
  }

  private initializeMetrics(): void {
    if (this.initialized) return;

    // Task metrics
    this.taskCreatedCounter = new Counter({
      name: 'command_center_tasks_created_total',
      help: 'Total number of tasks created',
      labelNames: ['source', 'priority'],
      registers: [this.registry],
    });

    this.taskCompletedCounter = new Counter({
      name: 'command_center_tasks_completed_total',
      help: 'Total number of tasks completed',
      labelNames: ['status'],
      registers: [this.registry],
    });

    this.taskFailedCounter = new Counter({
      name: 'command_center_tasks_failed_total',
      help: 'Total number of tasks failed',
      labelNames: ['error_type'],
      registers: [this.registry],
    });

    this.taskDurationHistogram = new Histogram({
      name: 'command_center_task_duration_seconds',
      help: 'Task execution duration in seconds',
      labelNames: ['status', 'priority'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600],
      registers: [this.registry],
    });

    this.activeTasksGauge = new Gauge({
      name: 'command_center_active_tasks',
      help: 'Number of currently active tasks',
      labelNames: ['status'],
      registers: [this.registry],
    });

    // Workflow metrics
    this.workflowStartedCounter = new Counter({
      name: 'command_center_workflows_started_total',
      help: 'Total number of workflows started',
      labelNames: ['workflow_type'],
      registers: [this.registry],
    });

    this.workflowCompletedCounter = new Counter({
      name: 'command_center_workflows_completed_total',
      help: 'Total number of workflows completed',
      labelNames: ['workflow_type'],
      registers: [this.registry],
    });

    this.workflowFailedCounter = new Counter({
      name: 'command_center_workflows_failed_total',
      help: 'Total number of workflows failed',
      labelNames: ['workflow_type', 'error_type'],
      registers: [this.registry],
    });

    this.workflowDurationHistogram = new Histogram({
      name: 'command_center_workflow_duration_seconds',
      help: 'Workflow execution duration in seconds',
      labelNames: ['workflow_type'],
      buckets: [1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600],
      registers: [this.registry],
    });

    this.activeWorkflowsGauge = new Gauge({
      name: 'command_center_active_workflows',
      help: 'Number of currently active workflows',
      registers: [this.registry],
    });

    // Skill execution metrics
    this.skillExecutionCounter = new Counter({
      name: 'command_center_skill_executions_total',
      help: 'Total number of skill executions',
      labelNames: ['skill_id', 'skill_name', 'status'],
      registers: [this.registry],
    });

    this.skillExecutionDuration = new Histogram({
      name: 'command_center_skill_execution_duration_seconds',
      help: 'Skill execution duration in seconds',
      labelNames: ['skill_id', 'skill_name'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
      registers: [this.registry],
    });

    this.skillExecutionErrors = new Counter({
      name: 'command_center_skill_execution_errors_total',
      help: 'Total number of skill execution errors',
      labelNames: ['skill_id', 'error_type'],
      registers: [this.registry],
    });

    // Approval gate metrics
    this.approvalRequestCounter = new Counter({
      name: 'command_center_approval_requests_total',
      help: 'Total number of approval requests',
      labelNames: ['gate_type', 'status'],
      registers: [this.registry],
    });

    this.approvalDecisionCounter = new Counter({
      name: 'command_center_approval_decisions_total',
      help: 'Total number of approval decisions',
      labelNames: ['decision'],
      registers: [this.registry],
    });

    this.approvalDurationHistogram = new Histogram({
      name: 'command_center_approval_duration_seconds',
      help: 'Time from request to decision in seconds',
      buckets: [60, 300, 600, 1800, 3600, 7200, 86400],
      registers: [this.registry],
    });

    // Database metrics
    this.dbQueryDuration = new Histogram({
      name: 'command_center_db_query_duration_seconds',
      help: 'Database query duration in seconds',
      labelNames: ['operation', 'table'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
      registers: [this.registry],
    });

    this.dbQueryErrors = new Counter({
      name: 'command_center_db_query_errors_total',
      help: 'Total number of database query errors',
      labelNames: ['operation', 'error_type'],
      registers: [this.registry],
    });

    this.dbConnectionsGauge = new Gauge({
      name: 'command_center_db_connections',
      help: 'Number of active database connections',
      registers: [this.registry],
    });

    // Multi-agent collaboration metrics
    this.collaborationStartedCounter = new Counter({
      name: 'command_center_collaborations_started_total',
      help: 'Total number of multi-agent collaborations started',
      labelNames: ['strategy'],
      registers: [this.registry],
    });

    this.collaborationCompletedCounter = new Counter({
      name: 'command_center_collaborations_completed_total',
      help: 'Total number of multi-agent collaborations completed',
      labelNames: ['strategy'],
      registers: [this.registry],
    });

    this.collaborationFailedCounter = new Counter({
      name: 'command_center_collaborations_failed_total',
      help: 'Total number of multi-agent collaborations failed',
      labelNames: ['strategy', 'error_type'],
      registers: [this.registry],
    });

    this.agentExecutionDuration = new Histogram({
      name: 'command_center_agent_execution_duration_seconds',
      help: 'Individual agent execution duration in seconds',
      labelNames: ['agent_id'],
      buckets: [0.5, 1, 2, 5, 10, 30, 60, 120],
      registers: [this.registry],
    });

    // System metrics
    this.memoryUsageGauge = new Gauge({
      name: 'command_center_memory_usage_bytes',
      help: 'Memory usage in bytes',
      labelNames: ['type'],
      registers: [this.registry],
    });

    this.cpuUsageGauge = new Gauge({
      name: 'command_center_cpu_usage_percent',
      help: 'CPU usage percentage',
      registers: [this.registry],
    });

    this.eventLoopLagGauge = new Gauge({
      name: 'command_center_event_loop_lag_seconds',
      help: 'Event loop lag in seconds',
      registers: [this.registry],
    });

    this.httpRequestDuration = new Histogram({
      name: 'command_center_http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.httpRequestErrors = new Counter({
      name: 'command_center_http_request_errors_total',
      help: 'Total number of HTTP request errors',
      labelNames: ['method', 'route', 'error_type'],
      registers: [this.registry],
    });

    this.initialized = true;
    logger.info('Metrics collector initialized');
  }

  // Metric helper methods
  public recordTaskCreated(source: string, priority: string): void {
    this.taskCreatedCounter.inc({ source, priority });
  }

  public recordTaskCompleted(status: string, durationSeconds: number, priority: string): void {
    this.taskCompletedCounter.inc({ status });
    this.taskDurationHistogram.observe({ status, priority }, durationSeconds);
  }

  public recordTaskFailed(errorType: string): void {
    this.taskFailedCounter.inc({ error_type: errorType });
  }

  public setActiveTasks(status: string, count: number): void {
    this.activeTasksGauge.set({ status }, count);
  }

  public recordWorkflowStarted(workflowType: string): void {
    this.workflowStartedCounter.inc({ workflow_type: workflowType });
    this.activeWorkflowsGauge.inc();
  }

  public recordWorkflowCompleted(workflowType: string, durationSeconds: number): void {
    this.workflowCompletedCounter.inc({ workflow_type: workflowType });
    this.workflowDurationHistogram.observe({ workflow_type: workflowType }, durationSeconds);
    this.activeWorkflowsGauge.dec();
  }

  public recordWorkflowFailed(workflowType: string, errorType: string): void {
    this.workflowFailedCounter.inc({ workflow_type: workflowType, error_type: errorType });
    this.activeWorkflowsGauge.dec();
  }

  public recordSkillExecution(skillId: string, skillName: string, status: string, durationSeconds: number): void {
    this.skillExecutionCounter.inc({ skill_id: skillId, skill_name: skillName, status });
    this.skillExecutionDuration.observe({ skill_id: skillId, skill_name: skillName }, durationSeconds);
  }

  public recordSkillExecutionError(skillId: string, errorType: string): void {
    this.skillExecutionErrors.inc({ skill_id: skillId, error_type: errorType });
  }

  public recordApprovalRequest(gateType: string, status: string): void {
    this.approvalRequestCounter.inc({ gate_type: gateType, status });
  }

  public recordApprovalDecision(decision: string, durationSeconds: number): void {
    this.approvalDecisionCounter.inc({ decision });
    this.approvalDurationHistogram.observe(durationSeconds);
  }

  public recordDbQuery(operation: string, table: string, durationSeconds: number): void {
    this.dbQueryDuration.observe({ operation, table }, durationSeconds);
  }

  public recordDbQueryError(operation: string, errorType: string): void {
    this.dbQueryErrors.inc({ operation, error_type: errorType });
  }

  public recordCollaborationStarted(strategy: string): void {
    this.collaborationStartedCounter.inc({ strategy });
  }

  public recordCollaborationCompleted(strategy: string): void {
    this.collaborationCompletedCounter.inc({ strategy });
  }

  public recordCollaborationFailed(strategy: string, errorType: string): void {
    this.collaborationFailedCounter.inc({ strategy, error_type: errorType });
  }

  public recordAgentExecution(agentId: string, durationSeconds: number): void {
    this.agentExecutionDuration.observe({ agent_id: agentId }, durationSeconds);
  }

  public updateSystemMetrics(): void {
    const memUsage = process.memoryUsage();
    this.memoryUsageGauge.set({ type: 'rss' }, memUsage.rss);
    this.memoryUsageGauge.set({ type: 'heap_total' }, memUsage.heapTotal);
    this.memoryUsageGauge.set({ type: 'heap_used' }, memUsage.heapUsed);
    this.memoryUsageGauge.set({ type: 'external' }, memUsage.external);

    const cpuUsage = process.cpuUsage();
    const totalCpu = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to seconds
    this.cpuUsageGauge.set(totalCpu);
  }

  public recordHttpRequest(method: string, route: string, statusCode: number, durationSeconds: number): void {
    this.httpRequestDuration.observe({ method, route, status_code: statusCode.toString() }, durationSeconds);
  }

  public recordHttpRequestError(method: string, route: string, errorType: string): void {
    this.httpRequestErrors.inc({ method, route, error_type: errorType });
  }

  public getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  public getContentType(): string {
    return this.registry.contentType;
  }

  public reset(): void {
    this.registry.resetMetrics();
  }
}

// Singleton instance
export const metrics = new MetricsCollector();

// System metrics collection loop
export function startSystemMetricsCollection(intervalMs = 30000): () => void {
  const interval = setInterval(() => {
    metrics.updateSystemMetrics();
    
    // Measure event loop lag
    const start = process.hrtime.bigint();
    setImmediate(() => {
      const lag = Number(process.hrtime.bigint() - start) / 1e9;
      metrics.eventLoopLagGauge.set(lag);
    });
  }, intervalMs);

  return () => clearInterval(interval);
}

// Decorator for timing function execution
export function timed(metricName: string, labels?: Record<string, string>) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const start = Date.now();
      try {
        const result = await originalMethod.apply(this, args);
        const duration = (Date.now() - start) / 1000;
        
        // Record based on metric name
        if (metricName === 'task') {
          metrics.taskDurationHistogram.observe({ ...(labels || {}), status: 'success' }, duration);
        } else if (metricName === 'workflow') {
          metrics.workflowDurationHistogram.observe({ ...(labels || {}) }, duration);
        } else if (metricName === 'skill') {
          metrics.skillExecutionDuration.observe({ ...(labels || {}) }, duration);
        } else if (metricName === 'db') {
          metrics.dbQueryDuration.observe({ ...(labels || {}) }, duration);
        }
        
        return result;
      } catch (error) {
        const duration = (Date.now() - start) / 1000;
        
        if (metricName === 'task') {
          metrics.taskDurationHistogram.observe({ ...(labels || {}), status: 'failed' }, duration);
        } else if (metricName === 'skill') {
          metrics.skillExecutionErrors.inc({ ...(labels || {}), error_type: (error as Error).name });
        } else if (metricName === 'db') {
          metrics.dbQueryErrors.inc({ ...(labels || {}), error_type: (error as Error).name });
        }
        
        throw error;
      }
    };

    return descriptor;
  };
}

export default metrics;
