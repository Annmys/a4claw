import { Pool, PoolClient, QueryResult } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import logger from '../utils/logger.js';
import { metrics } from './metrics.js';
import { CircuitBreaker } from './circuit-breaker.js';

// ============================================================================
// Enhanced Database Connection Pooling
// ============================================================================

export interface DatabaseConfig {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean | { rejectUnauthorized: boolean };
  
  // Pool configuration
  maxConnections?: number;          // Maximum number of clients in the pool
  minConnections?: number;          // Minimum number of clients in the pool
  acquireTimeoutMillis?: number;    // Maximum time to wait for a client
  idleTimeoutMillis?: number;       // Time a client can be idle before being closed
  connectionTimeoutMillis?: number; // Time to wait for a connection
  statementTimeout?: number;        // Query statement timeout
  queryTimeout?: number;            // Query execution timeout
  
  // Retry configuration
  maxRetries?: number;
  retryDelayMs?: number;
  
  // Health check
  healthCheckIntervalMs?: number;
  
  // Circuit breaker
  circuitBreakerEnabled?: boolean;
}

export interface QueryMetrics {
  sql: string;
  duration: number;
  rows: number;
}

export class DatabasePoolManager {
  private pool: Pool | null = null;
  private db: NodePgDatabase | null = null;
  private config: Required<DatabaseConfig>;
  private circuitBreaker: CircuitBreaker | null = null;
  private healthCheckInterval?: NodeJS.Timeout;
  private queryMetrics: QueryMetrics[] = [];
  private metricsRetentionCount = 1000;

  constructor(config: DatabaseConfig = {}) {
    this.config = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'a4claw',
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '20'),
      minConnections: parseInt(process.env.DB_MIN_CONNECTIONS || '5'),
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 300000,
      connectionTimeoutMillis: 5000,
      statementTimeout: 60000,
      queryTimeout: 30000,
      maxRetries: 3,
      retryDelayMs: 1000,
      healthCheckIntervalMs: 30000,
      circuitBreakerEnabled: true,
      ...config,
    };

    if (this.config.circuitBreakerEnabled) {
      this.circuitBreaker = new CircuitBreaker({
        name: 'database',
        failureThreshold: 5,
        timeout: 60000,
        errorFilter: (error) => {
          // Don't count connection errors as failures for circuit breaker
          return !error.message?.includes('ECONNREFUSED');
        },
      });
    }
  }

  public async initialize(): Promise<void> {
    if (this.pool) return;

    try {
      this.pool = new Pool({
        host: this.config.host,
        port: this.config.port,
        user: this.config.user,
        password: this.config.password,
        database: this.config.database,
        ssl: this.config.ssl,
        max: this.config.maxConnections,
        min: this.config.minConnections,
        acquireTimeoutMillis: this.config.acquireTimeoutMillis,
        idleTimeoutMillis: this.config.idleTimeoutMillis,
        connectionTimeoutMillis: this.config.connectionTimeoutMillis,
        statement_timeout: this.config.statementTimeout,
        query_timeout: this.config.queryTimeout,
      });

      this.setupPoolEventHandlers();
      this.startHealthChecks();

      // Test connection
      const client = await this.pool.connect();
      const result = await client.query('SELECT NOW()');
      client.release();

      logger.info('Database pool initialized', {
        host: this.config.host,
        database: this.config.database,
        maxConnections: this.config.maxConnections,
        minConnections: this.config.minConnections,
        serverTime: result.rows[0].now,
      });

      // Initialize Drizzle
      this.db = drizzle(this.pool);
    } catch (error) {
      logger.error('Failed to initialize database pool', { error });
      throw error;
    }
  }

  private setupPoolEventHandlers(): void {
    if (!this.pool) return;

    this.pool.on('connect', () => {
      logger.debug('New database connection established');
      metrics?.dbConnectionsGauge?.set?.(this.getActiveConnections());
    });

    this.pool.on('acquire', () => {
      metrics?.dbConnectionsGauge?.set?.(this.getActiveConnections());
    });

    this.pool.on('remove', () => {
      logger.debug('Database connection removed from pool');
      metrics?.dbConnectionsGauge?.set?.(this.getActiveConnections());
    });

    this.pool.on('error', (err, client) => {
      logger.error('Unexpected database pool error', { 
        error: err.message,
        client: client?.processID,
      });
      metrics?.dbQueryErrors?.inc?.({ operation: 'pool', error_type: err.name });
    });
  }

  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.healthCheck();
      } catch (error) {
        logger.warn('Database health check failed', { error });
      }
    }, this.config.healthCheckIntervalMs);
  }

  public async healthCheck(): Promise<boolean> {
    if (!this.pool) return false;

    const start = Date.now();
    try {
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();
      
      const duration = (Date.now() - start) / 1000;
      metrics?.dbQueryDuration?.observe?.(
        { operation: 'health_check', table: 'system' },
        duration
      );
      
      return true;
    } catch (error) {
      logger.error('Database health check failed', { error });
      return false;
    }
  }

  // Execute query with retry logic
  public async query<T = any>(
    sql: string, 
    params?: unknown[],
    options?: { timeout?: number }
  ): Promise<QueryResult<T>> {
    const startTime = Date.now();
    const operation = sql.trim().split(' ')[0].toLowerCase();

    const executeQuery = async (): Promise<QueryResult<T>> => {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      const client = await this.pool.connect();
      try {
        const queryStart = Date.now();
        const result = await client.query<T>(sql, params);
        const duration = (Date.now() - queryStart) / 1000;

        // Record metrics
        this.recordQueryMetrics({ sql, duration, rows: result.rowCount || 0 });
        metrics?.dbQueryDuration?.observe?.(
          { operation, table: this.extractTableName(sql) },
          duration
        );

        return result;
      } finally {
        client.release();
      }
    };

    try {
      if (this.circuitBreaker) {
        return await this.circuitBreaker.execute(executeQuery);
      }
      return await executeQuery();
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      metrics?.dbQueryErrors?.inc?.({ operation, error_type: (error as Error).name });
      
      logger.error('Database query failed', {
        error: (error as Error).message,
        sql: sql.substring(0, 200),
        duration,
      });
      
      throw error;
    }
  }

  // Execute with automatic retry
  public async queryWithRetry<T = any>(
    sql: string,
    params?: unknown[],
    options?: { maxRetries?: number; retryDelayMs?: number }
  ): Promise<QueryResult<T>> {
    const maxRetries = options?.maxRetries ?? this.config.maxRetries;
    const retryDelayMs = options?.retryDelayMs ?? this.config.retryDelayMs;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.query<T>(sql, params);
      } catch (error) {
        lastError = error as Error;
        
        // Don't retry on certain errors
        if (this.isNonRetryableError(lastError)) {
          throw lastError;
        }

        if (attempt < maxRetries) {
          logger.warn(`Query failed, retrying (${attempt}/${maxRetries})`, {
            error: lastError.message,
            sql: sql.substring(0, 100),
          });
          await this.delay(retryDelayMs * attempt);
        }
      }
    }

    throw lastError;
  }

  // Transaction support with automatic retry
  public async withTransaction<T>(
    fn: (client: PoolClient) => Promise<T>,
    options?: { maxRetries?: number; isolationLevel?: string }
  ): Promise<T> {
    const maxRetries = options?.maxRetries ?? this.config.maxRetries;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const client = await this.pool!.connect();
      
      try {
        await client.query('BEGIN');
        
        if (options?.isolationLevel) {
          await client.query(`SET TRANSACTION ISOLATION LEVEL ${options.isolationLevel}`);
        }

        const result = await fn(client);
        await client.query('COMMIT');
        
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        
        if (attempt === maxRetries || this.isNonRetryableError(error as Error)) {
          throw error;
        }
        
        logger.warn(`Transaction failed, retrying (${attempt}/${maxRetries})`, {
          error: (error as Error).message,
        });
        
        await this.delay(this.config.retryDelayMs * attempt);
      } finally {
        client.release();
      }
    }

    throw new Error('Transaction retry exhausted');
  }

  // Batch insert with optimized query
  public async batchInsert<T extends Record<string, unknown>>(
    table: string,
    records: T[],
    options?: { chunkSize?: number; onConflict?: string }
  ): Promise<void> {
    if (records.length === 0) return;

    const chunkSize = options?.chunkSize ?? 1000;
    const chunks = this.chunkArray(records, chunkSize);

    for (const chunk of chunks) {
      const columns = Object.keys(chunk[0]);
      const placeholders: string[] = [];
      const values: unknown[] = [];
      let valueIndex = 1;

      for (const record of chunk) {
        const recordPlaceholders = columns.map(() => `$${valueIndex++}`);
        placeholders.push(`(${recordPlaceholders.join(', ')})`);
        values.push(...columns.map(col => record[col]));
      }

      const sql = `
        INSERT INTO ${table} (${columns.join(', ')})
        VALUES ${placeholders.join(', ')}
        ${options?.onConflict || ''}
      `;

      await this.queryWithRetry(sql, values);
    }
  }

  // Connection management
  public async acquireConnection(): Promise<PoolClient> {
    if (!this.pool) {
      throw new Error('Database pool not initialized');
    }
    return this.pool.connect();
  }

  public releaseConnection(client: PoolClient): void {
    client.release();
  }

  // Pool statistics
  public getPoolStats(): {
    total: number;
    idle: number;
    waiting: number;
  } {
    if (!this.pool) {
      return { total: 0, idle: 0, waiting: 0 };
    }

    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
    };
  }

  public getActiveConnections(): number {
    const stats = this.getPoolStats();
    return stats.total - stats.idle;
  }

  // Get Drizzle instance
  public getDrizzle(): NodePgDatabase {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  // Get raw pool for advanced operations
  public getPool(): Pool {
    if (!this.pool) {
      throw new Error('Database pool not initialized');
    }
    return this.pool;
  }

  // Query metrics
  private recordQueryMetrics(metrics: QueryMetrics): void {
    this.queryMetrics.push(metrics);
    
    if (this.queryMetrics.length > this.metricsRetentionCount) {
      this.queryMetrics = this.queryMetrics.slice(-this.metricsRetentionCount);
    }
  }

  public getQueryMetrics(): QueryMetrics[] {
    return [...this.queryMetrics];
  }

  public getSlowQueries(thresholdMs: number = 1000): QueryMetrics[] {
    return this.queryMetrics.filter(m => m.duration > thresholdMs / 1000);
  }

  // Helper methods
  private isNonRetryableError(error: Error): boolean {
    const nonRetryableCodes = [
      '23505', // unique_violation
      '23503', // foreign_key_violation
      '23502', // not_null_violation
      '22P02', // invalid_text_representation
      '42601', // syntax_error
    ];

    const code = (error as any).code;
    return nonRetryableCodes.includes(code);
  }

  private extractTableName(sql: string): string {
    const match = sql.match(/(?:from|into|update|join)\s+(\w+)/i);
    return match?.[1] || 'unknown';
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Cleanup
  public async close(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    if (this.circuitBreaker) {
      this.circuitBreaker.destroy();
    }

    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.db = null;
      logger.info('Database pool closed');
    }
  }
}

// Singleton instance
let dbPoolManager: DatabasePoolManager | null = null;

export function getDatabasePoolManager(config?: DatabaseConfig): DatabasePoolManager {
  if (!dbPoolManager) {
    dbPoolManager = new DatabasePoolManager(config);
  }
  return dbPoolManager;
}

export function resetDatabasePoolManager(): void {
  dbPoolManager = null;
}

export default DatabasePoolManager;
