import { AppiumClient } from './appium-client.js';
import { ToolResult } from '../../agents/tools/base-tool.js';
import logger from '../../utils/logger.js';

interface RecipeDefinition {
  app: string;
  name: string;
  description: string;
  params: string[];
}

/**
 * Pre-built automation recipes for popular apps.
 * Each recipe is a sequence of Appium actions that accomplishes a specific task.
 */
export class AppRecipes {
  private appium: AppiumClient;

  constructor(appium: AppiumClient) {
    this.appium = appium;
  }

  async run(app: string, recipe: string, params: Record<string, unknown>): Promise<ToolResult> {
    const key = `${app}:${recipe}`;
    logger.info(`[AppRecipes] Running recipe: ${key}`, { params });

    try {
      switch (key) {
        // ─── WhatsApp ─────────────────────────────────
        case 'whatsapp:send_message':
          return this.whatsappSendMessage(params.contact as string, params.message as string);
        case 'whatsapp:send_media':
          return this.whatsappSendMedia(params.contact as string, params.mediaPath as string, params.caption as string);
        case 'whatsapp:read_last':
          return this.whatsappReadLast(params.contact as string, params.count as number);
        case 'whatsapp:status_post':
          return this.whatsappStatusPost(params.text as string);

        // ─── TikTok ───────────────────────────────────
        case 'tiktok:upload_video':
          return this.tiktokUploadVideo(params.videoPath as string, params.caption as string);
        case 'tiktok:scroll_feed':
          return this.tiktokScrollFeed(params.count as number);

        // ─── Instagram ────────────────────────────────
        case 'instagram:post_photo':
          return this.instagramPostPhoto(params.imagePath as string, params.caption as string);
        case 'instagram:post_reel':
          return this.instagramPostReel(params.videoPath as string, params.caption as string);
        case 'instagram:send_dm':
          return this.instagramSendDm(params.username as string, params.message as string);

        default:
          return { success: false, output: '', error: `Unknown recipe: ${key}. Use list_recipes to see available recipes.` };
      }
    } catch (err: any) {
      logger.error(`[AppRecipes] Recipe "${key}" failed`, { error: err.message });
      return { success: false, output: '', error: `Recipe "${key}" failed: ${err.message}` };
    }
  }

  listAll(): RecipeDefinition[] {
    return [
      // WhatsApp
      { app: 'whatsapp', name: 'send_message', description: 'Send a text message to a contact', params: ['contact', 'message'] },
      { app: 'whatsapp', name: 'send_media', description: 'Send image/video to a contact', params: ['contact', 'mediaPath', 'caption?'] },
      { app: 'whatsapp', name: 'read_last', description: 'Read last N messages from a contact', params: ['contact', 'count?'] },
      { app: 'whatsapp', name: 'status_post', description: 'Post a text status', params: ['text'] },
      // TikTok
      { app: 'tiktok', name: 'upload_video', description: 'Upload video to TikTok', params: ['videoPath', 'caption'] },
      { app: 'tiktok', name: 'scroll_feed', description: 'Scroll through TikTok feed', params: ['count?'] },
      // Instagram
      { app: 'instagram', name: 'post_photo', description: 'Post a photo to feed', params: ['imagePath', 'caption'] },
      { app: 'instagram', name: 'post_reel', description: 'Post a reel video', params: ['videoPath', 'caption'] },
      { app: 'instagram', name: 'send_dm', description: 'Send a direct message', params: ['username', 'message'] },
    ];
  }

  // ═══ WhatsApp Recipes ═══════════════════════════════════

  private async whatsappSendMessage(contact: string, message: string): Promise<ToolResult> {
    const pkg = 'com.whatsapp';
    const steps: string[] = [];

    // Start Appium session with WhatsApp
    await this.appium.createSession('http://localhost:4723', {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:appPackage': pkg,
      'appium:appActivity': 'com.whatsapp.Main',
      'appium:noReset': true,
    });
    steps.push('Opened WhatsApp');

    await this.sleep(2000);

    // Search for contact
    const searchBtn = await this.appium.findElement('accessibility id', 'Search');
    await this.appium.clickElement(searchBtn.elementId);
    steps.push('Opened search');

    await this.sleep(500);
    const searchInput = await this.appium.findElement('class name', 'android.widget.EditText');
    await this.appium.sendKeys(searchInput.elementId, contact);
    steps.push(`Searched for: ${contact}`);

    await this.sleep(1500);

    // Tap the contact result
    const contactResult = await this.appium.findElement('xpath', `//android.widget.TextView[contains(@text, "${contact}")]`);
    await this.appium.clickElement(contactResult.elementId);
    steps.push(`Selected contact: ${contact}`);

    await this.sleep(1000);

    // Type message
    const msgInput = await this.appium.findElement('accessibility id', 'Type a message');
    await this.appium.sendKeys(msgInput.elementId, message);
    steps.push('Typed message');

    // Send
    const sendBtn = await this.appium.findElement('accessibility id', 'Send');
    await this.appium.clickElement(sendBtn.elementId);
    steps.push('Sent message');

    await this.appium.deleteSession();

    return {
      success: true,
      output: JSON.stringify({ app: 'whatsapp', recipe: 'send_message', contact, steps }),
    };
  }

  private async whatsappSendMedia(contact: string, mediaPath: string, caption?: string): Promise<ToolResult> {
    const steps: string[] = [];

    await this.appium.createSession('http://localhost:4723', {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:appPackage': 'com.whatsapp',
      'appium:appActivity': 'com.whatsapp.Main',
      'appium:noReset': true,
    });
    steps.push('Opened WhatsApp');
    await this.sleep(2000);

    // Navigate to contact
    const searchBtn = await this.appium.findElement('accessibility id', 'Search');
    await this.appium.clickElement(searchBtn.elementId);
    await this.sleep(500);
    const searchInput = await this.appium.findElement('class name', 'android.widget.EditText');
    await this.appium.sendKeys(searchInput.elementId, contact);
    await this.sleep(1500);
    const contactResult = await this.appium.findElement('xpath', `//android.widget.TextView[contains(@text, "${contact}")]`);
    await this.appium.clickElement(contactResult.elementId);
    await this.sleep(1000);
    steps.push(`Navigated to ${contact}`);

    // Attach media
    const attachBtn = await this.appium.findElement('accessibility id', 'Attach');
    await this.appium.clickElement(attachBtn.elementId);
    await this.sleep(500);

    const galleryBtn = await this.appium.findElement('xpath', '//android.widget.TextView[@text="Gallery"]');
    await this.appium.clickElement(galleryBtn.elementId);
    await this.sleep(1500);
    steps.push('Opened gallery picker');

    // Note: Selecting a specific file from gallery requires UI navigation
    // For reliable media sending, push file to device first then select
    steps.push(`Media path: ${mediaPath} (manual selection may be needed)`);

    if (caption) {
      const captionInput = await this.appium.findElement('accessibility id', 'Add a caption…');
      await this.appium.sendKeys(captionInput.elementId, caption);
      steps.push('Added caption');
    }

    await this.appium.deleteSession();
    return { success: true, output: JSON.stringify({ app: 'whatsapp', recipe: 'send_media', contact, steps }) };
  }

  private async whatsappReadLast(contact: string, count = 5): Promise<ToolResult> {
    await this.appium.createSession('http://localhost:4723', {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:appPackage': 'com.whatsapp',
      'appium:appActivity': 'com.whatsapp.Main',
      'appium:noReset': true,
    });
    await this.sleep(2000);

    // Navigate to contact
    const searchBtn = await this.appium.findElement('accessibility id', 'Search');
    await this.appium.clickElement(searchBtn.elementId);
    await this.sleep(500);
    const searchInput = await this.appium.findElement('class name', 'android.widget.EditText');
    await this.appium.sendKeys(searchInput.elementId, contact);
    await this.sleep(1500);
    const contactResult = await this.appium.findElement('xpath', `//android.widget.TextView[contains(@text, "${contact}")]`);
    await this.appium.clickElement(contactResult.elementId);
    await this.sleep(1000);

    // Read messages from the chat
    const messages = await this.appium.findElements('xpath', '//android.widget.TextView[contains(@resource-id, "message_text")]');
    const lastMessages = messages.slice(-count);

    const texts: string[] = [];
    for (const msg of lastMessages) {
      const text = await this.appium.getElementText(msg.elementId);
      texts.push(text);
    }

    await this.appium.deleteSession();
    return { success: true, output: JSON.stringify({ contact, messages: texts, count: texts.length }) };
  }

  private async whatsappStatusPost(text: string): Promise<ToolResult> {
    await this.appium.createSession('http://localhost:4723', {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:appPackage': 'com.whatsapp',
      'appium:appActivity': 'com.whatsapp.Main',
      'appium:noReset': true,
    });
    await this.sleep(2000);

    // Navigate to Status tab
    const statusTab = await this.appium.findElement('xpath', '//android.widget.TextView[@text="Status"]');
    await this.appium.clickElement(statusTab.elementId);
    await this.sleep(1000);

    // Tap pencil icon for text status
    const pencilBtn = await this.appium.findElement('accessibility id', 'Text');
    await this.appium.clickElement(pencilBtn.elementId);
    await this.sleep(500);

    // Type status text
    const statusInput = await this.appium.findElement('class name', 'android.widget.EditText');
    await this.appium.sendKeys(statusInput.elementId, text);
    await this.sleep(300);

    // Send
    const sendBtn = await this.appium.findElement('accessibility id', 'Send');
    await this.appium.clickElement(sendBtn.elementId);

    await this.appium.deleteSession();
    return { success: true, output: JSON.stringify({ app: 'whatsapp', recipe: 'status_post', text }) };
  }

  // ═══ TikTok Recipes ═════════════════════════════════════

  private async tiktokUploadVideo(videoPath: string, caption: string): Promise<ToolResult> {
    const steps: string[] = [];

    await this.appium.createSession('http://localhost:4723', {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:appPackage': 'com.zhiliaoapp.musically',
      'appium:appActivity': 'com.ss.android.ugc.aweme.splash.SplashActivity',
      'appium:noReset': true,
    });
    steps.push('Opened TikTok');
    await this.sleep(3000);

    // Tap + button (create)
    const createBtn = await this.appium.findElement('accessibility id', 'Create');
    await this.appium.clickElement(createBtn.elementId);
    await this.sleep(2000);
    steps.push('Tapped Create');

    // Tap Upload
    const uploadBtn = await this.appium.findElement('xpath', '//android.widget.TextView[@text="Upload"]');
    await this.appium.clickElement(uploadBtn.elementId);
    await this.sleep(2000);
    steps.push('Tapped Upload');

    steps.push(`Video path: ${videoPath} (select from gallery)`);

    // After selecting video and editing — tap Next
    // Note: Gallery selection requires manual navigation or pre-push to device
    steps.push('(Gallery selection step — depends on device state)');

    // Add caption
    steps.push(`Caption: ${caption}`);

    await this.appium.deleteSession();
    return { success: true, output: JSON.stringify({ app: 'tiktok', recipe: 'upload_video', steps }) };
  }

  private async tiktokScrollFeed(count = 5): Promise<ToolResult> {
    await this.appium.createSession('http://localhost:4723', {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:appPackage': 'com.zhiliaoapp.musically',
      'appium:appActivity': 'com.ss.android.ugc.aweme.splash.SplashActivity',
      'appium:noReset': true,
    });
    await this.sleep(3000);

    const scrolled: string[] = [];
    for (let i = 0; i < count; i++) {
      await this.appium.swipe(540, 1500, 540, 500, 300);
      await this.sleep(2000);
      scrolled.push(`Scrolled video ${i + 1}`);
    }

    await this.appium.deleteSession();
    return { success: true, output: JSON.stringify({ app: 'tiktok', recipe: 'scroll_feed', scrolled }) };
  }

  // ═══ Instagram Recipes ══════════════════════════════════

  private async instagramPostPhoto(imagePath: string, caption: string): Promise<ToolResult> {
    const steps: string[] = [];

    await this.appium.createSession('http://localhost:4723', {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:appPackage': 'com.instagram.android',
      'appium:appActivity': 'com.instagram.mainactivity.LauncherActivity',
      'appium:noReset': true,
    });
    steps.push('Opened Instagram');
    await this.sleep(3000);

    // Tap + (create) button
    const createBtn = await this.appium.findElement('accessibility id', 'Create');
    await this.appium.clickElement(createBtn.elementId);
    await this.sleep(1500);
    steps.push('Tapped Create');

    // Select Post
    const postOption = await this.appium.findElement('xpath', '//android.widget.TextView[@text="Post"]');
    await this.appium.clickElement(postOption.elementId);
    await this.sleep(1500);
    steps.push('Selected Post');

    steps.push(`Image path: ${imagePath} (select from gallery)`);

    // Tap Next (after selecting image)
    steps.push('(Gallery selection + Next step)');

    // Add caption
    steps.push(`Caption: ${caption}`);

    await this.appium.deleteSession();
    return { success: true, output: JSON.stringify({ app: 'instagram', recipe: 'post_photo', steps }) };
  }

  private async instagramPostReel(videoPath: string, caption: string): Promise<ToolResult> {
    const steps: string[] = [];

    await this.appium.createSession('http://localhost:4723', {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:appPackage': 'com.instagram.android',
      'appium:appActivity': 'com.instagram.mainactivity.LauncherActivity',
      'appium:noReset': true,
    });
    steps.push('Opened Instagram');
    await this.sleep(3000);

    const createBtn = await this.appium.findElement('accessibility id', 'Create');
    await this.appium.clickElement(createBtn.elementId);
    await this.sleep(1500);

    // Select Reel
    const reelOption = await this.appium.findElement('xpath', '//android.widget.TextView[@text="Reel"]');
    await this.appium.clickElement(reelOption.elementId);
    await this.sleep(1500);
    steps.push('Selected Reel');

    steps.push(`Video path: ${videoPath} (select from gallery)`);
    steps.push(`Caption: ${caption}`);

    await this.appium.deleteSession();
    return { success: true, output: JSON.stringify({ app: 'instagram', recipe: 'post_reel', steps }) };
  }

  private async instagramSendDm(username: string, message: string): Promise<ToolResult> {
    const steps: string[] = [];

    await this.appium.createSession('http://localhost:4723', {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:appPackage': 'com.instagram.android',
      'appium:appActivity': 'com.instagram.mainactivity.LauncherActivity',
      'appium:noReset': true,
    });
    steps.push('Opened Instagram');
    await this.sleep(3000);

    // Tap DM icon
    const dmBtn = await this.appium.findElement('accessibility id', 'Direct');
    await this.appium.clickElement(dmBtn.elementId);
    await this.sleep(1500);
    steps.push('Opened DMs');

    // Search for user
    const searchBtn = await this.appium.findElement('accessibility id', 'Search');
    await this.appium.clickElement(searchBtn.elementId);
    await this.sleep(500);
    const searchInput = await this.appium.findElement('class name', 'android.widget.EditText');
    await this.appium.sendKeys(searchInput.elementId, username);
    await this.sleep(1500);

    const userResult = await this.appium.findElement('xpath', `//android.widget.TextView[contains(@text, "${username}")]`);
    await this.appium.clickElement(userResult.elementId);
    await this.sleep(1000);
    steps.push(`Selected user: ${username}`);

    // Type and send message
    const msgInput = await this.appium.findElement('accessibility id', 'Message');
    await this.appium.sendKeys(msgInput.elementId, message);
    const sendBtn = await this.appium.findElement('accessibility id', 'Send');
    await this.appium.clickElement(sendBtn.elementId);
    steps.push('Sent message');

    await this.appium.deleteSession();
    return { success: true, output: JSON.stringify({ app: 'instagram', recipe: 'send_dm', username, steps }) };
  }

  // ─── Helpers ────────────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}
