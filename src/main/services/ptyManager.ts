import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { type WebContents, app, BrowserWindow } from 'electron';
import { activityMonitor } from './ActivityMonitor';
import { hookServer } from './HookServer';
import { contextUsageService } from './ContextUsageService';
import { DatabaseService } from './DatabaseService';
import {
  type Hook,
  type HookEntry,
  type HttpHook,
  type CommandHook,
  type DashHookEndpoint,
  type DashHookEvent,
  DASH_HOOK_EVENTS,
  entryIsDashOwned,
  mergeHookEntries,
} from './hookSettingsMerge';

const execFileAsync = promisify(execFile);

/**
 * Locate the Claude projects directory for a given cwd by exact path encoding.
 * Claude stores sessions under ~/.claude/projects/<slashes-replaced-by-hyphens>/.
 * Exact match only — a partial-match fallback would risk returning a foreign
 * project's dir when two paths share trailing segments (e.g. branch slugs reused
 * across projects), causing claude --continue to act on the wrong session set.
 */
function findClaudeProjectDir(cwd: string): string | null {
  try {
    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
    const pathBased = path.join(projectsDir, cwd.replace(/\//g, '-'));
    return fs.existsSync(pathBased) ? pathBased : null;
  } catch (err) {
    console.error('[findClaudeProjectDir] Failed to check projects dir:', err);
    return null;
  }
}

/** Check whether Claude has any jsonl history for this cwd. */
function hasAnySessionForCwd(cwd: string): boolean {
  const projDir = findClaudeProjectDir(cwd);
  if (!projDir) return false;
  try {
    return fs.readdirSync(projDir).some((f) => f.endsWith('.jsonl'));
  } catch {
    return false;
  }
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
 * Claude Code rejects an entire settings.local.json if any top-level hook key
 * is unknown to the running CLI version. Newer hook events must be gated so
 * older Claude Code installs don't lose ALL Dash hooks (see GH #127).
 *
 * Returns false when the version is unknown, which keeps the new keys out of
 * the file — the safer default. main.ts populates claudeCliCache after the
 * async --version probe; by the time a PTY spawns, it's almost always set.
 */
function isClaudeVersionAtLeast(major: number, minor: number, patch: number): boolean {
  let version: string | null = null;
  try {
    // Lazy require to avoid the circular import that a static import of main.ts
    // would create (main → ptyManager → main). At call time, main is fully loaded.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const main = require('../main') as typeof import('../main');
    version = main.claudeCliCache.version;
  } catch {
    return false;
  }
  if (!version) return false;
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return false;
  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (a !== major) return a > major;
  if (b !== minor) return b > minor;
  return c >= patch;
}

/**
 * Mark a hook as Dash-authored. The brand lets the merge module recognize
 * it on the next rewrite without falling back to URL/command-shape pattern
 * matching.
 */
function tagDash<T extends HttpHook | CommandHook>(hook: T): T & { __dash: true } {
  return { ...hook, __dash: true };
}

/**
 * Atomic write: stage to a sibling tmp file then rename over the target.
 * POSIX rename is atomic, so a crash mid-write can never leave a half-
 * written file at `target`. Important here because settings.local.json is
 * rewritten frequently (every PTY spawn, every commit-attribution change)
 * and the corrupt-recovery path on the read side would otherwise have to
 * handle a wider class of partial-write failures than just user edits.
 *
 * On failure (write error mid-data, or rename error after a successful
 * write), unlink the tmp file best-effort before rethrowing so failed
 * writes don't accumulate orphan `*.tmp-<pid>-<ts>` files alongside the
 * user's settings.
 */
function atomicWriteFileSync(target: string, data: string): void {
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, target);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // best-effort: tmp may not exist if writeFileSync failed before
      // creating the file, or unlink may race with another process.
    }
    throw err;
  }
}

function broadcastToast(message: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('app:toast', { message });
    }
  }
}

/**
 * Write .claude/settings.local.json with hooks for activity monitoring,
 * tool tracking, error detection, and context usage.
 *
 * Hooks use type: "http" — Claude Code POSTs the hook JSON body directly
 * to our local HookServer. The statusLine uses type: "command" with curl
 * (http type is not supported for statusLine).
 *
 * Merging preserves user-authored entries via the merge module's brand-or-
 * URL-shape detector, so users can have their own hooks under managed
 * events without losing them on every rewrite.
 *
 * Failure surfacing happens inside via console.error + broadcastToast.
 * Callers don't need to act on the result.
 */
function writeHookSettings(cwd: string, ptyId: string): void {
  const port = hookServer.port;
  const claudeDir = path.join(cwd, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.local.json');

  // The await order in main.ts (`await hookServer.start()` before IPC
  // registration) makes this branch unreachable in normal startup; if we hit
  // it, something has invoked writeHookSettings outside the IPC entry path.
  // Surface it loudly rather than leaving stale on-disk hooks unchanged.
  if (port === 0) {
    console.error(
      '[writeHookSettings] HookServer port not bound — settings.local.json not updated. ' +
        `Likely a startup-ordering bug (caller invoked before hookServer.start() resolved). cwd=${cwd}`,
    );
    broadcastToast(
      `Hook server not ready — task hooks couldn't be written for ${path.basename(cwd)}. Restart Dash to recover.`,
    );
    return;
  }

  const base = `http://127.0.0.1:${port}`;
  const buildHookUrl = (endpoint: DashHookEndpoint) => `${base}/hook/${endpoint}?ptyId=${ptyId}`;

  const httpHook = (endpoint: DashHookEndpoint, async?: boolean): HttpHook => ({
    type: 'http' as const,
    url: buildHookUrl(endpoint),
    ...(async ? { async: true } : {}),
  });

  const dashHttp = (endpoint: DashHookEndpoint, async?: boolean) =>
    tagDash(httpHook(endpoint, async));

  // Typed against DashHookEvent so a typo'd event key (e.g. 'PreToolUze')
  // fails the build, matching the drift-prevention DashHookEndpoint gives
  // us for endpoints.
  const dashEntries: Partial<Record<DashHookEvent, HookEntry[]>> = {
    Stop: [{ matcher: '', hooks: [dashHttp('stop')] }],
    UserPromptSubmit: [{ matcher: '', hooks: [dashHttp('busy')] }],
    Notification: [
      { matcher: 'permission_prompt', hooks: [dashHttp('notification')] },
      { matcher: 'idle_prompt', hooks: [dashHttp('notification')] },
    ],
    PreToolUse: [{ matcher: '*', hooks: [dashHttp('tool-start', true)] }],
    PostToolUse: [{ matcher: '*', hooks: [dashHttp('tool-end', true)] }],
    PreCompact: [{ matcher: '*', hooks: [dashHttp('compact-start', true)] }],
  };

  // PostCompact added in Claude Code 2.1.76; older CLIs reject the key and
  // skip the entire settings file (GH #127), losing all Dash hooks.
  if (isClaudeVersionAtLeast(2, 1, 76)) {
    dashEntries.PostCompact = [{ matcher: '*', hooks: [dashHttp('compact-end', true)] }];
  }

  // StopFailure added in Claude Code 2.1.78.
  if (isClaudeVersionAtLeast(2, 1, 78)) {
    dashEntries.StopFailure = [{ matcher: '*', hooks: [dashHttp('stop-failure')] }];
  }

  // SessionStart hook re-injects task context (linked issue/work-item prompt)
  // on startup, compact, and clear — NOT resume, since resumed sessions
  // already have context in history.
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
    const contextHook: CommandHook = { type: 'command', command: decodeCmd };
    dashEntries.SessionStart = ['startup', 'compact', 'clear'].map((matcher) => ({
      matcher,
      hooks: [tagDash(contextHook)],
    }));
  }

  try {
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }

    let existing: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as unknown;
        // JSON.parse succeeds on "null", "42", "[]", etc. Only plain objects
        // can be spread and merged safely; anything else is treated as corrupt.
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          existing = parsed as Record<string, unknown>;
        } else {
          throw new Error(`settings.local.json is not a JSON object (got ${typeof parsed})`);
        }
      } catch (err) {
        // Back up the corrupt file before overwriting so the user can recover.
        // If the backup rename fails, we MUST NOT proceed to overwrite — that
        // would destroy the user's on-disk file with no copy left.
        const backupPath = `${settingsPath}.corrupt-${Date.now()}.bak`;
        try {
          fs.renameSync(settingsPath, backupPath);
          console.error(
            `[writeHookSettings] settings.local.json corrupt at ${settingsPath}; backed up to ${backupPath}`,
            err,
          );
          broadcastToast(
            `settings.local.json was unreadable — backed up to ${path.basename(backupPath)} and rewritten.`,
          );
        } catch (renameErr) {
          console.error(
            '[writeHookSettings] Failed to back up corrupt file; leaving on-disk file intact:',
            renameErr,
          );
          broadcastToast(
            `settings.local.json is corrupt and could not be backed up — hooks are off for this task. Fix or remove ${path.basename(settingsPath)} manually.`,
          );
          return;
        }
      }
    }

    const existingHooks =
      existing.hooks && typeof existing.hooks === 'object'
        ? (existing.hooks as Record<string, HookEntry[] | undefined>)
        : {};

    const mergedHooks = mergeHookEntries(existingHooks, dashEntries);

    const merged: Record<string, unknown> = {
      ...existing,
      hooks: mergedHooks,
    };

    const contextUrl = buildHookUrl('context');
    merged.statusLine = {
      type: 'command',
      command: `curl -s --connect-timeout 2 -X POST -H "Content-Type: application/json" -d @- "${contextUrl}" >/dev/null 2>&1`,
    };

    const effectiveAttribution =
      commitAttributionSetting === undefined ? DASH_DEFAULT_ATTRIBUTION : commitAttributionSetting;
    merged.attribution = { commit: effectiveAttribution };

    atomicWriteFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n');
    writtenSettingsPaths.add(settingsPath);
  } catch (err) {
    console.error('[writeHookSettings] Failed:', err);
    broadcastToast(`Could not write ${path.basename(settingsPath)} — hooks are off for this task.`);
  }
}

/**
 * Remove Dash-written hooks and attribution from all settings.local.json files
 * that were written during this session. Preserves user-authored entries
 * by filtering against the merge module's Dash-owned detector instead of
 * deleting the entire managed-event keys.
 */
export function cleanupHookSettings(): void {
  for (const settingsPath of writtenSettingsPaths) {
    try {
      if (!fs.existsSync(settingsPath)) continue;

      const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const hooks = raw.hooks;

      if (hooks && typeof hooks === 'object') {
        for (const key of DASH_HOOK_EVENTS) {
          const entries = hooks[key];
          if (!Array.isArray(entries)) continue;
          const userOnly = entries.filter((e) => !entryIsDashOwned(e));
          if (userOnly.length === 0) delete hooks[key];
          else hooks[key] = userOnly;
        }
        if (Object.keys(hooks).length === 0) {
          delete raw.hooks;
        }
      }

      delete raw.statusLine;
      delete raw.attribution;

      if (Object.keys(raw).length === 0) {
        fs.unlinkSync(settingsPath);
      } else {
        atomicWriteFileSync(settingsPath, JSON.stringify(raw, null, 2) + '\n');
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

  // Resume strategy depends on a load-bearing invariant: each task has a
  // unique cwd. Worktree tasks get their own dir by construction; non-worktree
  // tasks are capped at one per project (enforced in DatabaseService.saveTask /
  // restoreTask, with UI gating in TaskModal as a first line). Because cwd is
  // unique, Claude's own "most recent jsonl in this dir" pick is always the
  // right session — including across /clear and /compact forks.
  //
  // DO NOT relax the one-non-worktree-task cap without reintroducing per-task
  // session pinning; see git history at 32bcdb6 for the previous implementation
  // and the issues that drove its removal.
  const task = DatabaseService.getTask(options.id);
  if (hasAnySessionForCwd(options.cwd)) {
    args.push('--continue');
    // Record that real history exists so we can detect future history loss.
    if (!task?.hadMessages) {
      try {
        DatabaseService.setTaskHadMessages(options.id);
      } catch (err) {
        console.error('[startDirectPty] Failed to set hadMessages for task', options.id, err);
      }
    }
  } else if (task?.hadMessages) {
    // History was previously confirmed but is no longer found — externally cleared.
    // Notify the user so they're not confused by the empty terminal.
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('app:toast', {
          message: `Couldn't resume previous session for "${task.name}" — history may have been cleared. Starting fresh.`,
        });
      }
    }
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
