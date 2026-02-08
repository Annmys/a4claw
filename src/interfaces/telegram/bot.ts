import { Bot } from 'grammy';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import { Engine } from '../../core/engine.js';
import { BaseInterface } from '../base.js';
import { setupHandlers } from './handlers.js';

export class TelegramBot extends BaseInterface {
  name = 'Telegram';
  private bot: Bot;

  constructor(engine: Engine) {
    super(engine);
    if (!config.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is required');
    this.bot = new Bot(config.TELEGRAM_BOT_TOKEN);
    this.setupMiddleware();
    setupHandlers(this.bot, this.engine);
    this.setupErrorHandler();
  }

  private setupMiddleware() {
    this.bot.use(async (ctx, next) => {
      const start = Date.now();
      await next();
      logger.debug('Telegram request', { userId: ctx.from?.id, duration: Date.now() - start });
    });

    this.bot.use(async (ctx, next) => {
      const userId = ctx.from?.id;
      if (!userId) return;
      if (config.TELEGRAM_ADMIN_IDS.length > 0 && !config.TELEGRAM_ADMIN_IDS.includes(userId)) {
        await ctx.reply('⛔ You are not authorized. Contact the admin.');
        return;
      }
      await next();
    });
  }

  private setupErrorHandler() {
    this.bot.catch((err) => {
      logger.error('Telegram error', { error: err.message, userId: err.ctx.from?.id });
      err.ctx.reply('❌ Something went wrong. Please try again.').catch(() => {});
    });
  }

  async sendMessage(chatId: number | string, text: string): Promise<void> {
    await this.bot.api.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }

  async sendMessagePlain(chatId: number | string, text: string): Promise<number> {
    const msg = await this.bot.api.sendMessage(chatId, text);
    return msg.message_id;
  }

  async sendPhoto(chatId: number | string, photo: Buffer | string, caption?: string): Promise<void> {
    if (typeof photo === 'string') {
      // URL or file_id
      await this.bot.api.sendPhoto(chatId, photo, { caption, parse_mode: 'Markdown' });
    } else {
      // Buffer
      const inputFile = new (await import('grammy')).InputFile(photo, 'image.jpg');
      await this.bot.api.sendPhoto(chatId, inputFile, { caption, parse_mode: 'Markdown' });
    }
  }

  async sendDocument(chatId: number | string, doc: Buffer | string, filename: string, caption?: string): Promise<void> {
    if (typeof doc === 'string') {
      await this.bot.api.sendDocument(chatId, doc, { caption, parse_mode: 'Markdown' });
    } else {
      const inputFile = new (await import('grammy')).InputFile(doc, filename);
      await this.bot.api.sendDocument(chatId, inputFile, { caption, parse_mode: 'Markdown' });
    }
  }

  async sendVideo(chatId: number | string, video: Buffer | string, caption?: string): Promise<void> {
    if (typeof video === 'string') {
      await this.bot.api.sendVideo(chatId, video, { caption, parse_mode: 'Markdown' });
    } else {
      const inputFile = new (await import('grammy')).InputFile(video, 'video.mp4');
      await this.bot.api.sendVideo(chatId, inputFile, { caption, parse_mode: 'Markdown' });
    }
  }

  getBot(): Bot { return this.bot; }

  async start() {
    logger.info('Starting Telegram bot...');
    this.bot.start({ onStart: (info) => logger.info(`Telegram bot started: @${info.username}`) });
  }

  async stop() { await this.bot.stop(); }
}
