export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: 'opus' | 'sonnet' | 'haiku' | 'dynamic' | 'ollama';
  preferredOllamaModel?: string;  // e.g. 'glm5', 'qwen3-next', 'deepseek-v3.1'
  tools: string[];
  maxTokens: number;
  temperature: number;
  maxToolIterations?: number;
}
