import { AIClient } from './ai-client.js';
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
  UGC_CREATE = 'ugc_create',
  PODCAST_CREATE = 'podcast_create',
  SITE_ANALYZE = 'site_analyze',
  SERVER_MANAGE = 'server_manage',
  SERVER_HEALTH = 'server_health',
  SERVER_SCAN = 'server_scan',
  CRYPTO_TRADE = 'crypto_trade',
  CRYPTO_ANALYZE = 'crypto_analyze',
  CRYPTO_PORTFOLIO = 'crypto_portfolio',
  WHATSAPP_CONNECT = 'whatsapp_connect',
  BUILD_APP = 'build_app',
  MRR_STRATEGY = 'mrr_strategy',
  FACEBOOK_ACTION = 'facebook_action',
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
- build_project: Build, scaffold, create, or deploy a new app/project/website/game (including browser games, arcade games, Phaser games)
- schedule: Schedule recurring tasks, set up automations, cron jobs, periodic alerts (every day, every morning, 每天早上)
- email: Send email, check inbox, compose, 发邮件, 查看邮箱
- document: Upload, analyze file, PDF, 文档, 上传文件, ask about uploaded document
- calendar: Calendar, schedule meeting, 今天有什么安排, 会议, 日历, events
- usage: Check costs, usage stats, how much did it cost, 花了多少钱, budget
- web_action: Sign up for a website, fill a form, scrape a page, open a URL, navigate web, 注册网站, 打开网站, 填表
- phone: Send SMS, make a phone call, text message, 发短信, 打电话, 手机
- content_create: Generate AI content — video, image, music, UGC, create content, 做视频, 做图片, generate video, make content, AI art, AI video
- social_publish: Publish to social media — 发布, 发帖, publish to, post on, share to, cross-post, schedule post, 社交媒体, tiktok, instagram, youtube
- orchestrate: Coordinate between ClawdAgent and OpenClaw, manage OpenClaw, Facebook via OpenClaw, WhatsApp via OpenClaw, check OpenClaw status, sync data between systems, content pipeline (create + publish everywhere), affiliate management — openclaw, 发到openclaw, openclaw状态, 启动openclaw, facebook, whatsapp, 协同, 同步, 全渠道发布
- remember: Save or recall facts/preferences — remember that, 记住, 你记得什么, 忘记, what do you know about me, save this
- autonomous_task: Run a complex multi-step goal autonomously — run autonomously, execute goal, auto-run, do this yourself, 直接执行, 继续处理, 自动处理, 帮我完成, 帮我执行
- self_diagnose: Check system health, self-repair, diagnose issues — 自检, 自我修复, diagnose
- workflow: Create or manage automated workflows/chains — 流程, workflow, automation, 每天执行, automate this
- analytics: Usage stats, cost reports, API key status — 统计, analytics, cost, 报告, budget, 检查API key
- device_control: Control Android phone/tablet — tap, swipe, type, open app, screenshot, ADB command, Appium, send WhatsApp from phone, post TikTok from phone — 控制手机, 点手机, 打开应用, 手机截图
- device_config: Configure device connection, list devices, device info — 连接手机, 设备设置, 设备列表
- ugc_create: Create UGC (User Generated Content) — product showcase, AI influencer, brand content, UGC video, 产品 UGC, 品牌视频, product video
- podcast_create: Create podcast, audio show, multi-speaker conversation — 播客, podcast, 访谈, 讨论, interview
- site_analyze: Analyze a website, build a clone, compare sites, tech stack analysis — 分析网站, clone site, 技术栈, 做类似网站
- server_manage: Manage SSH servers — add, remove, connect, list servers, switch between servers, execute on specific server, upload/download files — 连接服务器, 添加服务器, 服务器列表, 上传到服务器, /servers
- server_health: Check server health, monitor servers, CPU/RAM/disk usage — 服务器健康, health check, how are my servers, /health
- crypto_trade: Buy/sell crypto, place orders, manage positions, DCA — 买比特币, 卖ETH, buy BTC, sell crypto, trade
- crypto_analyze: Technical analysis, signals, market scanning — 分析 BTC, analyze crypto, TA, RSI, MACD, scan market
- crypto_portfolio: Check crypto portfolio, P&L, holdings, stats — 加密仓位, portfolio, P&L, 盈亏, holdings
- server_scan: Scan/discover what's on a server — capabilities, tools, projects, databases — 扫描服务器, what's on the server, discover, /server scan
- whatsapp_connect: Connect WhatsApp, get QR code, check WhatsApp status — 连接 WhatsApp, QR, 二维码, whatsapp connect, whatsapp status
- facebook_action: Facebook account management, autonomous Facebook agent, post to Facebook, Facebook automation, manage Facebook accounts — 发 Facebook, Facebook agent, 管理 Facebook 账号
Chinese examples:
- "现在服务器状态" → server_status
- "修一下服务器" → server_fix
- "帮我搜索一下" → web_search
- "5分钟后提醒我" → reminder_set
- "你能做什么" → help
- "继续处理" → autonomous_task
- "读取这个文件" → server_status (use server-manager for file operations)
- "注册网站 X" → web_action
- "发短信给..." → phone
- "做一个视频" → content_create
- "发布到所有平台" → social_publish
- "帮我同步到 OpenClaw" → orchestrate
- "记住我喜欢 Python" → remember
- "自检一下" → self_diagnose
- "生成自动化流程" → workflow
- "点一下手机上的按钮" → device_control
- "设备列表" → device_config
- "做产品 UGC" → ugc_create
- "做一个 AI 播客" → podcast_create
- "分析这个网站" → site_analyze
- "做个类似网站" → site_analyze
- "做个游戏" → build_project
- "连接服务器 root@10.0.0.5" → server_manage
- "服务器健康检查" → server_health
- "扫描服务器" → server_scan
- "买比特币" → crypto_trade
- "分析 BTC" → crypto_analyze
- "我的加密仓位" → crypto_portfolio
- "连接 WhatsApp" → whatsapp_connect
- "发 Facebook 帖子" → facebook_action
- "直接执行这个任务" → autonomous_task
- "继续处理，不要解释" → autonomous_task
- "build me a game" → build_project
- "create a space shooter" → build_project
- "connect whatsapp" → whatsapp_connect
- "post to facebook" → facebook_action
- "start facebook agent" → facebook_action
- "facebook accounts" → facebook_action
Respond ONLY with valid JSON (no markdown, no text before/after):
{"intent":"<intent_name>","confidence":<0.0-1.0>,"agent":"<best_agent>","params":{"key":"value"}}

Agent options: server-manager, code-assistant, researcher, task-planner, task-executor, general, desktop-controller, project-builder, web-agent, content-creator, orchestrator, device-controller, crypto-trader, crypto-analyst, ai-app-builder, mrr-strategist

For autonomous_task → use task-executor agent.
For ugc_create and podcast_create → use content-creator agent.
For site_analyze → use orchestrator agent.
For server_manage, server_health, server_scan → use server-manager agent.
For crypto_trade → use crypto-trader agent.
For crypto_analyze → use crypto-analyst agent.
For crypto_portfolio → use crypto-trader agent.
For whatsapp_connect → use general agent.
For facebook_action → use web-agent agent.
`;

export class IntentRouter {
  private ai: AIClient;

  constructor(ai: AIClient) {
    this.ai = ai;
  }

  async classify(message: string, conversationContext?: string): Promise<RoutingResult> {
    const contextNote = conversationContext ? `\n\nRecent conversation context:\n${conversationContext}` : '';

    // Always try keyword fallback FIRST — it's instant and reliable for Chinese/English
    const keywordResult = this.keywordClassify(message);

    try {
      // Classification needs FAST JSON responses (< 5s).
      // CLI is too slow (120s timeout) and returns prose instead of JSON.
      // OpenRouter free models (Llama) return 429 rate limits consistently.
      // Always use Anthropic Haiku — fast, cheap ($0.25/M), reliable JSON output.
      const response = await this.ai.chat({
        systemPrompt: ROUTING_PROMPT + contextNote,
        messages: [{ role: 'user', content: message }],
        maxTokens: 200,
        temperature: 0.1,
        model: 'claude-haiku-4-5-20251001',
        provider: 'anthropic' as const,
      });

      const parsed = extractJSON(response.content);
      if (parsed && parsed.intent) {
        return {
          intent: parsed.intent as Intent,
          confidence: parsed.confidence,
          agentId: parsed.agent,
          extractedParams: parsed.params ?? {},
        };
      }
      // AI returned something but no valid intent — use keyword result
      throw new Error('No valid intent in AI response');
    } catch (error: any) {
      logger.warn('AI classification failed, trying keyword fallback', { error: error?.message ?? String(error) });
      if (keywordResult) {
        logger.info('Keyword fallback matched', { intent: keywordResult.intent, agent: keywordResult.agentId });
        return keywordResult;
      }
      return { intent: Intent.GENERAL_CHAT, confidence: 0.5, agentId: 'general', extractedParams: {} };
    }
  }

  /**
   * Keyword-based intent classifier — used as fallback when AI classification fails.
   * Catches the most common Chinese + English patterns.
   */
  private keywordClassify(message: string): RoutingResult | null {

    // Crypto trading — buy/sell/trade
    if (/\b(buy|sell|trade|long|short)\b.*\b(btc|eth|sol|bnb|xrp|crypto|usdt)\b|买.*\b(btc|eth|比特币|以太坊|加密)\b|卖.*\b(btc|eth|比特币|以太坊|加密)\b|交易.*加密|DCA|dca|scalp|波段|现货/i.test(message)) {
      return { intent: Intent.CRYPTO_TRADE, confidence: 0.9, agentId: 'crypto-trader', extractedParams: {} };
    }

    // Crypto analysis — TA, signals, scan
    if (/\b(analyze|analysis|TA)\b.*\b(btc|eth|sol|crypto)\b|分析.*\b(btc|eth|比特币|以太坊|加密)\b|技术分析|分析.*加密|scan.*market|扫描.*市场|RSI|MACD|bollinger|signals.*crypto|交易信号/i.test(message)) {
      return { intent: Intent.CRYPTO_ANALYZE, confidence: 0.9, agentId: 'crypto-analyst', extractedParams: {} };
    }

    // Crypto portfolio
    if (/crypto.*portfolio|加密.*仓位|投资组合|持仓.*加密|crypto.*P&?L|加密.*盈利|加密.*亏损|trading.*stats|交易统计/i.test(message)) {
      return { intent: Intent.CRYPTO_PORTFOLIO, confidence: 0.9, agentId: 'crypto-trader', extractedParams: {} };
    }

    // UGC Factory — product showcase, AI influencer, brand content
    if (/UGC|ugc|产品.*内容|product.*video|brand.*content|AI.*influencer|产品.*视频|产品.*营销|product.*showcase/i.test(message)) {
      return { intent: Intent.UGC_CREATE, confidence: 0.9, agentId: 'content-creator', extractedParams: {} };
    }

    // Podcast creation
    if (/播客|podcast|audio.*show|访谈.*(之间|对话)|interview.*between|讨论.*关于|debate.*about|多人.*对话|双人.*对谈/i.test(message)) {
      return { intent: Intent.PODCAST_CREATE, confidence: 0.9, agentId: 'content-creator', extractedParams: {} };
    }

    // Site analysis / clone
    if (/分析.*网站|网站.*分析|analyze.*site|analyze.*website|site.*analysis|clone.*site|tech.*stack|网站.*技术栈|做.*类似网站/i.test(message)) {
      return { intent: Intent.SITE_ANALYZE, confidence: 0.9, agentId: 'orchestrator', extractedParams: {} };
    }

    // Facebook actions — autonomous agent, posting, account management
    if (/facebook.*agent|agent.*facebook|启动.*facebook|start.*facebook|stop.*facebook|发.*facebook|post.*facebook|facebook.*post|管理.*facebook|manage.*facebook|facebook.*account|facebook.*账号|facebook.*自动化|facebook.*automat|go.*to.*facebook|open.*facebook|facebook.*status|facebook.*状态/i.test(message)) {
      return { intent: Intent.FACEBOOK_ACTION, confidence: 0.92, agentId: 'web-agent', extractedParams: {} };
    }

    // Content creation (images, videos, music)
    if (/做.*图片|创建.*图片|生成.*图片|generate.*image|create.*image|make.*image|做.*视频|创建.*视频|generate.*video|create.*video|make.*video|生成.*音乐|AI art|视频|图像|图片|歌曲|音乐/i.test(message)) {
      return { intent: Intent.CONTENT_CREATE, confidence: 0.85, agentId: 'content-creator', extractedParams: {} };
    }

    // Social media publish — catch any mention of platforms, publishing, blotato, social
    if (/发布|发帖|publish|post.*to|share.*to|cross.?post|定时.*发布|schedule.*post|blotato|social.*media|instagram|tiktok|facebook|youtube|小红书|reels|社交平台/i.test(message)) {
      return { intent: Intent.SOCIAL_PUBLISH, confidence: 0.85, agentId: 'content-creator', extractedParams: {} };
    }

    // Workflow / automation
    if (/自动化|automation|workflow|流程|每天|every.*day|cron|定时|schedule|一天一次|once.*day/i.test(message)) {
      return { intent: Intent.WORKFLOW, confidence: 0.8, agentId: 'content-creator', extractedParams: {} };
    }

    // Server health check
    if (/服务器.*健康|health.*server|server.*health|服务器.*状态|how.*are.*servers|\/health/i.test(message)) {
      return { intent: Intent.SERVER_HEALTH, confidence: 0.9, agentId: 'server-manager', extractedParams: {} };
    }

    // Server scan / discovery
    if (/扫描.*服务器|scan.*server|服务器.*有什么|what.*on.*server|discover|发现.*运行|\/server.*scan/i.test(message)) {
      return { intent: Intent.SERVER_SCAN, confidence: 0.9, agentId: 'server-manager', extractedParams: {} };
    }

    // Server management (connect, add, list, switch, upload, download)
    if (/连接.*服务器|connect.*server|add.*server|添加.*服务器|list.*server|服务器列表|\/servers|switch.*server|切换.*服务器|上传.*服务器|upload.*server|download.*server/i.test(message)) {
      return { intent: Intent.SERVER_MANAGE, confidence: 0.9, agentId: 'server-manager', extractedParams: {} };
    }

    // General server operations (status, deploy, docker, ssh)
    if (/服务器|server|deploy|docker|ssh|uptime|服务器.*状态|修.*服务器/i.test(message)) {
      return { intent: Intent.SERVER_STATUS, confidence: 0.7, agentId: 'server-manager', extractedParams: {} };
    }

    // Web search
    if (/搜索|查一下|search|google|find.*info/i.test(message)) {
      return { intent: Intent.WEB_SEARCH, confidence: 0.8, agentId: 'researcher', extractedParams: {} };
    }

    // Autonomous task execution / task mode / direct execution requests
    if (/任务模式|直接执行|直接处理|继续处理|继续执行|自动处理|自动执行|帮我完成|帮我处理|帮我执行|先做|你直接做|do it yourself|execute.*task|continue.*processing|run.*autonomously|autonomous.*task|execute.*autonomously|直接给结果/i.test(message)) {
      return { intent: Intent.AUTONOMOUS_TASK, confidence: 0.88, agentId: 'task-executor', extractedParams: {} };
    }

    // Tasks
    if (/任务|task|todo|添加.*任务|create.*task/i.test(message)) {
      return { intent: Intent.TASK_CREATE, confidence: 0.8, agentId: 'task-planner', extractedParams: {} };
    }

    // Reminder
    if (/提醒|remind|提醒我|几分钟后|in.*minutes/i.test(message)) {
      return { intent: Intent.REMINDER_SET, confidence: 0.85, agentId: 'task-planner', extractedParams: {} };
    }

    // Desktop control / screenshot
    if (/桌面|屏幕|截图|截屏|点开.*软件|点击.*按钮|打开.*应用|鼠标|键盘|click.*desktop|click.*screen|take.*screenshot|desktop.*control|screen.*shot/i.test(message)) {
      const screenshotIntent = /截图|截屏|screen.*shot|screenshot/i.test(message);
      return {
        intent: screenshotIntent ? Intent.DESKTOP_SCREENSHOT : Intent.DESKTOP_CONTROL,
        confidence: 0.86,
        agentId: 'desktop-controller',
        extractedParams: {},
      };
    }

    // Memory
    if (/记住|remember.*that|你记得什么|what.*know.*about.*me|忘记/i.test(message)) {
      return { intent: Intent.REMEMBER, confidence: 0.85, agentId: 'general', extractedParams: {} };
    }

    // Analytics / costs
    if (/花了多少|cost|budget|统计|analytics|API.*key/i.test(message)) {
      return { intent: Intent.ANALYTICS, confidence: 0.8, agentId: 'general', extractedParams: {} };
    }

    // Help
    if (/你能做什么|what.*can.*you|帮助|help/i.test(message)) {
      return { intent: Intent.HELP, confidence: 0.8, agentId: 'general', extractedParams: {} };
    }

    // Device control
    if (/手机|设备|adb|appium|phone.*tap|phone.*swipe|点击.*手机|控制.*设备/i.test(message)) {
      return { intent: Intent.DEVICE_CONTROL, confidence: 0.8, agentId: 'device-controller', extractedParams: {} };
    }

    // Orchestrate / OpenClaw
    if (/openclaw|协同|coordinate|同步|联动/i.test(message)) {
      return { intent: Intent.ORCHESTRATE, confidence: 0.8, agentId: 'orchestrator', extractedParams: {} };
    }

    // AI App Building / SaaS / MRR product
    if (/\b(build|create|make)\b.*\b(ai|AI)\b.*\b(app|saas|product|tool)\b|做.*AI.*应用|做.*AI.*产品|赚钱.*应用|build.*saas|build.*startup|micro.*saas|收入.*app|ai.*wrapper|盈利.*应用/i.test(message)) {
      return { intent: Intent.BUILD_APP, confidence: 0.9, agentId: 'ai-app-builder', extractedParams: {} };
    }

    // MRR Strategy / Market Research / Revenue
    if (/\bMRR\b|mrr|trustmrr|revenue.*strategy|收入.*策略|saas.*市场研究|pricing.*strategy|定价|business.*model|competitive.*intelligence|竞品.*saas|niche.*research|细分.*研究|revenue.*model|月度.*收入|monthly.*recurring/i.test(message)) {
      return { intent: Intent.MRR_STRATEGY, confidence: 0.9, agentId: 'mrr-strategist', extractedParams: {} };
    }

    // Game / interactive app building — route to project-builder (needs file tool + high token limit)
    if (/\b(game|games|phaser|arcade|shooter|platformer|puzzle|snake|tetris|pong|breakout)\b|做.*游戏|创建.*游戏|build.*game|create.*game|make.*game/i.test(message)) {
      return { intent: Intent.BUILD_PROJECT, confidence: 0.9, agentId: 'project-builder', extractedParams: {} };
    }

    // File save/export/attachment handling — should use file tool via code-assistant
    if (/save.*file|export.*file|download.*file|attach.*file|send.*file|write.*to.*(path|folder|directory)|保存|另存|导出|下载|附件|发送文件|保存到|路径|目录|文件夹|共享|gongxiang|\/data\/gongxiang|\\\\192\.168\.1\.99\\gongxiang/i.test(message)) {
      return { intent: Intent.CODE_WRITE, confidence: 0.88, agentId: 'code-assistant', extractedParams: {} };
    }

    // Code
    if (/写.*代码|write.*code|fix.*bug|修.*bug|code.*review|PR|pull.*request/i.test(message)) {
      return { intent: Intent.CODE_WRITE, confidence: 0.7, agentId: 'code-assistant', extractedParams: {} };
    }

    // Email
    if (/邮件|email|发.*邮件|inbox|send.*email/i.test(message)) {
      return { intent: Intent.EMAIL, confidence: 0.8, agentId: 'general', extractedParams: {} };
    }

    // WhatsApp connect
    if (/whatsapp.*connect|connect.*whatsapp|whatsapp.*qr|whatsapp.*status|连接.*whatsapp|二维码|QR.*code|显示.*QR|link.*whatsapp/i.test(message)) {
      return { intent: Intent.WHATSAPP_CONNECT, confidence: 0.9, agentId: 'general', extractedParams: {} };
    }

    // Web action
    if (/注册|sign.*up|fill.*form|scrape|填写.*表单|打开.*网站/i.test(message)) {
      return { intent: Intent.WEB_ACTION, confidence: 0.8, agentId: 'web-agent', extractedParams: {} };
    }

    return null; // No keyword match — will default to general_chat
  }
}
