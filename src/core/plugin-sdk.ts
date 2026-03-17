import { EventEmitter } from 'events';
import { z } from 'zod';
import logger from '../utils/logger.js';
import { metrics } from './metrics.js';

// ============================================================================
// Plugin SDK Architecture
// ============================================================================

// Plugin manifest schema
export const PluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9-_]+$/),
  name: z.string().min(1).max(100),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().max(500),
  author: z.string(),
  license: z.string(),
  
  // Runtime requirements
  runtime: z.object({
    nodeVersion: z.string().optional(),
    memoryLimit: z.number().default(128), // MB
    timeout: z.number().default(30000), // ms
  }).default({}),
  
  // Plugin type
  type: z.enum(['skill', 'tool', 'handler', 'middleware', 'integration']).default('skill'),
  
  // Entry points
  entry: z.object({
    main: z.string().default('index.js'),
    config: z.string().optional(),
  }).default({}),
  
  // Permissions
  permissions: z.array(z.enum([
    'database:read',
    'database:write',
    'filesystem:read',
    'filesystem:write',
    'network:external',
    'system:execute',
    'ai:generate',
    'memory:read',
    'memory:write',
  ])).default([]),
  
  // Dependencies
  dependencies: z.record(z.string()).default({}),
  
  // Configuration schema
  configSchema: z.record(z.any()).optional(),
  
  // UI components
  ui: z.object({
    hasConfigPanel: z.boolean().default(false),
    hasDashboard: z.boolean().default(false),
    hasToolbar: z.boolean().default(false),
  }).default({}),
  
  // Hooks
  hooks: z.array(z.enum([
    'before:task',
    'after:task',
    'before:message',
    'after:message',
    'on:startup',
    'on:shutdown',
    'on:error',
  ])).default([]),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

// Plugin context passed to plugins
export interface PluginContext {
  // Core services
  database: {
    query: (sql: string, params?: unknown[]) => Promise<unknown>;
    transaction: <T>(fn: (client: unknown) => Promise<T>) => Promise<T>;
  };
  cache: {
    get: <T>(key: string) => Promise<T | null>;
    set: <T>(key: string, value: T, ttl?: number) => Promise<void>;
    del: (key: string) => Promise<void>;
  };
  ai: {
    generate: (prompt: string, options?: unknown) => Promise<string>;
    embed: (text: string) => Promise<number[]>;
  };
  logger: {
    info: (message: string, meta?: unknown) => void;
    warn: (message: string, meta?: unknown) => void;
    error: (message: string, meta?: unknown) => void;
    debug: (message: string, meta?: unknown) => void;
  };
  
  // Plugin info
  pluginId: string;
  config: Record<string, unknown>;
  
  // Event bus
  events: EventEmitter;
  
  // Utilities
  utils: {
    validate: <T>(schema: z.ZodSchema<T>, data: unknown) => T;
    fetch: (url: string, options?: RequestInit) => Promise<Response>;
    sleep: (ms: number) => Promise<void>;
  };
}

// Plugin interface
export interface Plugin {
  manifest: PluginManifest;
  context: PluginContext;
  
  // Lifecycle
  initialize: () => Promise<void>;
  shutdown: () => Promise<void>;
  
  // Execution
  execute: (input: unknown) => Promise<unknown>;
  
  // Configuration
  validateConfig: (config: unknown) => boolean;
  updateConfig: (config: Record<string, unknown>) => Promise<void>;
}

// Plugin sandbox configuration
export interface SandboxConfig {
  maxMemoryMB: number;
  maxExecutionTimeMs: number;
  allowedModules: string[];
  blockedModules: string[];
  allowFileSystem: boolean;
  allowNetwork: boolean;
  allowChildProcess: boolean;
}

// ============================================================================
// Plugin Sandbox
// ============================================================================

export class PluginSandbox extends EventEmitter {
  private manifest: PluginManifest;
  private config: SandboxConfig;
  private context: PluginContext;
  private isRunning = false;
  private startTime = 0;
  private memoryUsage = 0;

  constructor(
    manifest: PluginManifest,
    context: PluginContext,
    config?: Partial<SandboxConfig>
  ) {
    super();
    this.manifest = manifest;
    this.context = context;
    this.config = {
      maxMemoryMB: manifest.runtime.memoryLimit,
      maxExecutionTimeMs: manifest.runtime.timeout,
      allowedModules: [],
      blockedModules: ['child_process', 'cluster', 'dgram', 'dns', 'fs', 'net', 'os', 'process', 'repl'],
      allowFileSystem: manifest.permissions.includes('filesystem:read') || manifest.permissions.includes('filesystem:write'),
      allowNetwork: manifest.permissions.includes('network:external'),
      allowChildProcess: manifest.permissions.includes('system:execute'),
      ...config,
    };
  }

  public async execute(input: unknown): Promise<unknown> {
    if (!this.isRunning) {
      throw new Error('Plugin not initialized');
    }

    const startTime = Date.now();
    
    try {
      // Set up timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Plugin execution timeout after ${this.config.maxExecutionTimeMs}ms`));
        }, this.config.maxExecutionTimeMs);
      });

      // Execute plugin logic
      const executionPromise = this.runInSandbox(input);
      
      const result = await Promise.race([executionPromise, timeoutPromise]);
      
      const duration = Date.now() - startTime;
      metrics?.recordSkillExecution?.(
        this.manifest.id,
        this.manifest.name,
        'success',
        duration / 1000
      );

      this.emit('success', { input, result, duration });
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      metrics?.recordSkillExecutionError?.(this.manifest.id, (error as Error).name);
      
      this.emit('error', { input, error, duration });
      throw this.wrapError(error as Error);
    }
  }

  private async runInSandbox(input: unknown): Promise<unknown> {
    // This is a simplified sandbox - in production, use vm2 or worker threads
    // with proper isolation
    
    const sandbox = {
      context: this.context,
      input,
      console: this.createSandboxedConsole(),
      setTimeout: (fn: Function, ms: number) => {
        if (ms > this.config.maxExecutionTimeMs) {
          throw new Error('Timeout exceeds maximum allowed');
        }
        return setTimeout(fn, ms);
      },
      setInterval: () => {
        throw new Error('setInterval is not allowed in plugins');
      },
    };

    // Load and execute plugin code
    // In production, this would use vm.runInNewContext or similar
    return this.executePluginCode(sandbox);
  }

  private createSandboxedConsole() {
    return {
      log: (...args: unknown[]) => this.context.logger.info(args.join(' ')),
      info: (...args: unknown[]) => this.context.logger.info(args.join(' ')),
      warn: (...args: unknown[]) => this.context.logger.warn(args.join(' ')),
      error: (...args: unknown[]) => this.context.logger.error(args.join(' ')),
    };
  }

  private async executePluginCode(sandbox: Record<string, unknown>): Promise<unknown> {
    // Placeholder for actual plugin execution
    // In production, this would:
    // 1. Load plugin code from file
    // 2. Compile it
    // 3. Run in isolated context
    // 4. Return result
    
    throw new Error('Plugin execution not implemented - use Worker threads in production');
  }

  private wrapError(error: Error): Error {
    return new Error(
      `Plugin '${this.manifest.name}' (${this.manifest.id}) error: ${error.message}`
    );
  }

  public async initialize(): Promise<void> {
    this.isRunning = true;
    this.startTime = Date.now();
    this.emit('initialized');
    
    logger.info('Plugin sandbox initialized', {
      pluginId: this.manifest.id,
      name: this.manifest.name,
    });
  }

  public async shutdown(): Promise<void> {
    this.isRunning = false;
    this.emit('shutdown');
    
    logger.info('Plugin sandbox shutdown', {
      pluginId: this.manifest.id,
      uptime: Date.now() - this.startTime,
    });
  }

  public getStats(): {
    isRunning: boolean;
    uptime: number;
    memoryUsage: number;
  } {
    return {
      isRunning: this.isRunning,
      uptime: Date.now() - this.startTime,
      memoryUsage: this.memoryUsage,
    };
  }
}

// ============================================================================
// Plugin Manager
// ============================================================================

export class PluginManager extends EventEmitter {
  private plugins = new Map<string, { manifest: PluginManifest; sandbox: PluginSandbox }>();
  private hooks = new Map<string, Array<(pluginId: string, data: unknown) => Promise<void> | void>>();

  public async loadPlugin(
    manifest: PluginManifest,
    context: PluginContext
  ): Promise<void> {
    // Validate manifest
    const validation = PluginManifestSchema.safeParse(manifest);
    if (!validation.success) {
      throw new Error(`Invalid plugin manifest: ${validation.error.message}`);
    }

    if (this.plugins.has(manifest.id)) {
      throw new Error(`Plugin '${manifest.id}' is already loaded`);
    }

    // Create sandbox
    const sandbox = new PluginSandbox(manifest, context);
    
    // Initialize
    await sandbox.initialize();

    this.plugins.set(manifest.id, { manifest, sandbox });
    
    // Register hooks
    for (const hook of manifest.hooks) {
      this.registerHook(hook, manifest.id);
    }

    this.emit('plugin:loaded', { pluginId: manifest.id, manifest });
    
    logger.info('Plugin loaded', {
      pluginId: manifest.id,
      name: manifest.name,
      version: manifest.version,
    });
  }

  public async unloadPlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin '${pluginId}' not found`);
    }

    await plugin.sandbox.shutdown();
    this.plugins.delete(pluginId);

    this.emit('plugin:unloaded', { pluginId });
    
    logger.info('Plugin unloaded', { pluginId });
  }

  public async executePlugin(pluginId: string, input: unknown): Promise<unknown> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin '${pluginId}' not found`);
    }

    return plugin.sandbox.execute(input);
  }

  private registerHook(hook: string, pluginId: string): void {
    if (!this.hooks.has(hook)) {
      this.hooks.set(hook, []);
    }

    this.hooks.get(hook)!.push(async (data: unknown) => {
      const plugin = this.plugins.get(pluginId);
      if (plugin) {
        await plugin.sandbox.execute({ hook, data });
      }
    });
  }

  public async triggerHook(hook: string, data: unknown): Promise<void> {
    const handlers = this.hooks.get(hook) || [];
    
    await Promise.all(
      handlers.map(async (handler) => {
        try {
          await handler('', data);
        } catch (error) {
          logger.error('Hook handler failed', { hook, error });
        }
      })
    );
  }

  public getPlugin(pluginId: string): PluginManifest | undefined {
    return this.plugins.get(pluginId)?.manifest;
  }

  public getAllPlugins(): PluginManifest[] {
    return Array.from(this.plugins.values()).map(p => p.manifest);
  }

  public getPluginStats(pluginId: string): ReturnType<PluginSandbox['getStats']> | null {
    return this.plugins.get(pluginId)?.sandbox.getStats() || null;
  }

  public async shutdown(): Promise<void> {
    await Promise.all(
      Array.from(this.plugins.keys()).map(id => this.unloadPlugin(id))
    );
  }
}

// ============================================================================
// Plugin Marketplace Types
// ============================================================================

export interface MarketplacePlugin {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  downloads: number;
  rating: number;
  tags: string[];
  price: number; // 0 = free
  manifestUrl: string;
  iconUrl?: string;
  screenshots?: string[];
  readme?: string;
  changelog?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PluginMarketplace {
  search: (query: string, filters?: { tags?: string[]; type?: string }) => Promise<MarketplacePlugin[]>;
  getById: (id: string) => Promise<MarketplacePlugin | null>;
  install: (id: string) => Promise<void>;
  uninstall: (id: string) => Promise<void>;
  update: (id: string) => Promise<void>;
  getInstalled: () => Promise<MarketplacePlugin[]>;
  getUpdates: () => Promise<MarketplacePlugin[]>;
}

// ============================================================================
// Simple File-based Plugin Marketplace
// ============================================================================

export class FileBasedMarketplace implements PluginMarketplace {
  private pluginsDir: string;
  private registryFile: string;

  constructor(pluginsDir = './data/plugins', registryFile = './data/marketplace.json') {
    this.pluginsDir = pluginsDir;
    this.registryFile = registryFile;
  }

  async search(query: string, filters?: { tags?: string[]; type?: string }): Promise<MarketplacePlugin[]> {
    const registry = await this.loadRegistry();
    
    return registry.filter(plugin => {
      const matchesQuery = !query || 
        plugin.name.toLowerCase().includes(query.toLowerCase()) ||
        plugin.description.toLowerCase().includes(query.toLowerCase());
      
      const matchesTags = !filters?.tags || filters.tags.every(tag => plugin.tags.includes(tag));
      const matchesType = !filters?.type; // Type filtering would need manifest access
      
      return matchesQuery && matchesTags && matchesType;
    });
  }

  async getById(id: string): Promise<MarketplacePlugin | null> {
    const registry = await this.loadRegistry();
    return registry.find(p => p.id === id) || null;
  }

  async install(id: string): Promise<void> {
    const plugin = await this.getById(id);
    if (!plugin) {
      throw new Error(`Plugin '${id}' not found in marketplace`);
    }

    // Download and install logic here
    logger.info('Installing plugin from marketplace', { pluginId: id });
  }

  async uninstall(id: string): Promise<void> {
    logger.info('Uninstalling plugin', { pluginId: id });
  }

  async update(id: string): Promise<void> {
    logger.info('Updating plugin', { pluginId: id });
  }

  async getInstalled(): Promise<MarketplacePlugin[]> {
    return [];
  }

  async getUpdates(): Promise<MarketplacePlugin[]> {
    return [];
  }

  private async loadRegistry(): Promise<MarketplacePlugin[]> {
    try {
      const { readFileSync } = await import('fs');
      const data = readFileSync(this.registryFile, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }
}

// Singleton instances
export const pluginManager = new PluginManager();
export const marketplace = new FileBasedMarketplace();

export default PluginManager;
