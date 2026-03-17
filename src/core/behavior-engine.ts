import { promises as fs } from 'fs';
import path from 'path';
import logger from '../utils/logger.js';

export interface Behavior {
  id: string;
  name: string;
  description: string;
  systemPromptFragment: string;
  language?: string;
}

const BEHAVIORS_DIR = path.resolve('config/behaviors');

const HEBREW_REGEX = /[\u0590-\u05FF]/;
const ARABIC_REGEX = /[\u0600-\u06FF]/;
const CYRILLIC_REGEX = /[\u0400-\u04FF]/;
const CJK_REGEX = /[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]/;

export class BehaviorEngine {
  private behaviors: Map<string, Behavior> = new Map();
  private initialized = false;

  async init(): Promise<void> {
    await this.loadBuiltInBehaviors();
    await this.loadFromDisk();
    this.initialized = true;
    logger.info(`Behavior engine initialized: ${this.behaviors.size} behaviors`);
  }

  private loadBuiltInBehaviors(): void {
    const builtIn: Behavior[] = [
      {
        id: 'professional',
        name: 'Professional',
        description: 'Clear, concise, business-appropriate responses',
        systemPromptFragment: 'Be professional and concise. Use clear language. Avoid slang and emojis unless the user uses them first.',
      },
      {
        id: 'friendly',
        name: 'Friendly',
        description: 'Warm, approachable, casual tone',
        systemPromptFragment: 'Be warm and approachable. Use a conversational tone. You can use casual language and occasional humor.',
      },
      {
        id: 'technical',
        name: 'Technical',
        description: 'Precise, detailed technical responses',
        systemPromptFragment: 'Be precise and technical. Include relevant details, commands, and code snippets. Explain trade-offs when applicable.',
      },
      {
        id: 'cautious',
        name: 'Cautious',
        description: 'Extra careful with destructive operations',
        systemPromptFragment: 'Be extra careful with destructive operations. Always confirm before deleting, overwriting, or modifying critical systems. Double-check commands before execution.',
      },
      {
        id: 'strategic',
        name: 'Strategic',
        description: 'High-level planning and coordination focus',
        systemPromptFragment: 'Think strategically. Consider the big picture and long-term implications. Break complex tasks into phases and prioritize effectively.',
      },
      {
        id: 'precise',
        name: 'Precise',
        description: 'Exact, no-ambiguity responses',
        systemPromptFragment: 'Be exact and unambiguous. Every piece of information should be verifiable. Avoid vague language.',
      },
      {
        id: 'thorough',
        name: 'Thorough',
        description: 'Comprehensive, detailed analysis',
        systemPromptFragment: 'Be thorough in your analysis. Cover edge cases, potential issues, and alternatives. Provide complete solutions.',
      },
      {
        id: 'chinese-priority',
        name: 'Chinese Priority',
        description: 'Uses Simplified Chinese by default unless the user is clearly writing in English',
        language: 'zh',
        systemPromptFragment: 'Respond in Simplified Chinese by default. Use English only when the user is clearly writing in English. Use only Simplified Chinese or English.',
      },
    ];

    for (const b of builtIn) {
      this.behaviors.set(b.id, b);
    }
  }

  private async loadFromDisk(): Promise<void> {
    try {
      await fs.mkdir(BEHAVIORS_DIR, { recursive: true });
      const files = await fs.readdir(BEHAVIORS_DIR);

      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        try {
          const content = await fs.readFile(path.join(BEHAVIORS_DIR, file), 'utf-8');
          const behavior = this.parseMarkdownBehavior(file, content);
          if (behavior) {
            this.behaviors.set(behavior.id, behavior);
          }
        } catch (err: any) {
          logger.warn(`Failed to load behavior: ${file}`, { error: err.message });
        }
      }
    } catch { /* directory may not exist */ }
  }

  private parseMarkdownBehavior(filename: string, content: string): Behavior | null {
    const id = filename.replace('.md', '');
    const lines = content.split('\n');

    let name = id;
    let description = '';
    let language: string | undefined;
    const promptLines: string[] = [];
    let inFrontmatter = false;
    let pastFrontmatter = false;

    for (const line of lines) {
      if (line.trim() === '---' && !pastFrontmatter) {
        if (inFrontmatter) {
          pastFrontmatter = true;
          inFrontmatter = false;
        } else {
          inFrontmatter = true;
        }
        continue;
      }

      if (inFrontmatter) {
        const [key, ...valueParts] = line.split(':');
        const value = valueParts.join(':').trim();
        if (key.trim() === 'name') name = value;
        else if (key.trim() === 'description') description = value;
        else if (key.trim() === 'language') language = value;
        continue;
      }

      promptLines.push(line);
    }

    const systemPromptFragment = promptLines.join('\n').trim();
    if (!systemPromptFragment) return null;

    return { id, name, description, systemPromptFragment, language };
  }

  /** Detect the primary language of a text */
  detectLanguage(text: string): string {
    if (HEBREW_REGEX.test(text)) return 'he';
    if (ARABIC_REGEX.test(text)) return 'ar';
    if (CYRILLIC_REGEX.test(text)) return 'ru';
    if (CJK_REGEX.test(text)) return 'zh';
    return 'en';
  }

  /** Get behavior by ID */
  getBehavior(id: string): Behavior | undefined {
    return this.behaviors.get(id);
  }

  /** Build system prompt fragment from a list of behavior IDs */
  buildBehaviorPrompt(behaviorIds: string[], userMessage?: string): string {
    const fragments: string[] = [];

    for (const id of behaviorIds) {
      const behavior = this.behaviors.get(id);
      if (behavior) {
        fragments.push(behavior.systemPromptFragment);
      }
    }

    // Auto-add language behavior based on user message
    if (userMessage) {
      const lang = this.detectLanguage(userMessage);
      if (lang !== 'en' && !behaviorIds.includes('chinese-priority')) {
        const zhBehavior = this.behaviors.get('chinese-priority');
        if (zhBehavior) fragments.push(zhBehavior.systemPromptFragment);
      }
    }

    return fragments.join('\n\n');
  }

  /** Get all loaded behaviors */
  getAllBehaviors(): Behavior[] {
    return Array.from(this.behaviors.values());
  }

  getBehaviorCount(): number { return this.behaviors.size; }
  isReady(): boolean { return this.initialized; }
}
