import Redis, { Cluster, RedisOptions } from 'ioredis';
import logger from '../utils/logger.js';
import { metrics } from './metrics.js';
import { CircuitBreaker } from './circuit-breaker.js';

// ============================================================================
// Redis Cluster Manager with Connection Pooling
// ============================================================================

export interface RedisClusterConfig {
  // Cluster nodes
  nodes?: Array<{ host: string; port: number }>;
  
  // Single node mode (fallback)
  host?: string;
  port?: number;
  
  // Connection options
  password?: string;
  db?: number;
  keyPrefix?: string;
  
  // Pool options
  maxRetriesPerRequest?: number;
  retryStrategy?: (times: number) => number | null;
  reconnectOnError?: (err: Error) => boolean;
  
  // Cluster specific
  enableOfflineQueue?: boolean;
  enableReadyCheck?: boolean;
  scaleReads?: 'master' | 'slave' | 'all';
  maxRedirections?: number;
  retryDelayOnFailover?: number;
  retryDelayOnClusterDown?: number;
  
  // Circuit breaker
  circuitBreakerEnabled?: boolean;
  circuitBreakerOptions?: {
    failureThreshold?: number;
    timeout?: number;
  };
}

export interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  version: number;
}

export class RedisClusterManager {
  private client: Redis | Cluster | null = null;
  private config: RedisClusterConfig;
  private circuitBreaker: CircuitBreaker | null = null;
  private isCluster = false;
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(config: RedisClusterConfig = {}) {
    this.config = {
      host: 'localhost',
      port: 6379,
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
      enableReadyCheck: true,
      scaleReads: 'slave',
      maxRedirections: 16,
      retryDelayOnFailover: 100,
      retryDelayOnClusterDown: 300,
      circuitBreakerEnabled: true,
      ...config,
    };

    if (this.config.circuitBreakerEnabled) {
      this.circuitBreaker = new CircuitBreaker({
        name: 'redis_cluster',
        failureThreshold: this.config.circuitBreakerOptions?.failureThreshold ?? 5,
        timeout: this.config.circuitBreakerOptions?.timeout ?? 30000,
      });
    }
  }

  public async connect(): Promise<void> {
    if (this.client) return;

    try {
      const isClusterMode = this.config.nodes && this.config.nodes.length > 0;
      this.isCluster = isClusterMode;

      const retryStrategy = this.config.retryStrategy ?? ((times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      });

      if (isClusterMode) {
        this.client = new Cluster(this.config.nodes!, {
          redisOptions: {
            password: this.config.password,
            maxRetriesPerRequest: this.config.maxRetriesPerRequest,
            retryStrategy,
            reconnectOnError: this.config.reconnectOnError,
          },
          scaleReads: this.config.scaleReads,
          maxRedirections: this.config.maxRedirections,
          retryDelayOnFailover: this.config.retryDelayOnFailover,
          retryDelayOnClusterDown: this.config.retryDelayOnClusterDown,
        });

        logger.info('Redis Cluster client created', { 
          nodes: this.config.nodes?.length,
          scaleReads: this.config.scaleReads,
        });
      } else {
        const options: RedisOptions = {
          host: this.config.host,
          port: this.config.port,
          password: this.config.password,
          db: this.config.db,
          keyPrefix: this.config.keyPrefix,
          maxRetriesPerRequest: this.config.maxRetriesPerRequest,
          retryStrategy,
          reconnectOnError: this.config.reconnectOnError,
          enableOfflineQueue: this.config.enableOfflineQueue,
        };

        this.client = new Redis(options);

        logger.info('Redis client created', { 
          host: this.config.host, 
          port: this.config.port,
        });
      }

      this.setupEventHandlers();
      this.startHealthChecks();

      // Wait for connection
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Redis connection timeout'));
        }, 10000);

        this.client!.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });

        this.client!.once('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      logger.info('Redis connected successfully');
    } catch (error) {
      logger.error('Failed to connect to Redis', { error });
      throw error;
    }
  }

  private setupEventHandlers(): void {
    if (!this.client) return;

    this.client.on('connect', () => {
      logger.info('Redis connected');
    });

    this.client.on('ready', () => {
      logger.info('Redis ready');
    });

    this.client.on('error', (err) => {
      logger.error('Redis error', { error: err.message });
      metrics?.recordSkillExecutionError?.('redis', err.name);
    });

    this.client.on('close', () => {
      logger.warn('Redis connection closed');
    });

    this.client.on('reconnecting', () => {
      logger.info('Redis reconnecting');
    });

    if (this.isCluster && this.client instanceof Cluster) {
      this.client.on('node error', (err, node) => {
        logger.error('Redis cluster node error', { 
          error: err.message, 
          node: `${node.options.host}:${node.options.port}`,
        });
      });

      this.client.on('error', (err) => {
        if (err.message.includes('too many redirections')) {
          logger.error('Redis cluster redirection limit exceeded');
        }
      });
    }
  }

  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        if (this.client) {
          const start = Date.now();
          await this.client.ping();
          const duration = (Date.now() - start) / 1000;
          
          metrics?.dbQueryDuration?.observe?.(
            { operation: 'ping', table: 'redis' },
            duration
          );
        }
      } catch (error) {
        logger.warn('Redis health check failed', { error });
      }
    }, 30000);
  }

  // Generic cache operations
  public async get<T>(key: string): Promise<T | null> {
    return this.executeWithCircuitBreaker(async () => {
      const data = await this.client!.get(key);
      if (!data) return null;
      
      try {
        const entry: CacheEntry<T> = JSON.parse(data);
        if (entry.expiresAt && entry.expiresAt < Date.now()) {
          await this.del(key);
          return null;
        }
        return entry.data;
      } catch {
        // Fallback for non-wrapped values
        return JSON.parse(data);
      }
    }, null);
  }

  public async set<T>(
    key: string, 
    value: T, 
    ttlSeconds?: number
  ): Promise<void> {
    return this.executeWithCircuitBreaker(async () => {
      const entry: CacheEntry<T> = {
        data: value,
        expiresAt: ttlSeconds ? Date.now() + (ttlSeconds * 1000) : 0,
        version: 1,
      };

      const serialized = JSON.stringify(entry);
      
      if (ttlSeconds) {
        await this.client!.setex(key, ttlSeconds, serialized);
      } else {
        await this.client!.set(key, serialized);
      }
    });
  }

  public async del(key: string): Promise<void> {
    return this.executeWithCircuitBreaker(async () => {
      await this.client!.del(key);
    });
  }

  public async exists(key: string): Promise<boolean> {
    return this.executeWithCircuitBreaker(async () => {
      const result = await this.client!.exists(key);
      return result === 1;
    }, false);
  }

  public async expire(key: string, seconds: number): Promise<void> {
    return this.executeWithCircuitBreaker(async () => {
      await this.client!.expire(key, seconds);
    });
  }

  // Hash operations
  public async hget<T>(key: string, field: string): Promise<T | null> {
    return this.executeWithCircuitBreaker(async () => {
      const data = await this.client!.hget(key, field);
      return data ? JSON.parse(data) : null;
    }, null);
  }

  public async hset<T>(key: string, field: string, value: T): Promise<void> {
    return this.executeWithCircuitBreaker(async () => {
      await this.client!.hset(key, field, JSON.stringify(value));
    });
  }

  public async hdel(key: string, field: string): Promise<void> {
    return this.executeWithCircuitBreaker(async () => {
      await this.client!.hdel(key, field);
    });
  }

  public async hgetall<T>(key: string): Promise<Record<string, T> | null> {
    return this.executeWithCircuitBreaker(async () => {
      const data = await this.client!.hgetall(key);
      if (!data || Object.keys(data).length === 0) return null;
      
      const result: Record<string, T> = {};
      for (const [field, value] of Object.entries(data)) {
        result[field] = JSON.parse(value);
      }
      return result;
    }, null);
  }

  // List operations
  public async lpush<T>(key: string, value: T): Promise<number> {
    return this.executeWithCircuitBreaker(async () => {
      return await this.client!.lpush(key, JSON.stringify(value));
    }, 0);
  }

  public async rpush<T>(key: string, value: T): Promise<number> {
    return this.executeWithCircuitBreaker(async () => {
      return await this.client!.rpush(key, JSON.stringify(value));
    }, 0);
  }

  public async lpop<T>(key: string): Promise<T | null> {
    return this.executeWithCircuitBreaker(async () => {
      const data = await this.client!.lpop(key);
      return data ? JSON.parse(data) : null;
    }, null);
  }

  public async rpop<T>(key: string): Promise<T | null> {
    return this.executeWithCircuitBreaker(async () => {
      const data = await this.client!.rpop(key);
      return data ? JSON.parse(data) : null;
    }, null);
  }

  public async lrange<T>(key: string, start: number, stop: number): Promise<T[]> {
    return this.executeWithCircuitBreaker(async () => {
      const data = await this.client!.lrange(key, start, stop);
      return data.map(item => JSON.parse(item));
    }, []);
  }

  // Set operations
  public async sadd<T>(key: string, value: T): Promise<number> {
    return this.executeWithCircuitBreaker(async () => {
      return await this.client!.sadd(key, JSON.stringify(value));
    }, 0);
  }

  public async srem<T>(key: string, value: T): Promise<number> {
    return this.executeWithCircuitBreaker(async () => {
      return await this.client!.srem(key, JSON.stringify(value));
    }, 0);
  }

  public async smembers<T>(key: string): Promise<T[]> {
    return this.executeWithCircuitBreaker(async () => {
      const data = await this.client!.smembers(key);
      return data.map(item => JSON.parse(item));
    }, []);
  }

  public async sismember<T>(key: string, value: T): Promise<boolean> {
    return this.executeWithCircuitBreaker(async () => {
      const result = await this.client!.sismember(key, JSON.stringify(value));
      return result === 1;
    }, false);
  }

  // Sorted set operations
  public async zadd(key: string, score: number, member: string): Promise<number> {
    return this.executeWithCircuitBreaker(async () => {
      return await this.client!.zadd(key, score, member);
    }, 0);
  }

  public async zrangebyscore(key: string, min: number, max: number): Promise<string[]> {
    return this.executeWithCircuitBreaker(async () => {
      return await this.client!.zrangebyscore(key, min, max);
    }, []);
  }

  public async zrem(key: string, member: string): Promise<number> {
    return this.executeWithCircuitBreaker(async () => {
      return await this.client!.zrem(key, member);
    }, 0);
  }

  // Pattern matching and bulk operations
  public async keys(pattern: string): Promise<string[]> {
    return this.executeWithCircuitBreaker(async () => {
      return await this.client!.keys(pattern);
    }, []);
  }

  public async mget<T>(keys: string[]): Promise<(T | null)[]> {
    return this.executeWithCircuitBreaker(async () => {
      const data = await this.client!.mget(keys);
      return data.map(item => {
        if (!item) return null;
        try {
          const entry: CacheEntry<T> = JSON.parse(item);
          return entry.data;
        } catch {
          return JSON.parse(item);
        }
      });
    }, keys.map(() => null));
  }

  public async mset(entries: Record<string, unknown>): Promise<void> {
    return this.executeWithCircuitBreaker(async () => {
      const pipeline = this.client!.pipeline();
      
      for (const [key, value] of Object.entries(entries)) {
        const entry: CacheEntry<unknown> = {
          data: value,
          expiresAt: 0,
          version: 1,
        };
        pipeline.set(key, JSON.stringify(entry));
      }
      
      await pipeline.exec();
    });
  }

  // Transaction support
  public async multi(operations: (pipeline: Redis.Pipeline) => void): Promise<void> {
    return this.executeWithCircuitBreaker(async () => {
      const pipeline = this.client!.multi();
      operations(pipeline);
      await pipeline.exec();
    });
  }

  // Pub/Sub
  public async publish(channel: string, message: unknown): Promise<number> {
    return this.executeWithCircuitBreaker(async () => {
      return await this.client!.publish(channel, JSON.stringify(message));
    }, 0);
  }

  public subscribe(channel: string, callback: (message: string) => void): void {
    // Create a separate subscriber connection
    const subscriber = this.isCluster 
      ? new Cluster(this.config.nodes!, { redisOptions: { password: this.config.password } })
      : new Redis({
          host: this.config.host,
          port: this.config.port,
          password: this.config.password,
        });

    subscriber.subscribe(channel);
    subscriber.on('message', (_, message) => {
      callback(message);
    });
  }

  // Distributed locking
  public async lock(lockKey: string, ttlSeconds: number): Promise<() => Promise<void>> {
    const token = `${Date.now()}-${Math.random()}`;
    
    const acquired = await this.executeWithCircuitBreaker(async () => {
      const result = await this.client!.set(lockKey, token, 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    }, false);

    if (!acquired) {
      throw new Error(`Failed to acquire lock: ${lockKey}`);
    }

    // Return unlock function
    return async () => {
      const current = await this.client!.get(lockKey);
      if (current === token) {
        await this.client!.del(lockKey);
      }
    };
  }

  // Rate limiting
  public async rateLimit(
    key: string, 
    maxRequests: number, 
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    return this.executeWithCircuitBreaker(async () => {
      const now = Math.floor(Date.now() / 1000);
      const windowStart = now - windowSeconds;

      // Remove old entries
      await this.client!.zremrangebyscore(key, 0, windowStart);

      // Count current requests
      const currentCount = await this.client!.zcard(key);

      if (currentCount >= maxRequests) {
        const oldest = await this.client!.zrange(key, 0, 0, 'WITHSCORES');
        const resetTime = parseInt(oldest[1]) + windowSeconds;
        return { allowed: false, remaining: 0, resetTime };
      }

      // Add current request
      await this.client!.zadd(key, now, `${now}-${Math.random()}`);
      await this.client!.expire(key, windowSeconds);

      return {
        allowed: true,
        remaining: maxRequests - currentCount - 1,
        resetTime: now + windowSeconds,
      };
    }, { allowed: false, remaining: 0, resetTime: 0 });
  }

  // Helper for circuit breaker wrapper
  private async executeWithCircuitBreaker<T>(
    fn: () => Promise<T>,
    fallback?: T
  ): Promise<T> {
    if (!this.circuitBreaker) {
      return fn();
    }

    return this.circuitBreaker.execute(fn, fallback);
  }

  // Info and stats
  public async getInfo(): Promise<Record<string, string>> {
    if (!this.client) return {};
    
    const info = await this.client.info();
    const result: Record<string, string> = {};
    
    for (const line of info.split('\r\n')) {
      const [key, value] = line.split(':');
      if (key && value) {
        result[key] = value;
      }
    }
    
    return result;
  }

  public getClient(): Redis | Cluster | null {
    return this.client;
  }

  public isConnected(): boolean {
    return this.client?.status === 'ready';
  }

  public async disconnect(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    if (this.circuitBreaker) {
      this.circuitBreaker.destroy();
    }

    if (this.client) {
      await this.client.quit();
      this.client = null;
      logger.info('Redis disconnected');
    }
  }
}

// Singleton instance
let redisManager: RedisClusterManager | null = null;

export function getRedisManager(config?: RedisClusterConfig): RedisClusterManager {
  if (!redisManager) {
    redisManager = new RedisClusterManager(config);
  }
  return redisManager;
}

export function resetRedisManager(): void {
  redisManager = null;
}

export default RedisClusterManager;
