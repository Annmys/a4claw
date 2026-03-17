import { BaseTool, ToolResult } from './base-tool.js';
import { AppiumClient } from '../../actions/mobile/appium-client.js';
import { AppRecipes } from '../../actions/mobile/app-recipes.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface DeviceInfo {
  id: string;
  model: string;
  android_version: string;
  battery: string;
  screen: string;
}

export class DeviceTool extends BaseTool {
  name = 'device';
  description = 'Control Android devices — tap, swipe, type, screenshot, app automation, ADB commands';

  private appium: AppiumClient;
  private recipes: AppRecipes;

  constructor() {
    super();
    this.appium = new AppiumClient();
    this.recipes = new AppRecipes(this.appium);
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = input.action as string;
    if (!action) return { success: false, output: '', error: 'action is required' };

    try {
      switch (action) {
        // ─── Device Info ───
        case 'list_devices':
          return this.listDevices();
        case 'device_info':
          return this.deviceInfo(input.deviceId as string);

        // ─── Touch Actions ───
        case 'tap':
          return this.tap(input.x as number, input.y as number, input.deviceId as string);
        case 'long_press':
          return this.longPress(input.x as number, input.y as number, input.duration as number, input.deviceId as string);
        case 'swipe':
          return this.swipe(
            input.startX as number, input.startY as number,
            input.endX as number, input.endY as number,
            input.duration as number, input.deviceId as string
          );
        case 'double_tap':
          return this.doubleTap(input.x as number, input.y as number, input.deviceId as string);

        // ─── Text Input ───
        case 'type':
          return this.typeText(input.text as string, input.deviceId as string);
        case 'key':
          return this.sendKey(input.keycode as string, input.deviceId as string);

        // ─── Screen ───
        case 'screenshot':
          return this.screenshot(input.deviceId as string);
        case 'screen_xml':
          return this.getScreenXml(input.deviceId as string);

        // ─── Apps ───
        case 'open_app':
          return this.openApp(input.packageName as string, input.deviceId as string);
        case 'close_app':
          return this.closeApp(input.packageName as string, input.deviceId as string);
        case 'list_apps':
          return this.listApps(input.deviceId as string);
        case 'install_app':
          return this.installApp(input.apkPath as string, input.deviceId as string);
        case 'current_app':
          return this.currentApp(input.deviceId as string);

        // ─── Navigation ───
        case 'back':
          return this.adbKey('KEYCODE_BACK', input.deviceId as string);
        case 'home':
          return this.adbKey('KEYCODE_HOME', input.deviceId as string);
        case 'recent':
          return this.adbKey('KEYCODE_APP_SWITCH', input.deviceId as string);

        // ─── Clipboard ───
        case 'get_clipboard':
          return this.getClipboard(input.deviceId as string);
        case 'set_clipboard':
          return this.setClipboard(input.text as string, input.deviceId as string);

        // ─── ADB Direct ───
        case 'adb':
          return this.adbCommand(input.command as string, input.deviceId as string);
        case 'shell':
          return this.adbShell(input.command as string, input.deviceId as string);

        // ─── Appium (W3C) ───
        case 'appium_start':
          return this.appiumStart(input as Record<string, unknown>);
        case 'appium_find':
          return this.appiumFind(input.strategy as string, input.selector as string);
        case 'appium_click':
          return this.appiumClick(input.elementId as string);
        case 'appium_send_keys':
          return this.appiumSendKeys(input.elementId as string, input.text as string);
        case 'appium_stop':
          return this.appiumStop();

        // ─── App Recipes ───
        case 'recipe':
          return this.runRecipe(input.app as string, input.recipe as string, input.params as Record<string, unknown>);
        case 'list_recipes':
          return this.listRecipes();

        // ─── agent-device CLI ───
        case 'agent_device':
          return this.agentDeviceCli(input.command as string, input.args as string);

        default:
          return { success: false, output: '', error: `Unknown device action: ${action}` };
      }
    } catch (err: any) {
      this.error(`Device action "${action}" failed`, { error: err.message });
      return { success: false, output: '', error: err.message };
    }
  }

  // ─── ADB Helpers ─────────────────────────────────────────

  private deviceFlag(deviceId?: string): string {
    return deviceId ? `-s ${deviceId}` : '';
  }

  private async adb(args: string, deviceId?: string): Promise<string> {
    const cmd = `adb ${this.deviceFlag(deviceId)} ${args}`;
    this.log(`ADB: ${cmd}`);
    const { stdout } = await execAsync(cmd, { timeout: 30000 });
    return stdout.trim();
  }

  // ─── Device Info ─────────────────────────────────────────

  private async listDevices(): Promise<ToolResult> {
    const out = await this.adb('devices -l');
    const lines = out.split('\n').slice(1).filter(l => l.trim());
    const devices = lines.map(line => {
      const parts = line.split(/\s+/);
      const id = parts[0];
      const status = parts[1];
      const model = line.match(/model:(\S+)/)?.[1] || 'unknown';
      return { id, status, model };
    });
    return { success: true, output: JSON.stringify({ devices, count: devices.length }, null, 2) };
  }

  private async deviceInfo(deviceId?: string): Promise<ToolResult> {
    const [model, version, battery, resolution] = await Promise.all([
      this.adb('shell getprop ro.product.model', deviceId),
      this.adb('shell getprop ro.build.version.release', deviceId),
      this.adb('shell dumpsys battery', deviceId),
      this.adb('shell wm size', deviceId),
    ]);

    const batteryLevel = battery.match(/level: (\d+)/)?.[1] || '?';
    const info: DeviceInfo = {
      id: deviceId || 'default',
      model,
      android_version: version,
      battery: `${batteryLevel}%`,
      screen: resolution.replace('Physical size: ', ''),
    };
    return { success: true, output: JSON.stringify(info, null, 2) };
  }

  // ─── Touch Actions ──────────────────────────────────────

  private async tap(x: number, y: number, deviceId?: string): Promise<ToolResult> {
    await this.adb(`shell input tap ${x} ${y}`, deviceId);
    return { success: true, output: `Tapped at (${x}, ${y})` };
  }

  private async longPress(x: number, y: number, duration = 1000, deviceId?: string): Promise<ToolResult> {
    await this.adb(`shell input swipe ${x} ${y} ${x} ${y} ${duration}`, deviceId);
    return { success: true, output: `Long pressed at (${x}, ${y}) for ${duration}ms` };
  }

  private async swipe(startX: number, startY: number, endX: number, endY: number, duration = 300, deviceId?: string): Promise<ToolResult> {
    await this.adb(`shell input swipe ${startX} ${startY} ${endX} ${endY} ${duration || 300}`, deviceId);
    return { success: true, output: `Swiped from (${startX},${startY}) to (${endX},${endY})` };
  }

  private async doubleTap(x: number, y: number, deviceId?: string): Promise<ToolResult> {
    await this.adb(`shell input tap ${x} ${y}`, deviceId);
    await new Promise(r => setTimeout(r, 100));
    await this.adb(`shell input tap ${x} ${y}`, deviceId);
    return { success: true, output: `Double tapped at (${x}, ${y})` };
  }

  // ─── Text Input ─────────────────────────────────────────

  private async typeText(text: string, deviceId?: string): Promise<ToolResult> {
    // ADB text input: escape special chars, use broadcast for Unicode/Hebrew
    const hasUnicode = /[^\x00-\x7F]/.test(text);
    if (hasUnicode) {
      // Use ADBKeyboard for Unicode text
      await this.adb(`shell am broadcast -a ADB_INPUT_TEXT --es msg '${text.replace(/'/g, "'\\''")}'`, deviceId);
    } else {
      const escaped = text.replace(/ /g, '%s').replace(/[&|;<>]/g, '\\$&');
      await this.adb(`shell input text "${escaped}"`, deviceId);
    }
    return { success: true, output: `Typed: "${text}"` };
  }

  private async sendKey(keycode: string, deviceId?: string): Promise<ToolResult> {
    const code = keycode.startsWith('KEYCODE_') ? keycode : `KEYCODE_${keycode.toUpperCase()}`;
    await this.adb(`shell input keyevent ${code}`, deviceId);
    return { success: true, output: `Sent key: ${code}` };
  }

  private async adbKey(keycode: string, deviceId?: string): Promise<ToolResult> {
    await this.adb(`shell input keyevent ${keycode}`, deviceId);
    return { success: true, output: `Key: ${keycode}` };
  }

  // ─── Screen ─────────────────────────────────────────────

  private async screenshot(deviceId?: string): Promise<ToolResult> {
    const ts = Date.now();
    const remotePath = `/sdcard/screenshot_${ts}.png`;
    const localPath = `./data/screenshots/screenshot_${ts}.png`;

    await execAsync('mkdir -p ./data/screenshots');
    await this.adb(`shell screencap -p ${remotePath}`, deviceId);
    await this.adb(`pull ${remotePath} ${localPath}`, deviceId);
    await this.adb(`shell rm ${remotePath}`, deviceId);

    return { success: true, output: JSON.stringify({ path: localPath, timestamp: ts }) };
  }

  private async getScreenXml(deviceId?: string): Promise<ToolResult> {
    await this.adb('shell uiautomator dump /sdcard/ui.xml', deviceId);
    const xml = await this.adb('shell cat /sdcard/ui.xml', deviceId);
    await this.adb('shell rm /sdcard/ui.xml', deviceId);
    return { success: true, output: xml.slice(0, 15000) }; // cap at 15KB
  }

  // ─── Apps ───────────────────────────────────────────────

  private async openApp(packageName: string, deviceId?: string): Promise<ToolResult> {
    const launchCmd = `shell monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`;
    await this.adb(launchCmd, deviceId);
    return { success: true, output: `Opened: ${packageName}` };
  }

  private async closeApp(packageName: string, deviceId?: string): Promise<ToolResult> {
    await this.adb(`shell am force-stop ${packageName}`, deviceId);
    return { success: true, output: `Closed: ${packageName}` };
  }

  private async listApps(deviceId?: string): Promise<ToolResult> {
    const out = await this.adb('shell pm list packages -3', deviceId);
    const apps = out.split('\n').map(l => l.replace('package:', '').trim()).filter(Boolean);
    return { success: true, output: JSON.stringify({ apps, count: apps.length }) };
  }

  private async installApp(apkPath: string, deviceId?: string): Promise<ToolResult> {
    const out = await this.adb(`install -r "${apkPath}"`, deviceId);
    return { success: true, output: out };
  }

  private async currentApp(deviceId?: string): Promise<ToolResult> {
    const out = await this.adb('shell dumpsys activity activities | grep mResumedActivity', deviceId);
    const match = out.match(/(\S+\/\S+)/);
    return { success: true, output: match ? match[1] : out };
  }

  // ─── Clipboard ──────────────────────────────────────────

  private async getClipboard(deviceId?: string): Promise<ToolResult> {
    const out = await this.adb('shell am broadcast -a clipper.get', deviceId);
    const match = out.match(/data="(.*)"/);
    return { success: true, output: match ? match[1] : '(empty or no clipper)' };
  }

  private async setClipboard(text: string, deviceId?: string): Promise<ToolResult> {
    await this.adb(`shell am broadcast -a clipper.set -e text "${text.replace(/"/g, '\\"')}"`, deviceId);
    return { success: true, output: `Clipboard set: "${text.slice(0, 50)}"` };
  }

  // ─── ADB Direct ─────────────────────────────────────────

  private async adbCommand(command: string, deviceId?: string): Promise<ToolResult> {
    const out = await this.adb(command, deviceId);
    return { success: true, output: out.slice(0, 10000) };
  }

  private async adbShell(command: string, deviceId?: string): Promise<ToolResult> {
    const out = await this.adb(`shell ${command}`, deviceId);
    return { success: true, output: out.slice(0, 10000) };
  }

  // ─── Appium (W3C) ──────────────────────────────────────

  private async appiumStart(input: Record<string, unknown>): Promise<ToolResult> {
    const caps: Record<string, unknown> = {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
    };
    if (input.packageName) caps['appium:appPackage'] = input.packageName;
    if (input.activityName) caps['appium:appActivity'] = input.activityName;
    if (input.deviceId) caps['appium:udid'] = input.deviceId;
    if (input.noReset !== undefined) caps['appium:noReset'] = input.noReset;

    const serverUrl = (input.serverUrl as string) || 'http://localhost:4723';
    const sessionId = await this.appium.createSession(serverUrl, caps);
    return { success: true, output: JSON.stringify({ sessionId, capabilities: caps }) };
  }

  private async appiumFind(strategy: string, selector: string): Promise<ToolResult> {
    const element = await this.appium.findElement(strategy, selector);
    return { success: true, output: JSON.stringify(element) };
  }

  private async appiumClick(elementId: string): Promise<ToolResult> {
    await this.appium.clickElement(elementId);
    return { success: true, output: `Clicked element: ${elementId}` };
  }

  private async appiumSendKeys(elementId: string, text: string): Promise<ToolResult> {
    await this.appium.sendKeys(elementId, text);
    return { success: true, output: `Sent keys to ${elementId}: "${text}"` };
  }

  private async appiumStop(): Promise<ToolResult> {
    await this.appium.deleteSession();
    return { success: true, output: 'Appium session closed' };
  }

  // ─── App Recipes ────────────────────────────────────────

  private async runRecipe(app: string, recipe: string, params?: Record<string, unknown>): Promise<ToolResult> {
    const result = await this.recipes.run(app, recipe, params || {});
    return result;
  }

  private listRecipes(): ToolResult {
    const recipes = this.recipes.listAll();
    return { success: true, output: JSON.stringify(recipes, null, 2) };
  }

  // ─── agent-device CLI ──────────────────────────────────

  private async agentDeviceCli(command: string, args?: string): Promise<ToolResult> {
    const cmd = `npx agent-device ${command} ${args || ''}`.trim();
    this.log(`agent-device CLI: ${cmd}`);
    const { stdout } = await execAsync(cmd, { timeout: 30000 });
    return { success: true, output: stdout.trim() };
  }
}
