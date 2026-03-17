/**
 * Pixel Agents Watcher Service
 *
 * Manages the pixel-agents watcher as a child process.
 * Clones the repo to ~/.pixel-agents/pixel-agents/ on first use,
 * installs dependencies, and spawns watcher.js with the user's config.
 *
 * If the user doesn't have access to the repo, they are notified.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ChildProcess } from 'node:child_process';

const execFileAsync = promisify(execFile);

const PIXEL_AGENTS_DIR = join(homedir(), '.pixel-agents');
const REPO_DIR = join(PIXEL_AGENTS_DIR, 'pixel-agents');
const WATCHER_DIR = join(REPO_DIR, 'packages', 'office-proxy');
const WATCHER_JS = join(WATCHER_DIR, 'watcher.js');
const ENV_FILE = join(PIXEL_AGENTS_DIR, '.env');
const REPO_URL = 'https://github.com/syv-ai/pixel-agents.git';
const DEFAULT_SERVER = 'wss://kontoret.syv.ai';

export interface PixelAgentsConfig {
  name: string;
  token: string;
  serverUrl?: string;
}

type WatcherStatus = 'stopped' | 'installing' | 'running' | 'error';

export class PixelAgentsService {
  private static instance: PixelAgentsService | null = null;
  private child: ChildProcess | null = null;
  private status: WatcherStatus = 'stopped';
  private errorMessage: string | null = null;
  private config: PixelAgentsConfig | null = null;

  static async start(config: PixelAgentsConfig): Promise<void> {
    if (PixelAgentsService.instance) {
      PixelAgentsService.stop();
    }
    const svc = new PixelAgentsService();
    svc.config = config;
    PixelAgentsService.instance = svc;

    PixelAgentsService.writeEnvFile(config);
    await svc.ensureInstalledAndStart();
  }

  static stop(): void {
    const svc = PixelAgentsService.instance;
    if (!svc) return;

    if (svc.child) {
      svc.child.kill('SIGTERM');
      svc.child = null;
    }
    svc.status = 'stopped';
    svc.errorMessage = null;
    PixelAgentsService.instance = null;
    console.log('[pixel-agents] Stopped watcher');
  }

  static getStatus(): {
    running: boolean;
    connected: boolean;
    agentCount: number;
    status: WatcherStatus;
    error: string | null;
    installed: boolean;
  } {
    const svc = PixelAgentsService.instance;
    const installed = existsSync(WATCHER_JS);
    if (!svc) {
      return {
        running: false,
        connected: false,
        agentCount: 0,
        status: 'stopped',
        error: null,
        installed,
      };
    }
    return {
      running: svc.status === 'running',
      connected: svc.status === 'running' && svc.child !== null,
      agentCount: 0, // child process manages its own agents
      status: svc.status,
      error: svc.errorMessage,
      installed,
    };
  }

  /**
   * Write the ~/.pixel-agents/.env file.
   */
  static writeEnvFile(config: PixelAgentsConfig): void {
    try {
      if (!existsSync(PIXEL_AGENTS_DIR)) {
        mkdirSync(PIXEL_AGENTS_DIR, { recursive: true });
      }
      const lines = [
        `PIXEL_AGENTS_TOKEN=${config.token}`,
        `PIXEL_AGENTS_NAME=${config.name}`,
        `PIXEL_AGENTS_SERVER=${config.serverUrl?.trim() || DEFAULT_SERVER}`,
      ];
      writeFileSync(ENV_FILE, lines.join('\n') + '\n', 'utf-8');
    } catch (err) {
      console.error(`[pixel-agents] Failed to write ${ENV_FILE}:`, err);
    }
  }

  /**
   * Read existing config from ~/.pixel-agents/.env if it exists.
   */
  static readEnvFile(): PixelAgentsConfig | null {
    try {
      if (!existsSync(ENV_FILE)) return null;
      const text = readFileSync(ENV_FILE, 'utf-8');
      const vars: Record<string, string> = {};
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        vars[key] = val;
      }
      const token = vars['PIXEL_AGENTS_TOKEN'] || '';
      const name = vars['PIXEL_AGENTS_NAME'] || '';
      if (!token && !name) return null;
      return {
        token,
        name,
        serverUrl: vars['PIXEL_AGENTS_SERVER'] || DEFAULT_SERVER,
      };
    } catch {
      return null;
    }
  }

  /**
   * Try to install the pixel-agents repo, then start the watcher.
   */
  private async ensureInstalledAndStart(): Promise<void> {
    if (existsSync(WATCHER_JS)) {
      // Already installed — pull latest and start
      await this.updateRepo();
      this.spawnWatcher();
      return;
    }

    // Need to install
    this.status = 'installing';
    console.log('[pixel-agents] Watcher not found, installing...');

    try {
      await this.cloneAndInstall();
      this.spawnWatcher();
    } catch (err) {
      const msg = String(err);
      this.status = 'error';
      if (
        msg.includes('Authentication failed') ||
        msg.includes('could not read Username') ||
        msg.includes('Permission denied') ||
        msg.includes('Repository not found') ||
        msg.includes('fatal:')
      ) {
        this.errorMessage =
          'No access to pixel-agents repo. Ask your team for access to github.com/syv-ai/pixel-agents';
      } else {
        this.errorMessage = `Install failed: ${msg}`;
      }
      console.error(`[pixel-agents] ${this.errorMessage}`);
    }
  }

  private async cloneAndInstall(): Promise<void> {
    if (!existsSync(PIXEL_AGENTS_DIR)) {
      mkdirSync(PIXEL_AGENTS_DIR, { recursive: true });
    }

    // Sparse clone — only checkout packages/office-proxy/
    console.log(`[pixel-agents] Cloning ${REPO_URL} (sparse: packages/office-proxy/)...`);
    await execFileAsync(
      'git',
      ['clone', '--depth', '1', '--filter=blob:none', '--sparse', REPO_URL, REPO_DIR],
      { timeout: 60000 },
    );
    await execFileAsync('git', ['sparse-checkout', 'set', 'packages/office-proxy'], {
      cwd: REPO_DIR,
      timeout: 15000,
    });

    // Install dependencies in the office-proxy package
    console.log('[pixel-agents] Installing dependencies...');
    await execFileAsync('npm', ['install', '--production'], {
      cwd: WATCHER_DIR,
      timeout: 60000,
    });

    console.log('[pixel-agents] Installation complete');
  }

  private async updateRepo(): Promise<void> {
    try {
      await execFileAsync('git', ['pull', '--ff-only'], {
        cwd: REPO_DIR,
        timeout: 15000,
      });
      console.log('[pixel-agents] Updated to latest');
    } catch {
      // Not critical — use whatever version we have
      console.log('[pixel-agents] Could not update, using existing version');
    }
  }

  private spawnWatcher(): void {
    if (!this.config) return;

    const args = [
      WATCHER_JS,
      '--name',
      this.config.name,
      '--server',
      this.config.serverUrl?.trim() || DEFAULT_SERVER,
      '--token',
      this.config.token,
    ];

    console.log(`[pixel-agents] Spawning watcher: node ${args.join(' ')}`);

    this.child = spawn('node', args, {
      cwd: WATCHER_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });

    this.status = 'running';
    this.errorMessage = null;

    this.child.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().trim();
      if (lines) console.log(`[pixel-agents] ${lines}`);
    });

    this.child.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().trim();
      if (lines) console.error(`[pixel-agents] ${lines}`);
    });

    this.child.on('exit', (code, signal) => {
      console.log(`[pixel-agents] Watcher exited (code=${code}, signal=${signal})`);
      this.child = null;

      // Only restart if we're still supposed to be running
      if (this.status === 'running') {
        this.status = 'error';
        this.errorMessage = `Watcher exited unexpectedly (code ${code})`;

        // Auto-restart after 5 seconds
        setTimeout(() => {
          if (PixelAgentsService.instance === this && this.config) {
            console.log('[pixel-agents] Restarting watcher...');
            this.spawnWatcher();
          }
        }, 5000);
      }
    });
  }
}
