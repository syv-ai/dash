import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { type WebContents, app } from 'electron';
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

// Commit attribution setting: undefined = "default" (don't write key),
// '' = "none" (suppress attribution), any other string = custom text.
let commitAttributionSetting: string | undefined = undefined;

export function setCommitAttribution(value: string | undefined): void {
  commitAttributionSetting = value;
  // Re-write settings.local.json for all active PTYs so the change takes effect immediately
  for (const [id, rec] of ptys) {
    writeHookSettings(rec.cwd, id);
  }
}

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

import { createBannerFilter } from './bannerFilter';

// Cached Claude CLI path
let cachedClaudePath: string | null = null;

async function findClaudePath(): Promise<string | null> {
  if (cachedClaudePath) return cachedClaudePath;

  // 1. Check the startup-detected cache from main.ts
  try {
    const { claudeCliCache } = await import('../main');
    if (claudeCliCache.path) {
      cachedClaudePath = claudeCliCache.path;
      return cachedClaudePath;
    }
  } catch {
    // Best effort
  }

  // 2. Try `which claude` (works when PATH is correct)
  try {
    const { stdout } = await execFileAsync('which', ['claude']);
    const resolved = stdout.trim();
    if (resolved) {
      cachedClaudePath = resolved;
      return cachedClaudePath;
    }
  } catch {
    // Not in PATH
  }

  // 3. Direct probe common install locations
  const home = os.homedir();
  const candidates = [
    path.join(home, '.local/bin/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ];
  for (const candidate of candidates) {
    try {
      await fs.promises.access(candidate, fs.constants.X_OK);
      cachedClaudePath = candidate;
      return cachedClaudePath;
    } catch {
      // Not found here
    }
  }

  console.error('[findClaudePath] Claude CLI not found in any known location');
  return null;
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
 * Write .claude/settings.local.json with Stop, UserPromptSubmit, and
 * (optionally) SessionStart hooks.
 */
function writeHookSettings(cwd: string, ptyId: string): void {
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

    const merged: Record<string, unknown> = {
      ...existing,
      hooks: {
        ...(existing.hooks && typeof existing.hooks === 'object'
          ? (existing.hooks as Record<string, unknown>)
          : {}),
        ...hookSettings,
      },
    };

    // Commit attribution: only write the key when user has explicitly configured it.
    // When undefined ("default"), remove the key so repo/global settings take effect.
    if (commitAttributionSetting !== undefined) {
      merged.attribution = { commit: commitAttributionSetting };
    } else {
      delete merged.attribution;
    }

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

  // Forward output to renderer, replacing the Claude logo with "7" art
  const bannerFilter = createBannerFilter((filtered: string) => {
    if (record.owner && !record.owner.isDestroyed()) {
      record.owner.send(`pty:data:${options.id}`, filtered);
    }
  });

  proc.onData((data: string) => {
    bannerFilter(data);
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

// ---------------------------------------------------------------------------
// Custom zsh prompt via ZDOTDIR
// ---------------------------------------------------------------------------

const SHELL_ZSHENV = `\
# Save our ZDOTDIR so .zshrc can find prompt.zsh
export __DASH_ZDOTDIR="\${ZDOTDIR}"
# Source user's .zshenv from HOME
[[ -f "$HOME/.zshenv" ]] && source "$HOME/.zshenv"
# Keep ZDOTDIR as our dir so zsh loads .zshrc etc. from here
ZDOTDIR="\${__DASH_ZDOTDIR}"
`;

const SHELL_ZPROFILE = `\
[[ -f "$HOME/.zprofile" ]] && source "$HOME/.zprofile"
`;

const SHELL_ZSHRC = `\
# Restore ZDOTDIR to HOME so user config loads normally
ZDOTDIR="$HOME"
[[ -f "$HOME/.zshrc" ]] && source "$HOME/.zshrc"
# Apply our prompt after user config
source "\${__DASH_ZDOTDIR}/prompt.zsh"
`;

const SHELL_ZLOGIN = `\
[[ -f "$HOME/.zlogin" ]] && source "$HOME/.zlogin"
`;

const SHELL_PROMPT = `\
# Dash badge-style prompt — uses ANSI 16 colors (themed by xterm.js)
autoload -Uz vcs_info add-zsh-hook

# Prevent venv from prepending (name) to prompt
export VIRTUAL_ENV_DISABLE_PROMPT=1

zstyle ':vcs_info:*' enable git
zstyle ':vcs_info:*' check-for-changes false
zstyle ':vcs_info:git:*' formats '%b'

__dash_prompt_precmd() {
  vcs_info

  local dir="%F{12}%~%f"
  local branch=""
  if [[ -n "\${vcs_info_msg_0_}" ]]; then
    local dirty=""
    # Fast dirty check: staged + unstaged + untracked
    if ! git diff --quiet HEAD -- 2>/dev/null || [[ -n "$(git ls-files --others --exclude-standard 2>/dev/null | head -1)" ]]; then
      dirty="%F{3}*%f"
    fi
    branch="  %F{5}\${vcs_info_msg_0_}\${dirty}%f"
  fi

  local venv=""
  if [[ -n "\${VIRTUAL_ENV}" ]]; then
    venv="  %F{6}\${VIRTUAL_ENV:t}%f"
  fi

  PROMPT="\${dir}\${branch}\${venv}
%F{%(?.2.1)}\\$%f "
  RPROMPT=""
}

add-zsh-hook precmd __dash_prompt_precmd
# Set PROMPT immediately so the first prompt is styled — precmd may not
# fire before the initial prompt in all zsh configurations.
__dash_prompt_precmd
`;

let shellConfigDir: string | null = null;

function ensureShellConfig(): string {
  if (shellConfigDir) return shellConfigDir;

  const dir = path.join(app.getPath('userData'), 'shell');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const files: Record<string, string> = {
    '.zshenv': SHELL_ZSHENV,
    '.zprofile': SHELL_ZPROFILE,
    '.zshrc': SHELL_ZSHRC,
    '.zlogin': SHELL_ZLOGIN,
    'prompt.zsh': SHELL_PROMPT,
  };

  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
    if (existing !== content) {
      fs.writeFileSync(filePath, content);
    }
  }

  shellConfigDir = dir;
  return dir;
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
  // Enable macOS zsh OSC 7 cwd reporting (sources /etc/zshrc_Apple_Terminal)
  env.TERM_PROGRAM = 'Apple_Terminal';

  // Inject custom prompt for zsh via ZDOTDIR
  if (shell.endsWith('/zsh') || shell === 'zsh') {
    env.ZDOTDIR = ensureShellConfig();
  }

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
