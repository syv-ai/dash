import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { WebContents } from 'electron';
import { activityMonitor } from './ActivityMonitor';
import { hookServer } from './HookServer';

const execFileAsync = promisify(execFile);

interface PtyRecord {
  proc: any; // IPty from node-pty
  cwd: string;
  isDirectSpawn: boolean;
  owner: WebContents | null;
}

const ptys = new Map<string, PtyRecord>();

export function setDesktopNotification(opts: { enabled: boolean }): void {
  hookServer.setDesktopNotification(opts);
}

// Lazy-load node-pty to avoid native binding issues at startup
let ptyModule: typeof import('node-pty') | null = null;
function getPty() {
  if (!ptyModule) {
    ptyModule = require('node-pty');
  }
  return ptyModule!;
}

// Cached Claude CLI path
let cachedClaudePath: string | null = null;

async function findClaudePath(): Promise<string | null> {
  if (cachedClaudePath) return cachedClaudePath;
  try {
    const { stdout } = await execFileAsync('which', ['claude']);
    cachedClaudePath = stdout.trim();
    return cachedClaudePath;
  } catch {
    return null;
  }
}

/**
 * Build minimal environment for direct CLI spawn (no shell config overhead).
 */
function buildDirectEnv(isDark: boolean): Record<string, string> {
  const env: Record<string, string> = {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'dash',
    HOME: os.homedir(),
    USER: os.userInfo().username,
    PATH: process.env.PATH || '',
    // Tell CLI apps about terminal background (rxvt convention)
    // Format: "fg;bg" where higher values = lighter colors
    COLORFGBG: isDark ? '15;0' : '0;15',
  };

  // Auth passthrough
  const authVars = [
    'ANTHROPIC_API_KEY',
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'no_proxy',
  ];

  for (const key of authVars) {
    if (process.env[key]) {
      env[key] = process.env[key]!;
    }
  }

  return env;
}

/**
 * Write .claude/settings.local.json with Stop and UserPromptSubmit hooks
 * that signal our local HookServer when Claude finishes or starts a turn.
 */
function writeHookSettings(cwd: string, ptyId: string): void {
  const port = hookServer.port;
  if (port === 0) return;

  const claudeDir = path.join(cwd, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.local.json');
  const curlBase = `curl -s --connect-timeout 2 http://127.0.0.1:${port}`;

  const stopEntries: { hooks: { type: string; command: string }[] }[] = [
    { hooks: [{ type: 'command', command: `${curlBase}/hook/stop?ptyId=${ptyId}` }] },
  ];

  const hookSettings = {
    hooks: {
      Stop: stopEntries,
      UserPromptSubmit: [
        {
          hooks: [{ type: 'command', command: `${curlBase}/hook/busy?ptyId=${ptyId}` }],
        },
      ],
    },
  };

  try {
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }

    // Merge with existing settings to preserve non-hook config
    let existing: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      } catch {
        // Corrupted — overwrite
      }
    }

    const merged = {
      ...existing,
      hooks: {
        ...(existing.hooks && typeof existing.hooks === 'object'
          ? (existing.hooks as Record<string, unknown>)
          : {}),
        ...hookSettings.hooks,
      },
    };

    fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n');
    console.error(`[writeHookSettings] Wrote ${settingsPath}`);
  } catch (err) {
    console.error('[writeHookSettings] Failed:', err);
  }
}

/**
 * Spawn Claude CLI directly (fast path, bypasses shell config).
 */
export async function startDirectPty(options: {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
  autoApprove?: boolean;
  resume?: boolean;
  isDark?: boolean;
  sender?: WebContents;
}): Promise<{ reattached: boolean; isDirectSpawn: boolean }> {
  // Re-attach to existing PTY (e.g., after renderer reload)
  const existing = ptys.get(options.id);
  if (existing && !existing.isDirectSpawn) {
    // Shell PTY exists for this ID, but we need Claude — kill it first
    try {
      existing.proc.kill();
    } catch {
      /* already dead */
    }
    ptys.delete(options.id);
  } else if (existing) {
    existing.owner = options.sender || null;
    return { reattached: true, isDirectSpawn: true };
  }

  const pty = getPty();
  const claudePath = await findClaudePath();

  if (!claudePath) {
    throw new Error('Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code');
  }

  const args: string[] = [];
  if (options.resume) {
    args.push('-c', '-r');
  }
  if (options.autoApprove) {
    args.push('--dangerously-skip-permissions');
  }

  const env = buildDirectEnv(options.isDark ?? true);

  writeHookSettings(options.cwd, options.id);

  const proc = pty.spawn(claudePath, args, {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env,
  });

  const record: PtyRecord = {
    proc,
    cwd: options.cwd,
    isDirectSpawn: true,
    owner: options.sender || null,
  };

  ptys.set(options.id, record);
  activityMonitor.register(options.id, proc.pid, true);

  // Forward output to renderer
  proc.onData((data: string) => {
    if (record.owner && !record.owner.isDestroyed()) {
      record.owner.send(`pty:data:${options.id}`, data);
    }
  });

  proc.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
    activityMonitor.unregister(options.id);
    if (record.owner && !record.owner.isDestroyed()) {
      record.owner.send(`pty:exit:${options.id}`, { exitCode, signal });
    }
    ptys.delete(options.id);
  });

  return { reattached: false, isDirectSpawn: true };
}

/**
 * Spawn interactive shell (fallback path).
 */
export async function startPty(options: {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
  sender?: WebContents;
}): Promise<{ reattached: boolean; isDirectSpawn: boolean }> {
  // Re-attach to existing PTY (e.g., after renderer reload)
  const existing = ptys.get(options.id);
  if (existing) {
    existing.owner = options.sender || null;
    return { reattached: true, isDirectSpawn: existing.isDirectSpawn };
  }

  const pty = getPty();

  const shell = process.env.SHELL || '/bin/bash';
  const args = ['-il']; // Login + interactive

  // Clean environment for shell
  const env = { ...process.env };
  // Remove Electron packaging artifacts
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;

  const proc = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: env as Record<string, string>,
  });

  const record: PtyRecord = {
    proc,
    cwd: options.cwd,
    isDirectSpawn: false,
    owner: options.sender || null,
  };

  ptys.set(options.id, record);
  activityMonitor.register(options.id, proc.pid, false);

  proc.onData((data: string) => {
    if (record.owner && !record.owner.isDestroyed()) {
      record.owner.send(`pty:data:${options.id}`, data);
    }
  });

  proc.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
    activityMonitor.unregister(options.id);
    if (record.owner && !record.owner.isDestroyed()) {
      record.owner.send(`pty:exit:${options.id}`, { exitCode, signal });
    }
    ptys.delete(options.id);
  });

  return { reattached: false, isDirectSpawn: false };
}

/**
 * Send data to a PTY.
 */
export function writePty(id: string, data: string): void {
  const record = ptys.get(id);
  if (record) {
    record.proc.write(data);
  }
}

/**
 * Resize a PTY.
 */
export function resizePty(id: string, cols: number, rows: number): void {
  const record = ptys.get(id);
  if (record) {
    try {
      record.proc.resize(cols, rows);
    } catch {
      // EBADF can happen during transitions
    }
  }
}

/**
 * Kill a specific PTY.
 */
export function killPty(id: string): void {
  const record = ptys.get(id);
  if (record) {
    try {
      record.proc.kill();
    } catch {
      // Already dead — onExit may not fire, so clean up manually
      activityMonitor.unregister(id);
    }
    ptys.delete(id);
  }
}

/**
 * Kill all PTYs (on app quit).
 */
export function killAll(): void {
  for (const [, record] of ptys) {
    try {
      record.proc.kill();
    } catch {
      // Already dead
    }
  }
  ptys.clear();
  // Bulk cleanup — don't rely on onExit during shutdown
  activityMonitor.stop();
}

/**
 * Kill all PTYs owned by a specific WebContents (on window close).
 */
export function killByOwner(owner: WebContents): void {
  for (const [id, record] of ptys) {
    if (record.owner === owner) {
      try {
        record.proc.kill();
      } catch {
        activityMonitor.unregister(id);
      }
      ptys.delete(id);
    }
  }
}
