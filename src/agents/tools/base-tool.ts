import logger from '../../utils/logger.js';

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  artifacts?: Array<{
    id: string;
    name: string;
    originalName: string;
    mime: string;
    size: number;
    path: string;
    url: string;
    userKey: string;
    createdAt: string;
  }>;
}

export abstract class BaseTool {
  abstract name: string;
  abstract description: string;

  abstract execute(input: Record<string, unknown>): Promise<ToolResult>;

  protected log(message: string, meta?: Record<string, unknown>) {
    logger.info(`[Tool:${this.name}] ${message}`, meta);
  }

  protected error(message: string, meta?: Record<string, unknown>) {
    logger.error(`[Tool:${this.name}] ${message}`, meta);
  }
}
