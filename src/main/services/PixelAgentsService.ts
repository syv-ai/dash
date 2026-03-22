import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { app } from 'electron';
import type { ChildProcess } from 'node:child_process';
import type { WebContents } from 'electron';
import type { PixelAgentsConfig, PixelAgentsStatus, PixelAgentsOfficeStatus } from '@shared/types';
import { ConnectionConfigService } from './ConnectionConfigService';

// Config lives inside Electron's userData dir (~/Library/Application Support/Dash/)
// The watcher is spawned with --config pointing here, so no need for ~/.pixel-agents/
function getConfigPath(): string {
  return join(app.getPath('userData'), 'pixel-agents.json');
}
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
      if (!existsSync(getConfigPath())) return null;
      const raw = JSON.parse(readFileSync(getConfigPath(), 'utf-8'));
      const encryptedTokens = ConnectionConfigService.getAllPixelAgentsTokens();
      return {
        name: raw.name || '',
        palette: raw.palette,
        hueShift: raw.hueShift,
        phrases: raw.phrases || [],
        offices: (raw.offices || []).map(
          (o: { id: string; url: string; token?: string; enabled: boolean }) => ({
            id: o.id,
            url: o.url,
            // Check encrypted storage for token presence (file may have been scrubbed)
            token: encryptedTokens[o.id] ? '••••••••' : null,
            enabled: o.enabled,
          }),
        ),
      };
    } catch {
      return null;
    }
  }

  /**
   * Save config from the renderer. Tokens in the config are either:
   * - A new plaintext token (to be encrypted and stored)
   * - The placeholder '••••••••' (keep existing encrypted token)
   * - null (public office, remove any stored token)
   */
  static saveConfig(config: PixelAgentsConfig): void {
    // Track which office IDs are still present
    const currentIds = new Set(config.offices.map((o) => o.id));

    // Clean up tokens for removed offices
    const allTokens = ConnectionConfigService.getAllPixelAgentsTokens();
    for (const officeId of Object.keys(allTokens)) {
      if (!currentIds.has(officeId)) {
        ConnectionConfigService.removePixelAgentsToken(officeId);
      }
    }

    // Store new/updated tokens in encrypted storage
    for (const office of config.offices) {
      if (office.token && office.token !== '••••••••') {
        // New plaintext token — encrypt and store
        ConnectionConfigService.savePixelAgentsToken(office.id, office.token);
      } else if (office.token === null) {
        // Public office — remove any stored token
        ConnectionConfigService.removePixelAgentsToken(office.id);
      }
      // '••••••••' = keep existing token, do nothing
    }

    // Write offices.json with decrypted tokens for the watcher
    PixelAgentsService.writeOfficesJson(config);
  }

  /** Write offices.json with real (decrypted) tokens for the watcher process */
  private static writeOfficesJson(config: PixelAgentsConfig): void {
    const decryptedTokens = ConnectionConfigService.getAllPixelAgentsTokens();

    writeFileSync(
      getConfigPath(),
      JSON.stringify(
        {
          name: config.name,
          palette: config.palette ?? 0,
          hueShift: config.hueShift ?? 0,
          phrases: config.phrases || [],
          offices: config.offices.map((o) => ({
            id: o.id,
            url: o.url,
            token: decryptedTokens[o.id] || null,
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

    // Ensure config file has decrypted tokens (may have been scrubbed by stop())
    PixelAgentsService.hydrateConfigTokens();

    const binPath = PixelAgentsService.resolveBinPath();
    if (!binPath) {
      console.error('[pixel-agents] Could not resolve watcher binary');
      return;
    }

    console.log(`[pixel-agents] Starting watcher: ${binPath} --config ${getConfigPath()}`);

    PixelAgentsService.running = true;
    PixelAgentsService.officeStatuses = {};

    // In packaged builds, the watcher lives in app.asar.unpacked and can't be
    // executed directly. Use Electron as a plain Node process via ELECTRON_RUN_AS_NODE.
    const args = app.isPackaged
      ? [binPath, '--config', getConfigPath()]
      : ['--config', getConfigPath()];
    const cmd = app.isPackaged ? process.execPath : binPath;

    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_NO_WARNINGS: '1',
        ...(app.isPackaged ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      },
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

    // Scrub plaintext tokens from config file (structure preserved for next launch)
    PixelAgentsService.scrubConfigTokens();

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

  /** Rewrite config file with all tokens set to null so no secrets remain on disk */
  private static scrubConfigTokens(): void {
    try {
      if (!existsSync(getConfigPath())) return;
      const raw = JSON.parse(readFileSync(getConfigPath(), 'utf-8'));
      raw.offices = (raw.offices || []).map((o: { id: string; url: string; enabled: boolean }) => ({
        id: o.id,
        url: o.url,
        token: null,
        enabled: o.enabled,
      }));
      writeFileSync(getConfigPath(), JSON.stringify(raw, null, 2), { mode: 0o600 });
    } catch {
      // Best effort
    }
  }

  /** Write decrypted tokens from encrypted storage into the config file before spawning */
  private static hydrateConfigTokens(): void {
    try {
      if (!existsSync(getConfigPath())) return;
      const raw = JSON.parse(readFileSync(getConfigPath(), 'utf-8'));
      const decryptedTokens = ConnectionConfigService.getAllPixelAgentsTokens();
      raw.offices = (raw.offices || []).map(
        (o: { id: string; url: string; token?: string; enabled: boolean }) => ({
          ...o,
          token: decryptedTokens[o.id] || null,
        }),
      );
      writeFileSync(getConfigPath(), JSON.stringify(raw, null, 2), { mode: 0o600 });
    } catch {
      // Best effort
    }
  }

  private static resolveBinPath(): string | null {
    // In dev: node_modules/.bin/pixel-agents-watcher (shell wrapper)
    const devPath = join(app.getAppPath(), 'node_modules', '.bin', 'pixel-agents-watcher');
    if (existsSync(devPath)) return devPath;

    // Packaged app: resolve the bundled CJS file from asarUnpack
    try {
      const resolved = require.resolve('@syv-ai/pixel-agents-watcher/dist/watcher.cjs');
      return resolved.replace('app.asar', 'app.asar.unpacked');
    } catch {
      return null;
    }
  }
}
