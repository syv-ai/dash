import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { app } from 'electron';
import type { ChildProcess } from 'node:child_process';
import type { WebContents } from 'electron';
import type { PixelAgentsConfig, PixelAgentsStatus, PixelAgentsOfficeStatus } from '@shared/types';

const CONFIG_DIR = join(homedir(), '.pixel-agents');
const CONFIG_PATH = join(CONFIG_DIR, 'offices.json');
const RESPAWN_DELAY = 3000;

export class PixelAgentsService {
  private static child: ChildProcess | null = null;
  private static officeStatuses: Record<string, PixelAgentsOfficeStatus> = {};
  private static respawnTimer: ReturnType<typeof setTimeout> | null = null;
  private static sender: WebContents | null = null;
  private static running = false;

  static setSender(sender: WebContents): void {
    PixelAgentsService.sender = sender;
  }

  static readConfig(): PixelAgentsConfig | null {
    try {
      if (!existsSync(CONFIG_PATH)) return null;
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    } catch {
      return null;
    }
  }

  static writeConfig(config: PixelAgentsConfig): void {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(
      CONFIG_PATH,
      JSON.stringify(
        {
          name: config.name,
          palette: config.palette ?? 0,
          hueShift: config.hueShift ?? 0,
          offices: config.offices.map((o) => ({
            id: o.id,
            url: o.url,
            token: o.token || null,
            enabled: o.enabled,
          })),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  }

  static start(): void {
    if (PixelAgentsService.child) return;

    const binPath = PixelAgentsService.resolveBinPath();
    if (!binPath) {
      console.error('[pixel-agents] Could not resolve watcher binary');
      return;
    }

    console.log(`[pixel-agents] Starting watcher: ${binPath} --config ${CONFIG_PATH}`);

    PixelAgentsService.running = true;
    PixelAgentsService.officeStatuses = {};

    const child = spawn(binPath, ['--config', CONFIG_PATH], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });

    PixelAgentsService.child = child;

    // Parse stdout line-by-line for status updates
    if (child.stdout) {
      const rl = createInterface({ input: child.stdout });
      rl.on('line', (line) => {
        console.log(`[pixel-agents] ${line}`);
        PixelAgentsService.parseLine(line);
      });
    }

    if (child.stderr) {
      const rl = createInterface({ input: child.stderr });
      rl.on('line', (line) => {
        console.error(`[pixel-agents] ${line}`);
      });
    }

    child.on('exit', (code, signal) => {
      console.log(`[pixel-agents] Watcher exited (code=${code}, signal=${signal})`);
      PixelAgentsService.child = null;

      // Mark all offices as disconnected
      for (const id of Object.keys(PixelAgentsService.officeStatuses)) {
        PixelAgentsService.officeStatuses[id] = 'disconnected';
      }
      PixelAgentsService.emitStatus();

      // Auto-respawn if we're supposed to be running
      if (PixelAgentsService.running) {
        PixelAgentsService.respawnTimer = setTimeout(() => {
          console.log('[pixel-agents] Respawning watcher...');
          PixelAgentsService.child = null;
          PixelAgentsService.start();
        }, RESPAWN_DELAY);
      }
    });

    PixelAgentsService.emitStatus();
  }

  static stop(): void {
    PixelAgentsService.running = false;

    if (PixelAgentsService.respawnTimer) {
      clearTimeout(PixelAgentsService.respawnTimer);
      PixelAgentsService.respawnTimer = null;
    }

    if (PixelAgentsService.child) {
      PixelAgentsService.child.kill('SIGTERM');
      PixelAgentsService.child = null;
    }

    PixelAgentsService.officeStatuses = {};
    PixelAgentsService.emitStatus();
    console.log('[pixel-agents] Stopped');
  }

  static restart(): void {
    PixelAgentsService.stop();
    PixelAgentsService.start();
  }

  static getStatus(): PixelAgentsStatus {
    return {
      running: PixelAgentsService.running && PixelAgentsService.child !== null,
      offices: { ...PixelAgentsService.officeStatuses },
    };
  }

  private static parseLine(line: string): void {
    // Patterns: [officeId] Connected to ..., [officeId] Registered as ..., [officeId] Disconnected...
    const match = line.match(/^\[([^\]]+)\]\s+(.+)$/);
    if (!match) return;

    const [, id, msg] = match;
    if (id === 'watcher') return; // Meta messages, not per-office

    let status: PixelAgentsOfficeStatus | null = null;
    if (msg.startsWith('Registered as ')) {
      status = 'registered';
    } else if (msg.startsWith('Connected to ')) {
      status = 'connected';
    } else if (msg.startsWith('Disconnected')) {
      status = 'disconnected';
    }

    if (status) {
      PixelAgentsService.officeStatuses[id] = status;
      PixelAgentsService.emitStatus();
    }
  }

  private static emitStatus(): void {
    const sender = PixelAgentsService.sender;
    if (sender && !sender.isDestroyed()) {
      sender.send('pixelAgents:statusChanged', PixelAgentsService.getStatus());
    }
  }

  private static resolveBinPath(): string | null {
    // In dev: node_modules/.bin/pixel-agents-watcher
    const devPath = join(app.getAppPath(), 'node_modules', '.bin', 'pixel-agents-watcher');
    if (existsSync(devPath)) return devPath;

    // Packaged app: try resolving the module entry directly
    try {
      return require.resolve('@syv-ai/pixel-agents-watcher/watcher.js');
    } catch {
      return null;
    }
  }
}
