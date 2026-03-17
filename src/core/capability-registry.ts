import type { PluginLoader } from './plugin-loader.js';
import type { SkillsEngine, Skill } from './skills-engine.js';
import type { RAGEngine } from '../actions/rag/rag-engine.js';
import { getAgentRuntimeStatus, type AgentRuntimeLevel } from './agent-runtime.js';

export type CapabilityStatus = AgentRuntimeLevel;

export interface CapabilitySkillItem {
  id: string;
  name: string;
  description: string;
  trigger: string;
  prompt?: string;
  examples: string[];
  version: string;
  source: string;
  sourceLabel: string;
  type: 'skill' | 'plugin-tool';
  status: CapabilityStatus;
  editable: boolean;
  pluginName?: string;
  pluginVersion?: string;
  pluginAuthor?: string;
}

export interface CapabilitySubsystemState {
  status: CapabilityStatus;
  detail: string;
}

export interface CapabilitySnapshot {
  summary: {
    skills: number;
    pluginTools: number;
    plugins: number;
    loadedPlugins: number;
    ready: number;
    partial: number;
    blocked: number;
  };
  skills: CapabilitySkillItem[];
  subsystems: {
    plugins: CapabilitySubsystemState & {
      count: number;
      loadedCount: number;
      failedCount: number;
      items: Array<{
        name: string;
        version: string;
        author: string;
        description: string;
        loaded: boolean;
        error?: string;
        toolCount: number;
      }>;
    };
    memory: CapabilitySubsystemState & {
      documents: number;
      chunks: number;
    };
    openclaw: CapabilitySubsystemState;
  };
}

interface CapabilityRegistryDeps {
  skills: SkillsEngine;
  getPluginLoader?: () => PluginLoader | null;
  getRAGEngine?: () => RAGEngine | null;
  getProviders?: () => string[];
}

function formatSkillSource(skill: Skill): string {
  switch (skill.source) {
    case 'built-in':
      return '内置';
    case 'learned':
      return '学习生成';
    case 'user-created':
      return '用户创建';
    default:
      return skill.source;
  }
}

export class CapabilityRegistry {
  private skills: SkillsEngine;
  private getPluginLoader: () => PluginLoader | null;
  private getRAGEngine: () => RAGEngine | null;
  private getProviders: () => string[];

  constructor(deps: CapabilityRegistryDeps) {
    this.skills = deps.skills;
    this.getPluginLoader = deps.getPluginLoader ?? (() => null);
    this.getRAGEngine = deps.getRAGEngine ?? (() => null);
    this.getProviders = deps.getProviders ?? (() => []);
  }

  async getSnapshot(userId?: string): Promise<CapabilitySnapshot> {
    const pluginLoader = this.getPluginLoader();
    const ragEngine = this.getRAGEngine();
    const skillItems = this.buildSkillItems(pluginLoader);
    const pluginItems = pluginLoader?.getAllPlugins() ?? [];

    const pluginsState: CapabilitySnapshot['subsystems']['plugins'] = {
      status: pluginItems.length === 0
        ? 'partial'
        : pluginItems.every((plugin) => plugin.loaded)
          ? 'ready'
          : pluginItems.some((plugin) => plugin.loaded)
            ? 'partial'
            : 'blocked',
      detail: pluginItems.length === 0
        ? '当前未安装插件'
        : `共 ${pluginItems.length} 个插件，已加载 ${pluginItems.filter((plugin) => plugin.loaded).length} 个`,
      count: pluginItems.length,
      loadedCount: pluginLoader?.getLoadedCount() ?? 0,
      failedCount: pluginLoader?.getFailedCount() ?? 0,
      items: pluginItems.map((plugin) => ({
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        author: plugin.manifest.author,
        description: plugin.manifest.description,
        loaded: plugin.loaded,
        error: plugin.error,
        toolCount: plugin.manifest.tools?.length ?? 0,
      })),
    };

    const documents = userId && ragEngine ? ragEngine.listDocuments(userId).length : 0;
    const chunks = userId && ragEngine ? ragEngine.getChunkCount(userId) : 0;
    const memoryState: CapabilitySnapshot['subsystems']['memory'] = {
      status: ragEngine ? 'ready' : 'partial',
      detail: ragEngine
        ? documents > 0
          ? `当前用户已接入 ${documents} 份知识文档，${chunks} 个切片`
          : '记忆与知识库底座已接通，当前用户还没有导入文档'
        : '知识库引擎未挂载，只有基础会话记忆可用',
      documents,
      chunks,
    };

    const orchestratorStatus = await getAgentRuntimeStatus('orchestrator', this.getProviders());
    const openclawTool = orchestratorStatus.toolStatus.find((tool) => tool.name === 'openclaw');
    const openclawState: CapabilitySnapshot['subsystems']['openclaw'] = {
      status: openclawTool?.status ?? 'blocked',
      detail: openclawTool?.detail ?? '未检测到 OpenClaw 桥接能力',
    };

    const summary = skillItems.reduce((acc, item) => {
      acc[item.status] += 1;
      if (item.type === 'skill') acc.skills += 1;
      if (item.type === 'plugin-tool') acc.pluginTools += 1;
      return acc;
    }, {
      skills: 0,
      pluginTools: 0,
      plugins: pluginsState.count,
      loadedPlugins: pluginsState.loadedCount,
      ready: 0,
      partial: 0,
      blocked: 0,
    });

    return {
      summary,
      skills: skillItems,
      subsystems: {
        plugins: pluginsState,
        memory: memoryState,
        openclaw: openclawState,
      },
    };
  }

  async listSkills(userId?: string): Promise<CapabilitySkillItem[]> {
    const snapshot = await this.getSnapshot(userId);
    return snapshot.skills;
  }

  private buildSkillItems(pluginLoader: PluginLoader | null): CapabilitySkillItem[] {
    const skillItems: CapabilitySkillItem[] = this.skills.getAllSkills().map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      trigger: skill.trigger,
      prompt: skill.prompt,
      examples: skill.examples,
      version: String(skill.version),
      source: skill.source,
      sourceLabel: formatSkillSource(skill),
      type: 'skill',
      status: 'ready',
      editable: skill.source !== 'built-in',
    }));

    const pluginItems: CapabilitySkillItem[] = (pluginLoader?.getAllPlugins() ?? []).flatMap((plugin) =>
      (plugin.manifest.tools ?? []).map((tool) => ({
        id: `plugin:${plugin.manifest.name}:${tool.name}`,
        name: tool.name,
        description: tool.description,
        trigger: `插件工具 · ${plugin.manifest.name}`,
        examples: [],
        version: plugin.manifest.version,
        source: 'plugin',
        sourceLabel: `插件 · ${plugin.manifest.name}`,
        type: 'plugin-tool' as const,
        status: plugin.loaded ? 'ready' : 'blocked',
        editable: false,
        pluginName: plugin.manifest.name,
        pluginVersion: plugin.manifest.version,
        pluginAuthor: plugin.manifest.author,
      })),
    );

    return [...skillItems, ...pluginItems];
  }
}
