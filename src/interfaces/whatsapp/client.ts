import pkg from 'whatsapp-web.js';
const { Client: WAClient, LocalAuth } = pkg;
import puppeteer from 'puppeteer';
import qrcodeTerminal from 'qrcode-terminal';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import { Engine } from '../../core/engine.js';
import { BaseInterface } from '../base.js';
import { setupHandlers } from './handlers.js';
import { setWhatsAppStatus, setLatestQR } from './auth.js';

// Reconnect settings — never give up, use exponential backoff with cap
const RECONNECT_BASE_DELAY_MS = 10_000;
const RECONNECT_MAX_DELAY_MS = 300_000; // cap at 5 minutes between retries

export class WhatsAppClient extends BaseInterface {
  name = 'WhatsApp';
  private client: InstanceType<typeof WAClient>;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(engine: Engine) {
    super(engine);
    this.client = this.createClient();
  }

  /** Build a fresh WAClient instance with auth strategy */
  private createClient(): InstanceType<typeof WAClient> {
    const chromiumPath = puppeteer.executablePath();
    logger.info('WhatsApp using isolated Chromium', { path: chromiumPath });

    const client = new WAClient({
      authStrategy: new LocalAuth({ dataPath: config.WHATSAPP_SESSION_PATH }),
      puppeteer: {
        headless: true,
        executablePath: chromiumPath,
        args: [
          '--no-sandbox',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-default-apps',
          '--no-first-run',
        ],
      },
    });
    setupHandlers(client, this.engine);
    return client;
  }

  async start() {
    this.attachLifecycleEvents(this.client);
    await this.client.initialize();
  }

  async stop() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try { await this.client.destroy(); } catch {}
    setWhatsAppStatus('disconnected');
  }

  /** Wire up qr / authenticated / auth_failure / ready / disconnected events */
  private attachLifecycleEvents(client: InstanceType<typeof WAClient>) {
    // --- QR code received ---
    client.on('qr', (qr: string) => {
      logger.info('WhatsApp QR code received — scan to authenticate');
      setWhatsAppStatus('waiting');
      setLatestQR(qr);

      qrcodeTerminal.generate(qr, { small: true }, (output: string) => {
        console.log('\n========== WhatsApp QR Code ==========');
        console.log(output);
        console.log('=======================================\n');
      });
    });

    // --- Successfully authenticated ---
    client.on('authenticated', () => {
      logger.info('WhatsApp client authenticated successfully');
      setWhatsAppStatus('authenticated');
      setLatestQR(null);
      this.reconnectAttempts = 0;
    });

    // --- Authentication failure ---
    client.on('auth_failure', (message: string) => {
      logger.error('WhatsApp authentication failed', { message });
      setWhatsAppStatus('auth_failure');
      setLatestQR(null);
      // Auth failure = session expired, try reconnect (will show new QR)
      this.scheduleReconnect();
    });

    // --- Client is ready ---
    client.on('ready', () => {
      logger.info('WhatsApp client ready');
      setWhatsAppStatus('authenticated');
      setLatestQR(null);
      this.reconnectAttempts = 0;
    });

    // --- Disconnected — auto-reconnect forever ---
    client.on('disconnected', (reason: string) => {
      logger.warn('WhatsApp client disconnected', { reason });
      setWhatsAppStatus('disconnected');
      setLatestQR(null);
      this.scheduleReconnect();
    });

    // --- Catch internal Puppeteer/WhatsApp errors (sendSeen, getContact, etc.) ---
    client.on('error', (err: Error) => {
      logger.error('WhatsApp internal error (non-fatal)', { error: err.message });
    });
  }

  /** Reconnect with exponential backoff — never gives up */
  private scheduleReconnect() {
    this.reconnectAttempts++;
    // Exponential backoff: 10s, 20s, 40s, 80s, 160s, 300s (cap)
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1),
      RECONNECT_MAX_DELAY_MS,
    );
    logger.info(`WhatsApp will reconnect in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts})`);
    setWhatsAppStatus('disconnected');

    this.reconnectTimer = setTimeout(async () => {
      try {
        // Destroy old client first to free memory
        try { await this.client.destroy(); } catch {}

        logger.info('WhatsApp reconnecting...');
        this.client = this.createClient();
        this.attachLifecycleEvents(this.client);
        await this.client.initialize();
      } catch (err: any) {
        logger.error('WhatsApp reconnect error', { error: err.message });
        this.scheduleReconnect();
      }
    }, delay);
  }
}
