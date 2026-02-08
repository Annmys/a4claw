import { promises as fs } from 'fs';
import path from 'path';
import YAML from 'yaml';
import logger from '../utils/logger.js';
import { MCPClient, MCPServerConfig, MCPTool } from './mcp-client.js';

interface MCPServersYAML {
  servers: Array<{
    id: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
}

export class MCPManager {
  private client: MCPClient;
  private configPath: string;
  private initialized = false;

  constructor(configPath?: string) {
    this.client = new MCPClient();
    this.configPath = configPath ?? path.resolve('config/mcp/servers.yaml');
  }

  async init(): Promise<void> {
    const configs = await this.loadServerConfigs();
    if (configs.length === 0) {
      logger.info('MCP Manager: no servers configured');
      this.initialized = true;
      return;
    }

    await this.client.init(configs);
    this.initialized = true;
    logger.info('MCP Manager initialized', {
      servers: this.client.getServerCount(),
      tools: this.client.getToolCount(),
    });
  }

  private async loadServerConfigs(): Promise<MCPServerConfig[]> {
    try {
      const content = await fs.readFile(this.configPath, 'utf-8');
      const yaml = YAML.parse(content) as MCPServersYAML;

      if (!yaml?.servers || !Array.isArray(yaml.servers)) return [];

      return yaml.servers
        .filter(s => s.id && s.command)
        .map(s => ({
          id: s.id,
          command: s.command,
          args: s.args,
          env: s.env,
        }));
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        logger.warn('Failed to load MCP server configs', { error: err.message });
      }
      return [];
    }
  }

  getClient(): MCPClient { return this.client; }

  getAllTools(): MCPTool[] { return this.client.getAllTools(); }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    return this.client.callTool(name, args);
  }

  async readResource(uri: string): Promise<string> {
    return this.client.readResource(uri);
  }

  getToolsSummary(): string { return this.client.getToolsSummary(); }

  getServerCount(): number { return this.client.getServerCount(); }
  getToolCount(): number { return this.client.getToolCount(); }
  isInitialized(): boolean { return this.initialized; }

  async shutdown(): Promise<void> {
    await this.client.shutdown();
  }

  /** Reload server configs from YAML and restart connections */
  async reload(): Promise<void> {
    await this.client.shutdown();
    this.client = new MCPClient();
    await this.init();
    logger.info('MCP Manager reloaded');
  }
}
