import { Bot } from 'grammy';
import { Engine, IncomingMessage } from '../../core/engine.js';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import { getOpenClawMessageContext, getOpenClawExecutor } from '../web/routes/webhook.js';
import { executeTool, initTools } from '../../core/tool-executor.js';
import { formatCostFooter } from '../../core/usage-tracker.js';

export function setupHandlers(bot: Bot, engine: Engine) {
  // Admin-only guard — if TELEGRAM_ADMIN_IDS is set, only those users can interact
  const adminIds = config.TELEGRAM_ADMIN_IDS;
  if (adminIds.length > 0) {
    bot.use(async (ctx, next) => {
      const userId = ctx.from?.id;
      if (!userId || !adminIds.includes(userId)) {
        if (ctx.message) {
          await ctx.reply('This bot is private.').catch(() => {});
          logger.warn('Unauthorized Telegram access', { userId, username: ctx.from?.username });
        }
        return;
      }
      await next();
    });
  }

  bot.command('start', async (ctx) => {
    const name = ctx.from?.first_name ?? 'there';
    await ctx.reply(
      `👋 Hey ${name}! I'm **ClawdAgent** — your AI assistant.\n\n` +
      `🖥️ /servers — Manage servers\n💻 /code — Write & fix code\n🔍 /search — Web search\n📋 /tasks — Task manager\n🔌 /provider — AI provider mode\n⚙️ /settings — Settings\n❓ /help — Full command list\n\nOr just send me a message! 🚀`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      `📚 **ClawdAgent Commands**\n\n` +
      `**General**: /start, /help, /status, /provider\n` +
      `**Servers**: /servers, /health, /uptime, /logs\n` +
      `**Quick Ops**: /disk, /ram, /ps, /docker, /ports\n` +
      `**OpenClaw**: /openclaw, /oc\n` +
      `**Analytics**: /costs, /memory\n` +
      `**Code**: /code, /pr, /review\n` +
      `**Search**: /search, /ask\n` +
      `**Tasks**: /tasks, /todo, /remind\n\n` +
      `\u{26A1} Quick commands run instantly (no AI)\n` +
      `\u{1F4AC} Or just type naturally!`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('status', async (ctx) => {
    const uptime = process.uptime();
    const h = Math.floor(uptime / 3600), m = Math.floor((uptime % 3600) / 60);
    const modeInfo = engine.getAIClient().getProviderMode();
    await ctx.reply(
      `📊 **ClawdAgent Status**\n✅ Bot: Online\n⏱️ Uptime: ${h}h ${m}m\n💾 Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB\n🔌 Provider: ${modeInfo.resolved} (${modeInfo.mode})`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('provider', async (ctx) => {
    const ai = engine.getAIClient();
    const arg = ctx.match?.trim().toLowerCase();

    if (arg && ['auto', 'economy', 'pro', 'max'].includes(arg)) {
      ai.setProviderMode(arg as 'auto' | 'economy' | 'pro' | 'max');
      const info = ai.getProviderMode();
      await ctx.reply(
        `✅ Provider mode changed to **${arg}**${arg === 'auto' ? ` (resolved: ${info.resolved})` : ''}\n\nFallback chain: ${info.fallbackOrder.join(' → ')}`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const info = ai.getProviderMode();
    const providers = ai.getAvailableProviders();
    const savings = ai.getClaudeCodeAdapter()?.getSavings() ?? 0;

    const modeDescriptions: Record<string, string> = {
      economy: '💰 Economy — OpenRouter free models (cheapest)',
      pro: '⚡ Pro — Anthropic API (best quality/cost)',
      max: '🚀 Max — Claude Code CLI (FREE via Max sub)',
      auto: '🔄 Auto — detect best available',
    };

    const lines = [
      `🔌 **Provider Mode: ${info.mode}**${info.mode === 'auto' ? ` → ${info.resolved}` : ''}`,
      '',
      `**Fallback chain:** ${info.fallbackOrder.join(' → ')}`,
      `**Available:** ${providers.join(', ')}`,
      savings > 0 ? `**CLI savings:** $${savings.toFixed(4)}` : '',
      '',
      '**Available modes:**',
      ...Object.values(modeDescriptions),
      '',
      '**Switch:** `/provider economy` / `/provider pro` / `/provider max` / `/provider auto`',
    ].filter(Boolean);

    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  });

  bot.on('message:text', async (ctx) => {
    await ctx.replyWithChatAction('typing');

    // ── Check if this is a reply to an OpenClaw message ──
    const replyToId = ctx.message.reply_to_message?.message_id;
    const replyToText = ctx.message.reply_to_message?.text;
    const isOpenClawReply = replyToId && (
      getOpenClawMessageContext(replyToId) ||
      (replyToText && replyToText.includes('OpenClaw'))
    );

    if (isOpenClawReply) {
      const executor = getOpenClawExecutor();
      if (executor) {
        try {
          logger.info('Forwarding reply to OpenClaw', { text: ctx.message.text.slice(0, 100) });

          const openclawContext = replyToId ? getOpenClawMessageContext(replyToId) : undefined;

          // Send the user's reply as a message to OpenClaw
          const result = await executor('agent', {
            message: ctx.message.text,
            to: 'webchat',
            sessionKey: openclawContext?.sessionKey || 'clawdagent-relay',
          });

          if (result.success && result.output) {
            try {
              const parsed = JSON.parse(result.output);
              const reply = parsed?.result?.payloads?.[0]?.text
                || parsed?.payload?.result?.payloads?.[0]?.text
                || parsed?.summary
                || result.output;

              const formatted = `\u{1F990} OpenClaw:\n${typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)}`;
              await ctx.reply(formatted, { parse_mode: 'Markdown' }).catch(() => ctx.reply(formatted));
            } catch {
              await ctx.reply(`\u{1F990} OpenClaw:\n${result.output.slice(0, 3000)}`);
            }
          } else {
            await ctx.reply(`\u{1F990} OpenClaw error: ${result.error || 'No response'}`);
          }
          return;
        } catch (err: any) {
          logger.error('Failed to forward to OpenClaw', { error: err.message });
          await ctx.reply(`\u{274C} Failed to reach OpenClaw: ${err.message}`);
          return;
        }
      }
    }

    // ── Direct slash commands — bypass AI entirely for instant responses ──
    const trimmedText = ctx.message.text.trim();
    const directCommand = trimmedText.split(/\s+/)[0].toLowerCase();
    const directArg = trimmedText.slice(directCommand.length).trim();

    const DIRECT_COMMANDS: Record<string, () => Promise<string | null>> = {
      '/openclaw': async () => {
        initTools();
        if (directArg) {
          // /openclaw <message> → send to OpenClaw agent
          const r = await executeTool('openclaw', { action: 'agent', message: directArg, sessionKey: 'clawdagent-direct' });
          return r.success ? `\u{1F990} OpenClaw:\n${r.output.slice(0, 3500)}` : `\u{274C} OpenClaw error: ${r.error}`;
        }
        const r = await executeTool('openclaw', { action: 'health' });
        return r.success ? `\u{1F990} OpenClaw Health:\n${r.output.slice(0, 3000)}` : `\u{274C} OpenClaw: ${r.error || 'unreachable'}`;
      },
      '/oc': async () => DIRECT_COMMANDS['/openclaw']!(),
      '/servers': async () => {
        initTools();
        const r = await executeTool('ssh', { action: 'list_servers' });
        return r.success ? `\u{1F5A5}\uFE0F Servers:\n${r.output.slice(0, 3000)}` : `\u{274C} ${r.error}`;
      },
      '/health': async () => {
        initTools();
        const serverId = directArg || undefined;
        const action = serverId ? 'health' : 'health_all';
        const r = await executeTool('ssh', { action, ...(serverId ? { serverId } : {}) });
        return r.success ? r.output.slice(0, 3500) : `\u{274C} ${r.error}`;
      },
      '/costs': async () => {
        initTools();
        const r = await executeTool('analytics', { action: 'cost' });
        return r.success ? `\u{1F4B0} Cost Report:\n${r.output.slice(0, 3000)}` : `\u{274C} ${r.error}`;
      },
      '/memory': async () => {
        initTools();
        const r = await executeTool('memory', { action: 'stats', userId: String(ctx.from.id) });
        return r.success ? `\u{1F9E0} Memory:\n${r.output.slice(0, 3000)}` : `\u{274C} ${r.error}`;
      },
      '/logs': async () => {
        initTools();
        const r = await executeTool('bash', { command: 'tail -50 /root/.clawdagent/logs/combined.log 2>/dev/null || tail -50 logs/combined.log 2>/dev/null || echo "No logs found"' });
        return r.success ? `\u{1F4DC} Recent Logs:\n${r.output.slice(0, 3500)}` : `\u{274C} ${r.error}`;
      },
      // ── Quick server commands — common ops without AI overhead ──
      '/disk': async () => {
        initTools();
        const sid = directArg || undefined;
        const r = await executeTool(sid ? 'ssh' : 'bash', sid ? { action: 'exec', serverId: sid, command: 'df -h' } : { command: 'df -h' });
        return r.success ? `\u{1F4C0} Disk Usage:\n\`\`\`\n${r.output.slice(0, 3000)}\n\`\`\`` : `\u{274C} ${r.error}`;
      },
      '/ram': async () => {
        initTools();
        const sid = directArg || undefined;
        const r = await executeTool(sid ? 'ssh' : 'bash', sid ? { action: 'exec', serverId: sid, command: 'free -h' } : { command: 'free -h' });
        return r.success ? `\u{1F4BE} Memory:\n\`\`\`\n${r.output.slice(0, 3000)}\n\`\`\`` : `\u{274C} ${r.error}`;
      },
      '/ps': async () => {
        initTools();
        const sid = directArg || undefined;
        const r = await executeTool(sid ? 'ssh' : 'bash', sid ? { action: 'exec', serverId: sid, command: 'ps aux --sort=-%mem | head -15' } : { command: 'ps aux --sort=-%mem | head -15' });
        return r.success ? `\u{1F4CB} Top Processes:\n\`\`\`\n${r.output.slice(0, 3000)}\n\`\`\`` : `\u{274C} ${r.error}`;
      },
      '/docker': async () => {
        initTools();
        const sid = directArg || undefined;
        const r = await executeTool(sid ? 'ssh' : 'bash', sid ? { action: 'exec', serverId: sid, command: 'docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"' } : { command: 'docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"' });
        return r.success ? `\u{1F433} Docker:\n\`\`\`\n${r.output.slice(0, 3000)}\n\`\`\`` : `\u{274C} ${r.error}`;
      },
      '/ports': async () => {
        initTools();
        const sid = directArg || undefined;
        const r = await executeTool(sid ? 'ssh' : 'bash', sid ? { action: 'exec', serverId: sid, command: 'ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null' } : { command: 'ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null' });
        return r.success ? `\u{1F310} Open Ports:\n\`\`\`\n${r.output.slice(0, 3000)}\n\`\`\`` : `\u{274C} ${r.error}`;
      },
      '/uptime': async () => {
        initTools();
        const sid = directArg || undefined;
        const r = await executeTool(sid ? 'ssh' : 'bash', sid ? { action: 'exec', serverId: sid, command: 'uptime && echo "---" && uname -a' } : { command: 'uptime && echo "---" && uname -a' });
        return r.success ? `\u{23F1}\uFE0F Uptime:\n${r.output.slice(0, 2000)}` : `\u{274C} ${r.error}`;
      },
    };

    if (DIRECT_COMMANDS[directCommand]) {
      try {
        const result = await DIRECT_COMMANDS[directCommand]();
        if (result) {
          await ctx.reply(result, { parse_mode: 'Markdown' }).catch(() => ctx.reply(result));
        }
      } catch (err: any) {
        logger.error('Direct command failed', { command: directCommand, error: err.message });
        await ctx.reply(`\u{274C} Command failed: ${err.message}`).catch(() => {});
      }
      return;
    }

    // ── Normal message processing ──
    const incoming: IncomingMessage = {
      platform: 'telegram',
      userId: String(ctx.from.id),
      userName: ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : ''),
      chatId: String(ctx.chat.id),
      text: ctx.message.text,
      replyTo: ctx.message.reply_to_message?.text,
    };

    // Almost everything can take 2-9 minutes (server ops, content, multi-tool chains).
    // Only very short greetings/questions stay on the short timeout.
    const isQuickChat = /^(hi|hello|hey|שלום|מה קורה|מה נשמע|בוקר טוב|ערב טוב|תודה|thanks|ok|אוקיי|כן|לא|yes|no|\/start|\/help|\/status|\/provider)$/i.test(ctx.message.text.trim());
    const isLongRunning = !isQuickChat;
    const TIMEOUT = isLongRunning ? 900000 : 300000; // 15 min for long ops, 5 min for normal
    const startTime = Date.now();

    // Keep sending 'typing' indicator every 4s while processing
    const typingInterval = setInterval(() => {
      ctx.replyWithChatAction('typing').catch(() => {});
    }, 4000);

    // ── Progress messages every 60s — keeps user informed without spam ──
    // (Typing indicator every 4s already keeps Telegram connection alive)
    let progressCount = 0;
    const PROGRESS_INTERVAL = 60000; // 60s between progress messages
    const progressInterval = setInterval(async () => {
      progressCount++;
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      const progressMsgs = [
        `\u{23F3} \u05E2\u05D3\u05D9\u05D9\u05DF \u05E2\u05D5\u05D1\u05D3... (${timeStr})`,
        `\u{23F3} \u05E2\u05D3\u05D9\u05D9\u05DF \u05DE\u05E2\u05D1\u05D3... \u05D6\u05D4 \u05DC\u05D5\u05E7\u05D7 \u05E7\u05E6\u05EA \u05D9\u05D5\u05EA\u05E8 \u05DE\u05D4\u05E8\u05D2\u05D9\u05DC (${timeStr})`,
        `\u{23F3} \u05DE\u05DE\u05E9\u05D9\u05DA \u05DC\u05E2\u05D1\u05D5\u05D3... \u05EA\u05D4\u05DC\u05D9\u05DB\u05D9\u05DD \u05DE\u05D5\u05E8\u05DB\u05D1\u05D9\u05DD \u05DC\u05D5\u05E7\u05D7\u05D9\u05DD \u05D6\u05DE\u05DF (${timeStr})`,
        `\u{23F3} \u05E2\u05D3\u05D9\u05D9\u05DF \u05DB\u05D0\u05DF, \u05E2\u05D5\u05D1\u05D3 \u05D1\u05E8\u05E7\u05E2... (${timeStr})`,
      ];
      const msg = progressMsgs[Math.min(progressCount - 1, progressMsgs.length - 1)];
      await ctx.reply(msg).catch(() => {});
    }, PROGRESS_INTERVAL);

    // ── Context-aware "thinking" message based on keywords ──
    const lowerText = ctx.message.text.toLowerCase();
    let thinkingMsg = '';
    if (/search|חפש|תחפש|google|מצא|find/i.test(lowerText)) thinkingMsg = '\u{1F50D} \u05DE\u05D7\u05E4\u05E9...';
    else if (/image|תמונה|צייר|draw|generate.*image|תיצור.*תמונה/i.test(lowerText)) thinkingMsg = '\u{1F3A8} \u05DE\u05D9\u05D9\u05E6\u05E8 \u05EA\u05DE\u05D5\u05E0\u05D4...';
    else if (/video|וידאו|סרטון|תיצור.*וידאו|clip/i.test(lowerText)) thinkingMsg = '\u{1F3AC} \u05DE\u05D9\u05D9\u05E6\u05E8 \u05D5\u05D9\u05D3\u05D0\u05D5...';
    else if (/music|שיר|מוזיקה|song|audio/i.test(lowerText)) thinkingMsg = '\u{1F3B5} \u05DE\u05D9\u05D9\u05E6\u05E8 \u05DE\u05D5\u05D6\u05D9\u05E7\u05D4...';
    else if (/publish|פרסם|tweet|post|story|share/i.test(lowerText)) thinkingMsg = '\u{1F4E4} \u05DE\u05E4\u05E8\u05E1\u05DD...';
    else if (/server|שרת|deploy|דפלוי|ssh|docker/i.test(lowerText)) thinkingMsg = '\u{1F5A5}\uFE0F \u05DE\u05EA\u05D7\u05D1\u05E8 \u05DC\u05E9\u05E8\u05EA...';
    else if (/email|מייל|gmail|inbox/i.test(lowerText)) thinkingMsg = '\u{1F4E7} \u05D1\u05D5\u05D3\u05E7 \u05DE\u05D9\u05D9\u05DC\u05D9\u05DD...';
    else if (/code|קוד|github|pr|bug|fix/i.test(lowerText)) thinkingMsg = '\u{1F4BB} \u05E2\u05D5\u05D1\u05D3 \u05E2\u05DC \u05E7\u05D5\u05D3...';
    else if (/scrape|crawl|site|אתר|analyze|תנתח/i.test(lowerText)) thinkingMsg = '\u{1F310} \u05E1\u05D5\u05E8\u05E7 \u05D0\u05EA\u05E8...';
    if (thinkingMsg) {
      await ctx.reply(thinkingMsg).catch(() => {});
    }

    // Start engine processing — keep promise reference for background delivery
    const processPromise = engine.process(incoming);
    let response: Awaited<ReturnType<typeof engine.process>>;

    try {
      response = await Promise.race([
        processPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('RESPONSE_TIMEOUT')), TIMEOUT)
        ),
      ]);
    } catch (err: any) {
      if (err.message === 'RESPONSE_TIMEOUT') {
        logger.warn('Engine response timed out, continuing in background', {
          userId: incoming.userId, text: incoming.text.slice(0, 50), timeout: TIMEOUT,
        });
        await ctx.reply(
          `\u{23F3} \u05D4\u05E4\u05E2\u05D5\u05DC\u05D4 \u05DC\u05D5\u05E7\u05D7\u05EA \u05D9\u05D5\u05EA\u05E8 \u05DE-${Math.round(TIMEOUT / 1000)} \u05E9\u05E0\u05D9\u05D5\u05EA. \u05DE\u05DE\u05E9\u05D9\u05DA \u05D1\u05E8\u05E7\u05E2 \u2014 \u05D0\u05E9\u05DC\u05D7 \u05EA\u05D5\u05E6\u05D0\u05D4 \u05DB\u05E9\u05EA\u05D4\u05D9\u05D4 \u05DE\u05D5\u05DB\u05E0\u05D4...`
        ).catch(() => {});

        // ── Background delivery: keep waiting, send result when done ──
        processPromise
          .then(async (bgResult) => {
            clearInterval(typingInterval);
            clearInterval(progressInterval);

            if (!bgResult.text || bgResult.text.trim().length === 0) {
              bgResult.text = '\u05E2\u05D9\u05D1\u05D3\u05EA\u05D9 \u05D0\u05EA \u05D4\u05D1\u05E7\u05E9\u05D4 \u05D0\u05D1\u05DC \u05D0\u05D9\u05DF \u05DC\u05D9 \u05DE\u05D4 \u05DC\u05D4\u05D2\u05D9\u05D3. \u05E0\u05E1\u05D4 \u05DC\u05E0\u05E1\u05D7 \u05D0\u05D7\u05E8\u05EA.';
            }

            const elapsed = Math.round((Date.now() - startTime) / 1000);
            const header = `\u{2705} \u05E1\u05D9\u05D9\u05DE\u05EA\u05D9! (\u05DC\u05E7\u05D7 ${elapsed} \u05E9\u05E0\u05D9\u05D5\u05EA)\n\n`;
            const bgCostFooter = formatCostFooter(bgResult.tokensUsed, bgResult.provider, bgResult.modelUsed, bgResult.agentUsed, elapsed);
            const fullText = header + bgResult.text + bgCostFooter;

            await sendResponseWithMedia(ctx, fullText);
          })
          .catch((bgErr) => {
            logger.error('Background processing failed', { error: bgErr.message });
            ctx.reply(`\u{274C} \u05D4\u05E4\u05E2\u05D5\u05DC\u05D4 \u05D1\u05E8\u05E7\u05E2 \u05E0\u05DB\u05E9\u05DC\u05D4: ${bgErr.message}`).catch(() => {});
          })
          .finally(() => {
            clearInterval(typingInterval);
            clearInterval(progressInterval);
          });

        return; // Exit handler — background will deliver the result
      }
      // Non-timeout error
      clearInterval(typingInterval);
      clearInterval(progressInterval);
      throw err;
    }

    // ── Normal completion (before timeout) ──
    clearInterval(typingInterval);
    clearInterval(progressInterval);

    // Guard against empty responses
    if (!response.text || response.text.trim().length === 0) {
      response.text = '\u{1F914} I processed your request but had nothing to say. Try asking differently.';
    }

    // ── Auto task conversion (Phase 2) ──────────────────────────
    // Convert user message to task if it contains task intent
    try {
      const { convertMessageToTask } = await import('../../agents/tools/message-to-task-converter.js');
      const taskResult = await convertMessageToTask(
        ctx.message.text,
        String(ctx.from.id),
        'telegram',
        {
          confidenceThreshold: 0.75,
          autoDispatch: false,
        }
      );
      
      if (taskResult.success && taskResult.taskId) {
        logger.info('Telegram message converted to task', {
          userId: ctx.from.id,
          taskId: taskResult.taskId,
          title: taskResult.intent.title,
        });
        
        // Notify user about task creation
        await ctx.reply(
          `📋 ${taskResult.message}\n` +
          `🔗 Task ID: ${taskResult.taskId}\n` +
          `📊 Priority: ${taskResult.intent.priority}\n\n` +
          `View in Command Center dashboard.`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }
    } catch (convError) {
      // Task conversion failure should not break the chat flow
      logger.warn('Telegram task conversion failed', { error: convError });
    }

    // Append token/cost footer
    const costFooter = formatCostFooter(response.tokensUsed, response.provider, response.modelUsed, response.agentUsed, response.elapsed);
    await sendResponseWithMedia(ctx, response.text + costFooter);
  });

  // Voice messages → Whisper transcription → Engine
  bot.on('message:voice', async (ctx) => {
    await ctx.replyWithChatAction('typing');

    try {
      const file = await ctx.getFile();
      const fileUrl = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
      const response = await fetch(fileUrl);
      const audioBuffer = Buffer.from(await response.arrayBuffer());

      const { transcribeAudio } = await import('../../actions/voice/stt.js');
      const text = await transcribeAudio(audioBuffer, 'ogg');

      if (!text) {
        await ctx.reply('Could not understand the voice message. Please try again.');
        return;
      }

      const incoming: IncomingMessage = {
        platform: 'telegram',
        userId: String(ctx.from.id),
        userName: ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : ''),
        chatId: String(ctx.chat.id),
        text,
        metadata: { originalType: 'voice' },
      };

      const result = await engine.process(incoming);
      const replyText = `_"${text}"_\n\n${result.text}`;
      await ctx.reply(replyText, { parse_mode: 'Markdown' }).catch(() => ctx.reply(replyText));
    } catch (err: any) {
      logger.error('Voice processing failed', { error: err.message });
      await ctx.reply('Voice processing failed. Make sure OPENAI_API_KEY is set for Whisper.');
    }
  });

  // Photo messages → AI vision analysis
  bot.on('message:photo', async (ctx) => {
    await ctx.replyWithChatAction('typing');

    try {
      const photo = ctx.message.photo;
      const file = await ctx.api.getFile(photo[photo.length - 1].file_id);
      const fileUrl = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
      const response = await fetch(fileUrl);
      const imageBuffer = Buffer.from(await response.arrayBuffer());

      const caption = ctx.message?.caption ?? 'Describe this image in detail. If there is text, read it.';

      const { analyzeImage } = await import('../../actions/vision/analyze.js');
      const analysis = await analyzeImage(imageBuffer, caption);

      await ctx.reply(analysis, { parse_mode: 'Markdown' }).catch(() => ctx.reply(analysis));
    } catch (err: any) {
      logger.error('Image analysis failed', { error: err.message });
      await ctx.reply('Image analysis failed: ' + err.message);
    }
  });

  // Document messages → image vision OR text/PDF extraction
  bot.on('message:document', async (ctx) => {
    await ctx.replyWithChatAction('typing');

    try {
      const document = ctx.message.document;
      if (!document) return;

      const mime = document.mime_type ?? '';
      const fileName = document.file_name ?? 'file';
      const file = await ctx.api.getFile(document.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
      const response = await fetch(fileUrl);
      const buffer = Buffer.from(await response.arrayBuffer());

      const caption = ctx.message?.caption ?? '';

      // Image documents → vision analysis
      if (mime.startsWith('image/')) {
        const { analyzeImage } = await import('../../actions/vision/analyze.js');
        const analysis = await analyzeImage(buffer, caption || 'Describe this image in detail. If there is text, read it.');
        await ctx.reply(analysis, { parse_mode: 'Markdown' }).catch(() => ctx.reply(analysis));
        return;
      }

      // PDF documents → extract text and process through engine
      if (mime === 'application/pdf' || fileName.endsWith('.pdf')) {
        try {
          const pdfModule = await import('pdf-parse');
          const pdfParse = (pdfModule as any).default ?? pdfModule;
          const pdfData = await pdfParse(buffer);
          const text = pdfData.text.trim();

          if (!text) {
            await ctx.reply('Could not extract text from this PDF. It may be image-based.');
            return;
          }

          const incoming: IncomingMessage = {
            platform: 'telegram',
            userId: String(ctx.from.id),
            userName: ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : ''),
            chatId: String(ctx.chat.id),
            text: caption
              ? `${caption}\n\n--- Document: ${fileName} ---\n${text.slice(0, 8000)}`
              : `I received a PDF document "${fileName}". Here is its content:\n\n${text.slice(0, 8000)}${text.length > 8000 ? '\n\n[...truncated]' : ''}`,
            metadata: { originalType: 'document', fileName, mimeType: mime },
          };

          const result = await engine.process(incoming);
          await ctx.reply(result.text, { parse_mode: 'Markdown' }).catch(() => ctx.reply(result.text));
        } catch (pdfErr: any) {
          logger.error('PDF parsing failed', { error: pdfErr.message });
          await ctx.reply('Failed to parse PDF: ' + pdfErr.message);
        }
        return;
      }

      // Text-based documents → read as text and process through engine
      if (mime.startsWith('text/') || /\.(txt|md|json|csv|xml|html|yaml|yml|log|ts|js|py|sh|sql)$/i.test(fileName)) {
        const text = buffer.toString('utf-8');
        const incoming: IncomingMessage = {
          platform: 'telegram',
          userId: String(ctx.from.id),
          userName: ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : ''),
          chatId: String(ctx.chat.id),
          text: caption
            ? `${caption}\n\n--- File: ${fileName} ---\n${text.slice(0, 8000)}`
            : `I received a text file "${fileName}". Here is its content:\n\n${text.slice(0, 8000)}${text.length > 8000 ? '\n\n[...truncated]' : ''}`,
          metadata: { originalType: 'document', fileName, mimeType: mime },
        };

        const result = await engine.process(incoming);
        await ctx.reply(result.text, { parse_mode: 'Markdown' }).catch(() => ctx.reply(result.text));
        return;
      }

      // Unsupported document type
      await ctx.reply(`I received "${fileName}" (${mime}). I can process images, PDFs, and text files. This file type is not supported yet.`);
    } catch (err: any) {
      logger.error('Document processing failed', { error: err.message });
      await ctx.reply('Document processing failed: ' + err.message);
    }
  });
}

// ── Media URL detection & sending ──────────────────────────────────
// Detects image/video/audio URLs in response text and sends them as native Telegram media.

const MEDIA_URL_REGEX = /https?:\/\/[^\s"'<>)]+\.(jpg|jpeg|png|gif|webp|bmp|mp4|webm|mov|avi|mp3|ogg|wav|m4a|aac|flac)(\?[^\s"'<>)]*)?/gi;
const IMAGE_EXTS = /\.(jpg|jpeg|png|gif|webp|bmp)(\?|$)/i;
const VIDEO_EXTS = /\.(mp4|webm|mov|avi)(\?|$)/i;
const AUDIO_EXTS = /\.(mp3|ogg|wav|m4a|aac|flac)(\?|$)/i;

async function sendResponseWithMedia(
  ctx: any,
  text: string,
  parseMode: 'Markdown' | 'HTML' | undefined = 'Markdown',
): Promise<void> {
  // Extract all media URLs
  const mediaUrls = [...new Set(text.match(MEDIA_URL_REGEX) || [])];

  if (mediaUrls.length === 0) {
    // No media — plain text send
    await sendTextChunked(ctx, text, parseMode);
    return;
  }

  // Remove media URLs from text body (they'll be sent as native media)
  let cleanText = text;
  for (const url of mediaUrls) {
    cleanText = cleanText.replace(url, '').replace(/\[.*?\]\(\s*\)/, ''); // remove empty markdown links
  }
  cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();

  // Send each media item as native Telegram media
  for (const url of mediaUrls.slice(0, 5)) { // Max 5 media items
    try {
      if (IMAGE_EXTS.test(url)) {
        const caption = mediaUrls.length === 1 && cleanText.length <= 1024 ? cleanText : undefined;
        await ctx.replyWithPhoto(url, {
          caption,
          parse_mode: caption ? parseMode : undefined,
        });
        if (caption) cleanText = ''; // Caption was sent with the image
      } else if (VIDEO_EXTS.test(url)) {
        const caption = mediaUrls.length === 1 && cleanText.length <= 1024 ? cleanText : undefined;
        await ctx.replyWithVideo(url, {
          caption,
          parse_mode: caption ? parseMode : undefined,
        });
        if (caption) cleanText = '';
      } else if (AUDIO_EXTS.test(url)) {
        const caption = mediaUrls.length === 1 && cleanText.length <= 1024 ? cleanText : undefined;
        await ctx.replyWithAudio(url, {
          caption,
          parse_mode: caption ? parseMode : undefined,
        });
        if (caption) cleanText = '';
      }
    } catch (mediaErr: any) {
      // If media send fails, fall back to sending URL as text
      logger.debug('Media send failed, falling back to text', { url: url.slice(0, 80), error: mediaErr.message });
      cleanText += `\n${url}`;
    }
  }

  // Send remaining text if any
  if (cleanText.trim().length > 0) {
    await sendTextChunked(ctx, cleanText, parseMode);
  }
}

async function sendTextChunked(
  ctx: any,
  text: string,
  parseMode: 'Markdown' | 'HTML' | undefined = 'Markdown',
): Promise<void> {
  const maxLen = 4000;
  if (text.length <= maxLen) {
    await ctx.reply(text, { parse_mode: parseMode }).catch(() => ctx.reply(text));
  } else {
    const chunks = splitMessage(text, maxLen);
    for (const chunk of chunks) {
      await ctx.reply(chunk, { parse_mode: parseMode }).catch(() => ctx.reply(chunk));
    }
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { chunks.push(remaining); break; }
    let idx = remaining.lastIndexOf('\n', maxLen);
    if (idx < maxLen / 2) idx = remaining.lastIndexOf(' ', maxLen);
    if (idx === -1) idx = maxLen;
    chunks.push(remaining.slice(0, idx));
    remaining = remaining.slice(idx).trimStart();
  }
  return chunks;
}
