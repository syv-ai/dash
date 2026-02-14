import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { WebContents } from 'electron';
import { activityMonitor } from './ActivityMonitor';
import { hookServer } from './HookServer';
import { contextUsageService } from './ContextUsageService';

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
 * Write .claude/task-context.json with issue context for the SessionStart hook.
 * Called from IPC during task creation, before Claude spawns.
 */
export function writeTaskContext(
  cwd: string,
  prompt: string,
  meta?: { issueNumbers: number[]; gitRemote?: string },
): void {
  const claudeDir = path.join(cwd, '.claude');
  const contextPath = path.join(claudeDir, 'task-context.json');

  const payload: Record<string, unknown> = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: prompt,
    },
  };
  if (meta) {
    payload.meta = meta;
  }

  try {
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }
    fs.writeFileSync(contextPath, JSON.stringify(payload, null, 2) + '\n');
  } catch (err) {
    console.error('[writeTaskContext] Failed:', err);
  }
}

/**
 * Ensure Dash-managed files inside .claude/ are excluded from git
 * using .git/info/exclude — the standard per-repo exclude mechanism
 * that never creates tracked files.
 *
 * For worktrees, `git rev-parse --git-dir` returns the worktree-specific
 * git dir (e.g., .git/worktrees/<name>), so excludes are per-worktree.
 */
async function ensureGitExcludes(cwd: string): Promise<void> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd });
    const gitDir = stdout.trim();
    const excludePath = path.resolve(cwd, gitDir, 'info', 'exclude');
    const requiredEntries = ['.claude/settings.local.json', '.claude/task-context.json'];

    let existing = '';
    if (fs.existsSync(excludePath)) {
      existing = fs.readFileSync(excludePath, 'utf-8');
    } else {
      // Ensure info/ directory exists
      const infoDir = path.dirname(excludePath);
      if (!fs.existsSync(infoDir)) {
        fs.mkdirSync(infoDir, { recursive: true });
      }
    }

    const lines = existing.split('\n');
    const missing = requiredEntries.filter((entry) => !lines.some((line) => line.trim() === entry));

    if (missing.length > 0) {
      const suffix = (existing && !existing.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n';
      fs.writeFileSync(excludePath, existing + suffix);
    }
  } catch {
    // Best effort — don't block PTY startup (not a git repo, etc.)
  }
}

/**
 * Write .claude/settings.local.json with Stop, UserPromptSubmit,
 * statusLine, and (optionally) SessionStart hooks.
 *
 * The statusLine is an inline curl that POSTs context JSON to the hook server.
 * Context usage is displayed in the Dash UI (sidebar + header), not in the terminal.
 */
async function writeHookSettings(cwd: string, ptyId: string): Promise<void> {
  const port = hookServer.port;
  if (port === 0) return;

  const claudeDir = path.join(cwd, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.local.json');
  const curlBase = `curl -s --connect-timeout 2 http://127.0.0.1:${port}`;

  const hookSettings: Record<string, unknown[]> = {
    Stop: [{ hooks: [{ type: 'command', command: `${curlBase}/hook/stop?ptyId=${ptyId}` }] }],
    UserPromptSubmit: [
      { hooks: [{ type: 'command', command: `${curlBase}/hook/busy?ptyId=${ptyId}` }] },
    ],
  };

  // Auto-detect task-context.json and inject SessionStart hook if it exists
  const contextPath = path.join(claudeDir, 'task-context.json');
  if (fs.existsSync(contextPath)) {
    hookSettings.SessionStart = [
      {
        matcher: 'startup',
        hooks: [
          {
            type: 'command',
            command: `cat "${contextPath}"`,
          },
        ],
      },
    ];
  }

  // Inline curl: reads JSON from stdin, POSTs to hook server, produces no terminal output
  const statusLineCmd = `curl -s --connect-timeout 2 -X POST -H "Content-Type: application/json" -d @- "http://127.0.0.1:${port}/hook/context?ptyId=${ptyId}" >/dev/null 2>&1`;

  try {
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }

    // Ensure our managed files are excluded from git (async, non-blocking)
    await ensureGitExcludes(cwd);

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
        ...hookSettings,
      },
      statusLine: statusLineCmd,
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
}): Promise<{
  reattached: boolean;
  isDirectSpawn: boolean;
  hasTaskContext: boolean;
  taskContextMeta: { issueNumbers: number[]; gitRemote?: string } | null;
}> {
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
    return { reattached: true, isDirectSpawn: true, hasTaskContext: false, taskContextMeta: null };
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

  await writeHookSettings(options.cwd, options.id);

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
    // Skip if this PTY was replaced by a new spawn (kill+restart on reattach)
    if (ptys.get(options.id) !== record) return;
    activityMonitor.unregister(options.id);
    contextUsageService.unregister(options.id);
    if (record.owner && !record.owner.isDestroyed()) {
      record.owner.send(`pty:exit:${options.id}`, { exitCode, signal });
    }
    ptys.delete(options.id);
  });

  const contextPath = path.join(options.cwd, '.claude', 'task-context.json');
  let taskContextMeta: { issueNumbers: number[]; gitRemote?: string } | null = null;
  try {
    if (fs.existsSync(contextPath)) {
      const parsed = JSON.parse(fs.readFileSync(contextPath, 'utf-8'));
      taskContextMeta = parsed.meta ?? null;
    }
  } catch {
    // Best effort
  }
  return {
    reattached: false,
    isDirectSpawn: true,
    hasTaskContext: !!taskContextMeta,
    taskContextMeta,
  };
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
    // Skip if this PTY was replaced by a new spawn (kill+restart on reattach)
    if (ptys.get(options.id) !== record) return;
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
    // Delete first so the guarded onExit handler becomes a no-op
    ptys.delete(id);
    activityMonitor.unregister(id);
    contextUsageService.unregister(id);
    try {
      record.proc.kill();
    } catch {
      // Already dead
    }
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
