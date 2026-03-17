import type pkg from 'whatsapp-web.js';
type WAClient = InstanceType<typeof pkg.Client>;
import { Engine, IncomingMessage } from '../../core/engine.js';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import { formatCostFooter } from '../../core/usage-tracker.js';

export function setupHandlers(client: WAClient, engine: Engine) {
  const adminIds = config.WHATSAPP_ADMIN_IDS;
  const ignoreIds = (config as any).WHATSAPP_IGNORE_IDS as string[] ?? [];
  const denyByDefault = config.CHANNEL_SECURITY_MODE === 'allowlist';

  client.on('message', async (msg) => {
    if (msg.fromMe) return;

    // Ignore list — silently skip specific contacts/groups (e.g., family group)
    if (ignoreIds.length > 0) {
      const chatId = msg.from;
      if (ignoreIds.some(id => chatId.includes(id))) {
        return; // Silently ignore — no response, no log
      }
    }

    // Allowlist guard — deny-by-default security (matches Telegram/Discord pattern)
    if (denyByDefault && adminIds.length > 0) {
      const senderId = msg.from.replace(/@c\.us$/, '');
      if (!adminIds.some(id => senderId.includes(id))) {
        logger.warn('Unauthorized WhatsApp access blocked', { from: msg.from });
        return;
      }
    }

    // Voice messages
    if (msg.hasMedia && msg.type === 'ptt') {
      try {
        const media = await msg.downloadMedia();
        if (!media) return;
        const buffer = Buffer.from(media.data, 'base64');
        const { transcribeAudio } = await import('../../actions/voice/stt.js');
        const text = await transcribeAudio(buffer, 'ogg');
        if (!text) { await msg.reply('Could not understand voice.'); return; }

        const contact = await msg.getContact();
        const incoming: IncomingMessage = {
          platform: 'whatsapp', userId: msg.from,
          userName: contact.pushname ?? contact.name ?? msg.from,
          chatId: msg.from, text, metadata: { originalType: 'voice' },
        };
        const response = await engine.process(incoming);
        await msg.reply(`_"${text}"_\n\n${response.text}`);
      } catch (err: any) {
        logger.error('WhatsApp voice failed', { error: err.message });
        await msg.reply('Voice processing failed.');
      }
      return;
    }

    // Image analysis
    if (msg.hasMedia && msg.type === 'image') {
      try {
        const media = await msg.downloadMedia();
        if (!media) return;
        const buffer = Buffer.from(media.data, 'base64');
        const { analyzeImage } = await import('../../actions/vision/analyze.js');
        const caption = msg.body || 'Describe this image.';
        const analysis = await analyzeImage(buffer, caption);
        await msg.reply(analysis);
      } catch (err: any) {
        logger.error('WhatsApp image failed', { error: err.message });
        await msg.reply('Image analysis failed.');
      }
      return;
    }

    // Text messages
    try {
      const contact = await msg.getContact().catch(() => null);
      const incoming: IncomingMessage = {
        platform: 'whatsapp',
        userId: msg.from,
        userName: contact?.pushname ?? contact?.name ?? msg.from,
        chatId: msg.from,
        text: msg.body,
      };

      logger.debug('WhatsApp message', { from: msg.from, text: msg.body.slice(0, 50) });

      const response = await engine.process(incoming);
      const costFooter = formatCostFooter(response.tokensUsed, response.provider, response.modelUsed, response.agentUsed, response.elapsed);
      await msg.reply(response.text + costFooter);
    } catch (err: any) {
      logger.error('WhatsApp message handler failed', { from: msg.from, error: err.message });
    }
  });
}
