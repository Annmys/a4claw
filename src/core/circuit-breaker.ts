import { EventEmitter } from 'events';
import logger from '../utils/logger.js';
import { metrics } from './metrics.js';

// ============================================================================
// Circuit Breaker Pattern Implementation
// ============================================================================

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold?: number;        // Number of failures before opening
  successThreshold?: number;        // Number of successes in HALF_OPEN to close
  timeout?: number;                 // Time in ms before attempting reset
  resetTimeout?: number;            // Alias for timeout
  halfOpenMaxCalls?: number;        // Max calls allowed in HALF_OPEN state
  monitorInterval?: number;         // Health check interval
  errorFilter?: (error: Error) => boolean;  // Filter which errors count as failures
}

export interface CircuitBreakerStats {
  state: CircuitBreakerState;
  failures: number;
  successes: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  totalCalls: number;
  totalFailures: number;
  totalSuccesses: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

export class CircuitBreakerError extends Error {
  constructor(
    message: string,
    public state: CircuitBreakerState,
    public readonly name: string
  ) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

export class CircuitOpenError extends CircuitBreakerError {
  constructor(name: string) {
    super(`Circuit breaker '${name}' is OPEN`, 'OPEN', name);
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker extends EventEmitter {
  private state: CircuitBreakerState = 'CLOSED';
  private failures = 0;
  private successes = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private totalCalls = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private halfOpenCalls = 0;
  private nextAttempt = 0;
  private monitorInterval?: NodeJS.Timeout;

  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly timeout: number;
  private readonly halfOpenMaxCalls: number;
  private readonly errorFilter?: (error: Error) => boolean;

  constructor(options: CircuitBreakerOptions) {
    super();
    
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.successThreshold = options.successThreshold ?? 3;
    this.timeout = options.timeout ?? options.resetTimeout ?? 60000;
    this.halfOpenMaxCalls = options.halfOpenMaxCalls ?? 3;
    this.errorFilter = options.errorFilter;

    this.startMonitoring(options.monitorInterval ?? 30000);
    
    logger.info('Circuit breaker initialized', {
      name: this.name,
      failureThreshold: this.failureThreshold,
      timeout: this.timeout,
    });
  }

  // Execute a function through the circuit breaker
  public async execute<T>(
    fn: () => Promise<T>,
    fallback?: () => T
  ): Promise<T> {
    const startTime = Date.now();
    
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        const remainingMs = this.nextAttempt - Date.now();
        
        if (fallback) {
          logger.warn('Circuit breaker open, using fallback', {
            name: this.name,
            remainingMs,
          });
          return fallback();
        }
        
        throw new CircuitBreakerError(
          `Circuit breaker '${this.name}' is OPEN. Retry after ${remainingMs}ms`,
          this.state,
          this.name
        );
      }
      
      this.transitionTo('HALF_OPEN');
    }

    if (this.state === 'HALF_OPEN' && this.halfOpenCalls >= this.halfOpenMaxCalls) {
      throw new CircuitBreakerError(
        `Circuit breaker '${this.name}' HALF_OPEN limit reached`,
        this.state,
        this.name
      );
    }

    if (this.state === 'HALF_OPEN') {
      this.halfOpenCalls++;
    }

    this.totalCalls++;

    try {
      const result = await fn();
      this.onSuccess();
      
      const duration = (Date.now() - startTime) / 1000;
      metrics?.recordSkillExecution?.('circuit_breaker', this.name, 'success', duration);
      
      return result;
    } catch (error) {
      const shouldCountAsFailure = !this.errorFilter || this.errorFilter(error as Error);
      
      if (shouldCountAsFailure) {
        this.onFailure();
      } else {
        // Error filtered out - don't count as failure but still throw
        logger.debug('Circuit breaker error filtered', {
          name: this.name,
          error: (error as Error).message,
        });
      }
      
      const duration = (Date.now() - startTime) / 1000;
      metrics?.recordSkillExecutionError?.('circuit_breaker', (error as Error).name);
      
      throw error;
    }
  }

  // Synchronous execution check
  public canExecute(): boolean {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'OPEN' && Date.now() >= this.nextAttempt) {
      return true;
    }
    if (this.state === 'HALF_OPEN' && this.halfOpenCalls < this.halfOpenMaxCalls) {
      return true;
    }
    return false;
  }

  private onSuccess(): void {
    this.successes++;
    this.totalSuccesses++;
    this.lastSuccessTime = Date.now();
    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;

    if (this.state === 'HALF_OPEN') {
      if (this.consecutiveSuccesses >= this.successThreshold) {
        this.transitionTo('CLOSED');
      }
    } else {
      this.failures = 0;
    }

    this.emit('success', { name: this.name, state: this.state });
  }

  private onFailure(): void {
    this.failures++;
    this.totalFailures++;
    this.lastFailureTime = Date.now();
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;

    if (this.state === 'HALF_OPEN') {
      this.transitionTo('OPEN');
    } else if (this.state === 'CLOSED' && this.failures >= this.failureThreshold) {
      this.transitionTo('OPEN');
    }

    this.emit('failure', { name: this.name, state: this.state, failures: this.failures });
  }

  private transitionTo(newState: CircuitBreakerState): void {
    const oldState = this.state;
    this.state = newState;

    if (newState === 'OPEN') {
      this.nextAttempt = Date.now() + this.timeout;
      this.failures = 0;
      this.halfOpenCalls = 0;
      
      logger.warn('Circuit breaker opened', {
        name: this.name,
        failureThreshold: this.failureThreshold,
        resetTimeout: this.timeout,
      });
    } else if (newState === 'HALF_OPEN') {
      this.halfOpenCalls = 0;
      this.consecutiveSuccesses = 0;
      
      logger.info('Circuit breaker half-open', { name: this.name });
    } else if (newState === 'CLOSED') {
      this.failures = 0;
      this.successes = 0;
      this.halfOpenCalls = 0;
      this.consecutiveSuccesses = 0;
      
      logger.info('Circuit breaker closed', { name: this.name });
    }

    this.emit('stateChange', { name: this.name, from: oldState, to: newState });
  }

  private startMonitoring(intervalMs: number): void {
    this.monitorInterval = setInterval(() => {
      this.checkHealth();
    }, intervalMs);
  }

  private checkHealth(): void {
    const stats = this.getStats();
    
    // Emit health status for external monitoring
    this.emit('health', {
      name: this.name,
      ...stats,
    });

    // Auto-transition from OPEN to HALF_OPEN if timeout has passed
    if (this.state === 'OPEN' && Date.now() >= this.nextAttempt) {
      logger.info('Circuit breaker timeout reached, transitioning to HALF_OPEN', {
        name: this.name,
      });
    }
  }

  public getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
    };
  }

  public getState(): CircuitBreakerState {
    return this.state;
  }

  public getName(): string {
    return this.name;
  }

  // Force open the circuit
  public forceOpen(): void {
    this.transitionTo('OPEN');
  }

  // Force close the circuit
  public forceClose(): void {
    this.transitionTo('CLOSED');
  }

  // Reset all stats
  public reset(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.totalCalls = 0;
    this.totalFailures = 0;
    this.totalSuccesses = 0;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.halfOpenCalls = 0;
    this.nextAttempt = 0;
    
    logger.info('Circuit breaker reset', { name: this.name });
    this.emit('reset', { name: this.name });
  }

  public destroy(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }
    this.removeAllListeners();
    logger.info('Circuit breaker destroyed', { name: this.name });
  }
}

// ============================================================================
// Circuit Breaker Registry
// ============================================================================

export class CircuitBreakerRegistry {
  private breakers = new Map<string, CircuitBreaker>();

  public getOrCreate(name: string, options?: Omit<CircuitBreakerOptions, 'name'>): CircuitBreaker {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker({ name, ...options }));
    }
    return this.breakers.get(name)!;
  }

  public get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  public has(name: string): boolean {
    return this.breakers.has(name);
  }

  public remove(name: string): boolean {
    const breaker = this.breakers.get(name);
    if (breaker) {
      breaker.destroy();
      return this.breakers.delete(name);
    }
    return false;
  }

  public getAll(): CircuitBreaker[] {
    return Array.from(this.breakers.values());
  }

  public getAllStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};
    for (const [name, breaker] of this.breakers) {
      stats[name] = breaker.getStats();
    }
    return stats;
  }

  public resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  public destroyAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.destroy();
    }
    this.breakers.clear();
  }
}

// Singleton instance
export const circuitBreakerRegistry = new CircuitBreakerRegistry();

// Helper function for wrapping async functions with circuit breaker
export function withCircuitBreaker<T>(
  name: string,
  fn: () => Promise<T>,
  options?: Omit<CircuitBreakerOptions, 'name'> & { fallback?: () => T }
): Promise<T> {
  const breaker = circuitBreakerRegistry.getOrCreate(name, options);
  return breaker.execute(fn, options?.fallback);
}

// Pre-configured circuit breakers for common operations
export const defaultCircuitBreakers = {
  database: () => circuitBreakerRegistry.getOrCreate('database', {
    failureThreshold: 5,
    timeout: 30000,
    errorFilter: (error) => {
      // Don't count connection errors that might be transient
      return !error.message?.includes('ECONNREFUSED');
    },
  }),
  
  externalAPI: () => circuitBreakerRegistry.getOrCreate('external_api', {
    failureThreshold: 3,
    timeout: 60000,
  }),
  
  aiService: () => circuitBreakerRegistry.getOrCreate('ai_service', {
    failureThreshold: 3,
    timeout: 120000,
    errorFilter: (error) => {
      // Rate limit errors should count but with different handling
      return !error.message?.includes('rate limit');
    },
  }),
  
  skillExecution: () => circuitBreakerRegistry.getOrCreate('skill_execution', {
    failureThreshold: 5,
    timeout: 300000, // 5 minutes
  }),
};

// Helper function to get or create a circuit breaker
export function getCircuitBreaker(name: string, options?: Omit<CircuitBreakerOptions, 'name'>): CircuitBreaker {
  return circuitBreakerRegistry.getOrCreate(name, options);
}

// Helper function to get all circuit breaker stats
export function getAllCircuitBreakerStats(): Record<string, CircuitBreakerStats> {
  return circuitBreakerRegistry.getAllStats();
}

export default CircuitBreaker;
