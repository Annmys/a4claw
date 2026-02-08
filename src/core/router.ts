import { AIClient } from './ai-client.js';
import config from '../config.js';
import logger from '../utils/logger.js';
import { extractJSON } from '../utils/helpers.js';

export enum Intent {
  SERVER_STATUS = 'server_status',
  SERVER_DEPLOY = 'server_deploy',
  SERVER_FIX = 'server_fix',
  SERVER_MONITOR = 'server_monitor',
  CODE_WRITE = 'code_write',
  CODE_FIX = 'code_fix',
  CODE_REVIEW = 'code_review',
  GITHUB_PR = 'github_pr',
  GITHUB_ISSUE = 'github_issue',
  WEB_SEARCH = 'web_search',
  QUESTION_ANSWER = 'question_answer',
  TASK_CREATE = 'task_create',
  TASK_LIST = 'task_list',
  TASK_UPDATE = 'task_update',
  REMINDER_SET = 'reminder_set',
  GENERAL_CHAT = 'general_chat',
  HELP = 'help',
  SETTINGS = 'settings',
  DESKTOP_CONTROL = 'desktop_control',
  DESKTOP_SCREENSHOT = 'desktop_screenshot',
  BUILD_PROJECT = 'build_project',
  SCHEDULE = 'schedule',
  EMAIL = 'email',
  DOCUMENT = 'document',
  CALENDAR = 'calendar',
  USAGE = 'usage',
  WEB_ACTION = 'web_action',
  PHONE = 'phone',
  CONTENT_CREATE = 'content_create',
  SOCIAL_PUBLISH = 'social_publish',
  ORCHESTRATE = 'orchestrate',
  REMEMBER = 'remember',
  AUTONOMOUS_TASK = 'autonomous_task',
  SELF_DIAGNOSE = 'self_diagnose',
  WORKFLOW = 'workflow',
  ANALYTICS = 'analytics',
  DEVICE_CONTROL = 'device_control',
  DEVICE_CONFIG = 'device_config',
}

export interface RoutingResult {
  intent: Intent;
  confidence: number;
  agentId: string;
  extractedParams: Record<string, string>;
}

const ROUTING_PROMPT = `You are an intent classifier for an AI assistant called ClawdAgent.
Classify the user's message into EXACTLY ONE intent.

Available intents:
- server_status: Check server health, uptime, metrics
- server_deploy: Deploy code, restart services
- server_fix: Fix server issues, debug errors
- server_monitor: Set up monitoring, alerts
- code_write: Write new code, create files, implement features
- code_fix: Fix bugs, resolve errors
- code_review: Review existing code
- github_pr: Create, review, or merge pull requests
- github_issue: Create or manage GitHub issues
- web_search: Search the web for information
- question_answer: Answer a knowledge question (no search needed)
- task_create: Create a new task or todo item
- task_list: Show existing tasks
- task_update: Update, complete, or delete a task
- reminder_set: Set a reminder for a specific time
- general_chat: Casual conversation, greeting, or off-topic
- help: User asking for help with the bot itself
- settings: User wants to change bot settings
- desktop_control: Control the computer — click, type, open apps, interact with the screen
- desktop_screenshot: Take a screenshot or describe what's on screen
- build_project: Build, scaffold, create, or deploy a new app/project/website
- schedule: Schedule recurring tasks, set up automations, cron jobs, periodic alerts (every day, every morning, כל בוקר)
- email: Send email, check inbox, compose, שלח מייל, בדוק מיילים
- document: Upload, analyze file, PDF, מסמך, העלה קובץ, ask about uploaded document
- calendar: Calendar, schedule meeting, מה יש לי היום, פגישה, יומן, events
- usage: Check costs, usage stats, how much did it cost, כמה עלה, budget
- web_action: Sign up for a website, fill a form, scrape a page, open a URL, navigate web, תירשם, הירשם לאתר, פתח אתר, מלא טופס
- phone: Send SMS, make a phone call, text message, שלח SMS, תתקשר, הודעה, טלפון
- content_create: Generate AI content — video, image, music, UGC, create content, צור וידאו, תיצור תמונה, generate video, make content, AI art, AI video
- social_publish: Publish to social media — פרסם, תפרסם, publish to, post on, share to, cross-post, schedule post, תזמן פוסט, רשתות חברתיות, tiktok, instagram, youtube
- orchestrate: Coordinate between ClawdAgent and OpenClaw, manage OpenClaw, Facebook via OpenClaw, WhatsApp via OpenClaw, check OpenClaw status, sync data between systems, content pipeline (create + publish everywhere), affiliate management — openclaw, תשלח ל-openclaw, מה קורה ב-openclaw, תפעיל את openclaw, פייסבוק, whatsapp, ווטסאפ, affiliate, תנהל, תתאם, סינרגיה, תפרסם בכל מקום, צור ופרסם
- remember: Save or recall facts/preferences — remember that, תזכור ש, מה אתה זוכר, תשכח את, what do you know about me, save this
- autonomous_task: Run a complex multi-step goal autonomously — תעשה באופן אוטונומי, run autonomously, execute goal, auto-run, תריץ לבד, do this yourself
- self_diagnose: Check system health, self-repair, diagnose issues — תבדוק את עצמך, מה המצב שלך, self check, diagnose, תתקן את עצמך
- workflow: Create or manage automated workflows/chains — תהליך, workflow, automation, שרשרת, כל בוקר תעשה X, automate this
- analytics: Usage stats, cost reports, API key status — סטטיסטיקות, analytics, כמה עולה, cost, דו"ח, כמה עלה, budget, תבדוק API keys
- device_control: Control Android phone/tablet — tap, swipe, type, open app, screenshot, ADB command, Appium, send WhatsApp from phone, post TikTok from phone — תשלוט בטלפון, תלחץ על, תפתח אפליקציה, צילום מסך טלפון, תשלח ווטסאפ מהטלפון
- device_config: Configure device connection, list devices, device info — חבר טלפון, הגדרות מכשיר, מה המכשירים

Hebrew examples:
- "מה מצב השרת" → server_status
- "תתקן את השרת" → server_fix
- "תחפש באינטרנט" → web_search
- "תזכיר לי בעוד 5 דקות" → reminder_set
- "מה אתה יכול לעשות" → help
- "תשדרג את עצמך" → general_chat
- "תקרא את הקובץ" → server_status (use server-manager for file operations)
- "מה חדש" → general_chat
- "תירשם לאתר X" → web_action
- "שלח SMS ל-..." → phone
- "תתקשר ל-..." → phone
- "תיצור וידאו" → content_create
- "תפרסם בכל הרשתות" → social_publish
- "צור תמונה של..." → content_create
- "מה קורה ב-OpenClaw?" → orchestrate
- "תשלח ב-פייסבוק..." → orchestrate
- "תפרסם בכל מקום" → orchestrate
- "מה המצב של שני המערכות?" → orchestrate
- "תתאם בין ClawdAgent ל-OpenClaw" → orchestrate
- "תזכור שאני אוהב פייתון" → remember
- "מה אתה יודע עליי" → remember
- "תעשה את זה לבד" → autonomous_task
- "תבדוק את עצמך" → self_diagnose
- "כמה עלה לי היום" → analytics
- "תבדוק API keys" → analytics
- "תיצור תהליך אוטומטי" → workflow
- "תלחץ על הטלפון" → device_control
- "תשלח ווטסאפ מהטלפון" → device_control
- "מה המכשירים המחוברים" → device_config

Respond ONLY with valid JSON (no markdown, no text before/after):
{"intent":"<intent_name>","confidence":<0.0-1.0>,"agent":"<best_agent>","params":{"key":"value"}}

Agent options: server-manager, code-assistant, researcher, task-planner, general, desktop-controller, project-builder, web-agent, content-creator, orchestrator, device-controller`;

export class IntentRouter {
  private ai: AIClient;

  constructor(ai: AIClient) {
    this.ai = ai;
  }

  async classify(message: string, conversationContext?: string): Promise<RoutingResult> {
    const contextNote = conversationContext ? `\n\nRecent conversation context:\n${conversationContext}` : '';

    try {
      const response = await this.ai.chat({
        systemPrompt: ROUTING_PROMPT + contextNote,
        messages: [{ role: 'user', content: message }],
        maxTokens: 200,
        temperature: 0.1,
        model: config.OPENROUTER_API_KEY
          ? config.OPENROUTER_ECONOMY_MODEL
          : 'claude-haiku-4-5-20251001',
        provider: config.OPENROUTER_API_KEY ? 'openrouter' : 'anthropic',
      });

      const parsed = extractJSON(response.content);
      return {
        intent: parsed.intent as Intent,
        confidence: parsed.confidence,
        agentId: parsed.agent,
        extractedParams: parsed.params ?? {},
      };
    } catch (error: any) {
      logger.warn('AI classification failed, trying keyword fallback', { error: error?.message ?? String(error) });
      // Keyword-based fallback — catches common patterns when AI router fails
      const fallback = this.keywordClassify(message);
      if (fallback) {
        logger.info('Keyword fallback matched', { intent: fallback.intent, agent: fallback.agentId });
        return fallback;
      }
      return { intent: Intent.GENERAL_CHAT, confidence: 0.5, agentId: 'general', extractedParams: {} };
    }
  }

  /**
   * Keyword-based intent classifier — used as fallback when AI classification fails.
   * Catches the most common Hebrew + English patterns.
   */
  private keywordClassify(message: string): RoutingResult | null {
    const m = message.toLowerCase();

    // Content creation (images, videos, music)
    if (/תיצור|צור.*תמונ|תעשה.*תמונ|generate.*image|create.*image|make.*image|תיצור.*וידאו|צור.*וידאו|generate.*video|create.*video|make.*video|תעשה.*וידאו|צור.*שיר|generate.*music|AI art/i.test(message)) {
      return { intent: Intent.CONTENT_CREATE, confidence: 0.85, agentId: 'content-creator', extractedParams: {} };
    }

    // Social media publish
    if (/תפרסם|פרסם|publish|post.*to|share.*to|cross.?post|תזמן.*פוסט|schedule.*post/i.test(message)) {
      return { intent: Intent.SOCIAL_PUBLISH, confidence: 0.85, agentId: 'content-creator', extractedParams: {} };
    }

    // Server management
    if (/שרת|server|deploy|docker|ssh|uptime|מצב.*שרת|תתקן.*שרת/i.test(message)) {
      return { intent: Intent.SERVER_STATUS, confidence: 0.7, agentId: 'server-manager', extractedParams: {} };
    }

    // Web search
    if (/חפש|תחפש|search|חיפוש|google|find.*info/i.test(message)) {
      return { intent: Intent.WEB_SEARCH, confidence: 0.8, agentId: 'researcher', extractedParams: {} };
    }

    // Tasks
    if (/משימ|task|todo|תוסיף.*משימ|create.*task/i.test(message)) {
      return { intent: Intent.TASK_CREATE, confidence: 0.8, agentId: 'task-planner', extractedParams: {} };
    }

    // Reminder
    if (/תזכיר|remind|תזכורת|בעוד.*דקות|in.*minutes/i.test(message)) {
      return { intent: Intent.REMINDER_SET, confidence: 0.85, agentId: 'task-planner', extractedParams: {} };
    }

    // Memory
    if (/תזכור.*ש|remember.*that|מה.*זוכר|what.*know.*about.*me|תשכח/i.test(message)) {
      return { intent: Intent.REMEMBER, confidence: 0.85, agentId: 'general', extractedParams: {} };
    }

    // Analytics / costs
    if (/כמה.*על|cost|budget|סטטיסטיק|analytics|API.*key/i.test(message)) {
      return { intent: Intent.ANALYTICS, confidence: 0.8, agentId: 'general', extractedParams: {} };
    }

    // Help
    if (/מה.*יכול|what.*can.*you|עזרה|help/i.test(message)) {
      return { intent: Intent.HELP, confidence: 0.8, agentId: 'general', extractedParams: {} };
    }

    // Device control
    if (/טלפון|phone.*tap|phone.*swipe|adb|appium|תלחץ.*טלפון|תשלוט.*מכשיר/i.test(message)) {
      return { intent: Intent.DEVICE_CONTROL, confidence: 0.8, agentId: 'device-controller', extractedParams: {} };
    }

    // Orchestrate / OpenClaw
    if (/openclaw|אופנקלאו|תתאם|coordinate|סינרגיה/i.test(message)) {
      return { intent: Intent.ORCHESTRATE, confidence: 0.8, agentId: 'orchestrator', extractedParams: {} };
    }

    // Code
    if (/תכתוב.*קוד|write.*code|fix.*bug|תתקן.*באג|code.*review|PR|pull.*request/i.test(message)) {
      return { intent: Intent.CODE_WRITE, confidence: 0.7, agentId: 'code-assistant', extractedParams: {} };
    }

    // Email
    if (/מייל|email|שלח.*מייל|inbox|send.*email/i.test(message)) {
      return { intent: Intent.EMAIL, confidence: 0.8, agentId: 'general', extractedParams: {} };
    }

    // Web action
    if (/תירשם|sign.*up|fill.*form|scrape|מלא.*טופס|פתח.*אתר/i.test(message)) {
      return { intent: Intent.WEB_ACTION, confidence: 0.8, agentId: 'web-agent', extractedParams: {} };
    }

    return null; // No keyword match — will default to general_chat
  }
}
