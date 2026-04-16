import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { type WebContents, app } from 'electron';
import { activityMonitor } from './ActivityMonitor';
import { hookServer } from './HookServer';
import { contextUsageService } from './ContextUsageService';
import { DatabaseService } from './DatabaseService';

const execFileAsync = promisify(execFile);

/**
 * Locate the Claude projects directory for a given cwd.
 * Claude stores sessions under ~/.claude/projects/<encoded-cwd>/.
 */
function findClaudeProjectDir(cwd: string): string | null {
  try {
    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
    if (!fs.existsSync(projectsDir)) return null;

    // Path-based: slashes → hyphens (the primary naming scheme)
    const pathBased = path.join(projectsDir, cwd.replace(/\//g, '-'));
    if (fs.existsSync(pathBased)) return pathBased;

    // Partial match: last 3 path segments
    const parts = cwd.split('/').filter((p) => p.length > 0);
    const suffix = parts.slice(-3).join('-');
    const dirs = fs.readdirSync(projectsDir);
    const match = dirs.find((d) => d.endsWith(suffix));
    if (match) return path.join(projectsDir, match);

    return null;
  } catch (err) {
    console.error('[findClaudeProjectDir] Failed to scan projects dir:', err);
    return null;
  }
}

/** Check whether Claude has a session file for the given UUID in this cwd. */
function hasSessionForId(cwd: string, sessionId: string): boolean {
  const projDir = findClaudeProjectDir(cwd);
  if (!projDir) return false;
  return fs.existsSync(path.join(projDir, `${sessionId}.jsonl`));
}

interface PtyRecord {
  proc: any; // IPty from node-pty
  cwd: string;
  isDirectSpawn: boolean;
  owner: WebContents | null;
}

const ptys = new Map<string, PtyRecord>();

/** Tracks all settings.local.json paths Dash has written hooks to, for cleanup on exit. */
const writtenSettingsPaths = new Set<string>();

const DASH_DEFAULT_ATTRIBUTION =
  '\n\nCo-Authored-By: Claude <noreply@anthropic.com> via Dash <dash@syv.ai>';

// Commit attribution setting: undefined = "default" (use Dash attribution),
// '' = "none" (suppress attribution), any other string = custom text.
let commitAttributionSetting: string | undefined = undefined;

// Custom environment variables passed to spawned Claude processes (set from renderer settings).
let claudeEnvVars: Record<string, string> = {};

// When true, inherit the full parent process.env as a base instead of the minimal set.
let syncShellEnv = false;

const RESERVED_ENV_KEYS = new Set([
  'PATH',
  'HOME',
  'USER',
  'TERM',
  'COLORTERM',
  'TERM_PROGRAM',
  'COLORFGBG',
]);

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

export function hasPty(id: string): boolean {
  return ptys.has(id);
}

export function setClaudeEnvVars(vars: Record<string, string>): void {
  claudeEnvVars = vars;
}

export function setSyncShellEnv(enabled: boolean): void {
  syncShellEnv = enabled;
}

// Lazy-load node-pty to avoid native binding issues at startup
let ptyModule: typeof import('node-pty') | null = null;
let ptyLoadError: string | null = null;
function getPty() {
  if (ptyLoadError) {
    throw new Error(ptyLoadError);
  }
  if (!ptyModule) {
    try {
      ptyModule = require('node-pty');
    } catch (err) {
      ptyLoadError =
        `[native module] node-pty failed to load: ${String(err)}. ` +
        'Try rebuilding native modules: pnpm rebuild';
      throw new Error(ptyLoadError);
    }
  }
  return ptyModule!;
}

import { createBannerFilter } from './bannerFilter';
import { remoteControlService } from './remoteControlService';

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

  // 2. Try `which`/`where.exe` (works when PATH is correct)
  try {
    const findCmd = process.platform === 'win32' ? 'where.exe' : 'which';
    const { stdout } = await execFileAsync(findCmd, ['claude']);
    // where.exe may return multiple lines; prefer .cmd on Windows
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    const resolved =
      process.platform === 'win32'
        ? (lines.find((l) => l.toLowerCase().endsWith('.cmd')) || lines[0])?.trim()
        : lines[0]?.trim();
    if (resolved) {
      cachedClaudePath = resolved;
      return cachedClaudePath;
    }
  } catch {
    // Not in PATH
  }

  // 3. Direct probe common install locations
  const home = os.homedir();
  const candidates: string[] =
    process.platform === 'win32'
      ? [
          path.join(
            process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
            'npm',
            'claude.cmd',
          ),
          path.join(home, 'AppData', 'Local', 'Programs', 'nodejs', 'claude.cmd'),
          path.join('C:\\Program Files\\nodejs', 'claude.cmd'),
          // Version managers: check their env-var-based directories
          ...(process.env.NVM_SYMLINK ? [path.join(process.env.NVM_SYMLINK, 'claude.cmd')] : []),
          ...(process.env.VOLTA_HOME
            ? [path.join(process.env.VOLTA_HOME, 'bin', 'claude.cmd')]
            : []),
        ]
      : [path.join(home, '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'];
  for (const candidate of candidates) {
    try {
      const accessMode = process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK;
      await fs.promises.access(candidate, accessMode);
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
 * Build environment for direct CLI spawn.
 * When syncShellEnv is off (default), uses a minimal set for fast, predictable spawns.
 * When on, inherits the full parent process.env as a base.
 */
function buildDirectEnv(isDark: boolean): Record<string, string> {
  const isWin = process.platform === 'win32';
  const base: Record<string, string> = syncShellEnv
    ? Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => !!e[1]))
    : {};

  const env: Record<string, string> = {
    ...base,
    TERM_PROGRAM: 'dash',
    HOME: os.homedir(),
    PATH: process.env.PATH || '',
    // Tell CLI apps about terminal background (rxvt convention)
    // Format: "fg;bg" where higher values = lighter colors
    COLORFGBG: isDark ? '15;0' : '0;15',
  };

  if (isWin) {
    // Windows requires system env vars for DNS, credential storage, and Node.js.
    // Includes both casings of SystemRoot since some processes look for one or
    // the other (cmd.exe sets SystemRoot, PowerShell sees SYSTEMROOT in env).
    env.USERNAME = process.env.USERNAME || os.userInfo().username;
    const winVars = [
      'APPDATA',
      'LOCALAPPDATA',
      'USERPROFILE',
      'TEMP',
      'TMP',
      'SystemRoot',
      'SYSTEMROOT',
      'SystemDrive',
      'WINDIR',
      'COMSPEC',
      'PATHEXT',
      'COMPUTERNAME',
      'USERDOMAIN',
      'ProgramFiles',
    ];
    for (const key of winVars) {
      if (process.env[key]) env[key] = process.env[key]!;
    }
  } else {
    env.TERM = 'xterm-256color';
    env.COLORTERM = 'truecolor';
    env.USER = os.userInfo().username;
  }

  if (!syncShellEnv) {
    // Auth passthrough — only needed when not inheriting full env
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
  }

  // Merge user-configured environment variables from settings,
  // preventing overrides of internal keys that would break spawned processes.
  for (const [key, value] of Object.entries(claudeEnvVars)) {
    if (!RESERVED_ENV_KEYS.has(key)) {
      env[key] = value;
    }
  }

  // Disable Claude Code's built-in viewport scrolling — Dash uses its own terminal viewport
  env.CLAUDE_CODE_NO_FLICKER = '1';

  return env;
}

/** Retrieve stored task context prompt from the database. */
function getTaskContextPrompt(taskId: string): string | null {
  try {
    const task = DatabaseService.getTask(taskId);
    return task?.contextPrompt ?? null;
  } catch (err) {
    console.error('[getTaskContextPrompt] Failed to read context for task', taskId, err);
    return null;
  }
}

/**
 * All hook event names that Dash writes to settings.local.json.
 * Used by both writeHookSettings and cleanupHookSettings.
 */
const DASH_HOOK_EVENTS = [
  'Stop',
  'UserPromptSubmit',
  'Notification',
  'PreToolUse',
  'PostToolUse',
  'StopFailure',
  'PreCompact',
  'PostCompact',
  'SessionStart',
] as const;

/**
 * Write .claude/settings.local.json with hooks for activity monitoring,
 * tool tracking, error detection, and context usage.
 *
 * Hooks use type: "http" — Claude Code POSTs the hook JSON body directly
 * to our local HookServer. The statusLine uses type: "command" with curl
 * (http type is not supported for statusLine).
 */
function writeHookSettings(cwd: string, ptyId: string): void {
  const port = hookServer.port;
  if (port === 0) return;

  const claudeDir = path.join(cwd, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.local.json');
  const base = `http://127.0.0.1:${port}`;

  /** Shorthand: build an HTTP hook entry. */
  const httpHook = (endpoint: string, async?: boolean) => ({
    type: 'http' as const,
    url: `${base}${endpoint}?ptyId=${ptyId}`,
    ...(async ? { async: true } : {}),
  });

  const hookSettings: Record<string, unknown[]> = {
    // ── Activity state signals ──────────────────────────────
    Stop: [{ hooks: [httpHook('/hook/stop')] }],
    UserPromptSubmit: [{ hooks: [httpHook('/hook/busy')] }],

    // ── Notification (permission prompt, idle) ──────────────
    Notification: [
      { matcher: 'permission_prompt', hooks: [httpHook('/hook/notification')] },
      { matcher: 'idle_prompt', hooks: [httpHook('/hook/notification')] },
    ],

    // ── Tool activity tracking ──────────────────────────────
    PreToolUse: [{ matcher: '*', hooks: [httpHook('/hook/tool-start', true)] }],
    PostToolUse: [{ matcher: '*', hooks: [httpHook('/hook/tool-end', true)] }],

    // ── Error detection ─────────────────────────────────────
    StopFailure: [{ matcher: '*', hooks: [httpHook('/hook/stop-failure')] }],

    // ── Context compaction ──────────────────────────────────
    PreCompact: [{ matcher: '*', hooks: [httpHook('/hook/compact-start', true)] }],
    PostCompact: [{ matcher: '*', hooks: [httpHook('/hook/compact-end', true)] }],
  };

  // Inject task context via SessionStart hook. Fires on startup (new session),
  // and re-injects after compact/clear so Claude retains issue awareness.
  const contextPrompt = getTaskContextPrompt(ptyId);
  if (contextPrompt) {
    const hookPayload = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: contextPrompt,
      },
    });
    // Use base64 encoding to safely embed user-controlled content in a shell command.
    // Single-quote escaping is fragile with content from GitHub issues / ADO work items.
    const b64 = Buffer.from(hookPayload).toString('base64');
    // Cross-platform decode: macOS uses `base64 -D`, Linux uses `base64 -d`,
    // Windows cmd.exe doesn't have base64 so we use PowerShell instead.
    const decodeCmd =
      process.platform === 'win32'
        ? `powershell.exe -NoProfile -Command "[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')))"`
        : `echo '${b64}' | base64 ${process.platform === 'darwin' ? '-D' : '-d'}`;
    const sessionStartHook = {
      hooks: [
        {
          type: 'command',
          command: decodeCmd,
        },
      ],
    };
    hookSettings.SessionStart = ['startup', 'compact', 'clear'].map((matcher) => ({
      matcher,
      ...sessionStartHook,
    }));
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
      } catch (err) {
        console.error(
          '[writeHookSettings] Corrupted settings.local.json at',
          settingsPath,
          '— overwriting:',
          err,
        );
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

    // statusLine: command that pipes Claude Code's JSON context data to our hook server
    const contextUrl = `${base}/hook/context?ptyId=${ptyId}`;
    merged.statusLine = {
      type: 'command',
      command: `curl -s --connect-timeout 2 -X POST -H "Content-Type: application/json" -d @- "${contextUrl}" >/dev/null 2>&1`,
    };

    // Commit attribution: undefined = Dash default, '' = suppress, other = custom.
    const effectiveAttribution =
      commitAttributionSetting === undefined ? DASH_DEFAULT_ATTRIBUTION : commitAttributionSetting;
    merged.attribution = { commit: effectiveAttribution };

    fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n');
    writtenSettingsPaths.add(settingsPath);
    console.error(
      `[writeHookSettings] Wrote ${settingsPath} (attribution: ${commitAttributionSetting === undefined ? 'default' : commitAttributionSetting || 'none'})`,
    );
  } catch (err) {
    console.error('[writeHookSettings] Failed:', err);
  }
}

/**
 * Remove Dash-written hooks and attribution from all settings.local.json files
 * that were written during this session. Called on app quit to prevent stale hooks.
 */
export function cleanupHookSettings(): void {
  for (const settingsPath of writtenSettingsPaths) {
    try {
      if (!fs.existsSync(settingsPath)) continue;

      const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const hooks = raw.hooks;

      if (hooks && typeof hooks === 'object') {
        for (const key of DASH_HOOK_EVENTS) {
          delete hooks[key];
        }
        // Remove hooks object entirely if empty
        if (Object.keys(hooks).length === 0) {
          delete raw.hooks;
        }
      }

      // Remove Dash statusLine and attribution
      delete raw.statusLine;
      delete raw.attribution;

      // If nothing meaningful remains, delete the file
      if (Object.keys(raw).length === 0) {
        fs.unlinkSync(settingsPath);
        console.error(`[cleanupHookSettings] Removed empty ${settingsPath}`);
      } else {
        fs.writeFileSync(settingsPath, JSON.stringify(raw, null, 2) + '\n');
        console.error(`[cleanupHookSettings] Cleaned hooks from ${settingsPath}`);
      }
    } catch (err) {
      console.error(`[cleanupHookSettings] Failed for ${settingsPath}:`, err);
    }
  }

  writtenSettingsPaths.clear();
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
    return { reattached: true, isDirectSpawn: true };
  }

  const claudePath = await findClaudePath();

  if (!claudePath) {
    throw new Error('Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code');
  }

  const args: string[] = [];

  // Pin each task to its own Claude session so tasks sharing the same cwd
  // (e.g. multiple tasks in the main worktree) never resume each other.
  if (options.resume && hasSessionForId(options.cwd, options.id)) {
    // Session was created with --session-id; resume it by ID.
    args.push('-r', options.id);
  } else if (options.resume) {
    // Legacy task created before session pinning — fall back to most recent.
    args.push('-c', '-r');
  } else {
    // New session: create with deterministic UUID tied to this task.
    args.push('--session-id', options.id);
  }

  if (options.autoApprove) {
    args.push('--dangerously-skip-permissions');
  }
  const env = buildDirectEnv(options.isDark ?? true);

  writeHookSettings(options.cwd, options.id);

  const pty = getPty();
  // On Windows, .cmd files must be invoked through cmd.exe
  const spawnFile = process.platform === 'win32' ? 'cmd.exe' : claudePath;
  const spawnArgs: string[] = process.platform === 'win32' ? ['/c', claudePath, ...args] : args;

  const proc = pty.spawn(spawnFile, spawnArgs, {
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
    activityMonitor.noteData(options.id);
    remoteControlService.onPtyData(options.id, data);
  });

  proc.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
    // Skip if this PTY was replaced by a new spawn (kill+restart on reattach)
    if (ptys.get(options.id) !== record) return;
    activityMonitor.unregister(options.id);
    remoteControlService.unregister(options.id);
    contextUsageService.unregister(options.id);
    if (record.owner && !record.owner.isDestroyed()) {
      record.owner.send(`pty:exit:${options.id}`, { exitCode, signal });
    }
    ptys.delete(options.id);
  });

  return {
    reattached: false,
    isDirectSpawn: true,
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

  const isWin = process.platform === 'win32';
  const shell = isWin ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
  const args = isWin ? ['-NoLogo'] : ['-il']; // Login + interactive on Unix

  // Clean environment for shell
  const env = { ...process.env };
  // Remove Electron packaging artifacts
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;

  if (!isWin) {
    // Enable macOS zsh OSC 7 cwd reporting (sources /etc/zshrc_Apple_Terminal)
    if (process.platform === 'darwin') {
      env.TERM_PROGRAM = 'Apple_Terminal';
    }

    // Inject custom prompt for zsh via ZDOTDIR
    if (shell.endsWith('/zsh') || shell === 'zsh') {
      env.ZDOTDIR = ensureShellConfig();
    }
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
 * Enable remote control for a PTY by sending `/rc` and watching for the URL.
 */
export function sendRemoteControl(id: string): void {
  remoteControlService.startWatching(id);
  // Write command text first, then send Enter separately so Claude Code's
  // input handler processes the keystroke as a distinct event.
  writePty(id, '/rc');
  setTimeout(() => writePty(id, '\r'), 100);
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
    remoteControlService.unregister(id);
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
      ptys.delete(id);
      activityMonitor.unregister(id);
      remoteControlService.unregister(id);
      contextUsageService.unregister(id);
      try {
        record.proc.kill();
      } catch {
        // Already dead
      }
    }
  }
}
