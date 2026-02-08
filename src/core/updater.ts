import { promises as fs } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import logger from '../utils/logger.js';

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  changelog: string;
  updateUrl: string;
}

const VERSION_FILE = path.resolve('package.json');
const REPO_URL = 'https://api.github.com/repos';

export class Updater {
  private repoOwner: string;
  private repoName: string;
  private currentVersion: string = '0.0.0';
  private checkIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private onUpdateAvailable: ((info: UpdateInfo) => void) | null = null;

  constructor(params: {
    repoOwner: string;
    repoName: string;
    checkIntervalMs?: number;
  }) {
    this.repoOwner = params.repoOwner;
    this.repoName = params.repoName;
    this.checkIntervalMs = params.checkIntervalMs ?? 3600000; // 1 hour
  }

  async init(): Promise<void> {
    try {
      const pkgContent = await fs.readFile(VERSION_FILE, 'utf-8');
      const pkg = JSON.parse(pkgContent);
      this.currentVersion = pkg.version ?? '0.0.0';
    } catch {
      logger.warn('Could not read package.json version');
    }
    logger.info(`Updater initialized: v${this.currentVersion}`);
  }

  /** Start periodic update checks */
  startAutoCheck(callback: (info: UpdateInfo) => void): void {
    this.onUpdateAvailable = callback;
    this.timer = setInterval(async () => {
      try {
        const info = await this.checkForUpdates();
        if (info.hasUpdate && this.onUpdateAvailable) {
          this.onUpdateAvailable(info);
        }
      } catch (err: any) {
        logger.debug('Update check failed', { error: err.message });
      }
    }, this.checkIntervalMs);

    // Check immediately
    this.checkForUpdates().then(info => {
      if (info.hasUpdate && this.onUpdateAvailable) {
        this.onUpdateAvailable(info);
      }
    }).catch(() => {});
  }

  /** Check for updates from GitHub releases */
  async checkForUpdates(): Promise<UpdateInfo> {
    const url = `${REPO_URL}/${this.repoOwner}/${this.repoName}/releases/latest`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/vnd.github.v3+json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return {
        currentVersion: this.currentVersion,
        latestVersion: this.currentVersion,
        hasUpdate: false,
        changelog: '',
        updateUrl: '',
      };
    }

    const release = await response.json() as { tag_name: string; body: string; html_url: string };
    const latestVersion = release.tag_name.replace(/^v/, '');
    const hasUpdate = this.compareVersions(latestVersion, this.currentVersion) > 0;

    return {
      currentVersion: this.currentVersion,
      latestVersion,
      hasUpdate,
      changelog: (release.body ?? '').slice(0, 2000),
      updateUrl: release.html_url ?? '',
    };
  }

  /** Apply update by pulling from git and rebuilding */
  async applyUpdate(): Promise<{ success: boolean; message: string }> {
    try {
      const projectDir = path.resolve('.');

      // Git pull
      execSync('git pull origin main', { cwd: projectDir, timeout: 30000, stdio: 'pipe' });

      // Install dependencies
      execSync('pnpm install --frozen-lockfile', { cwd: projectDir, timeout: 120000, stdio: 'pipe' });

      // Build
      execSync('pnpm run build', { cwd: projectDir, timeout: 120000, stdio: 'pipe' });

      // Read new version
      const pkgContent = await fs.readFile(VERSION_FILE, 'utf-8');
      const pkg = JSON.parse(pkgContent);
      const newVersion = pkg.version ?? 'unknown';

      logger.info(`Update applied: v${this.currentVersion} → v${newVersion}`);
      return { success: true, message: `Updated to v${newVersion}. Restart required.` };
    } catch (err: any) {
      logger.error('Update failed', { error: err.message });
      return { success: false, message: `Update failed: ${err.message}` };
    }
  }

  /** Compare two semver version strings. Returns >0 if a > b, <0 if a < b, 0 if equal */
  private compareVersions(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      const va = pa[i] ?? 0;
      const vb = pb[i] ?? 0;
      if (va > vb) return 1;
      if (va < vb) return -1;
    }
    return 0;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getCurrentVersion(): string { return this.currentVersion; }
}
