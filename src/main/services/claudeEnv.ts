import * as os from 'os';
import { stripHostTerminalEnv } from './hostTerminalEnv';
import { WorkspacePortsRuntime } from './WorkspacePortsRuntime';
import type { TaskEffort } from '@shared/effort';

/**
 * Environment and launch options shared by every `claude` process Dash starts
 * for a task: the supervisor dispatch (`claude --bg`, whose env the supervisor
 * freezes into the job and reuses on every respawn) and the attach client
 * (`claude attach`) in the task's PTY. Split out of ptyManager so both go
 * through one builder.
 */

// Custom environment variables passed to spawned Claude processes (set from renderer settings).
let claudeEnvVars: Record<string, string> = {};

// When true, inherit the full parent process.env as a base instead of the minimal set.
let syncShellEnv = false;

// Settings → Claude's Effort and Ultracode as one value: the `--effort` a task
// that sets none starts with (null → no flag, Claude Code decides). A flag, not
// CLAUDE_CODE_EFFORT_LEVEL: that env var outranks `--effort`, so a task's own
// effort couldn't override it, and it doesn't take ultracode.
let defaultEffort: TaskEffort | null = null;

/**
 * Keys a user/ports override must never replace. The hook server port used to
 * be here as DASH_HOOK_PORT; hooks now read the port from a file (see
 * HookServer.portFilePath) because the supervisor reuses the dispatch-time env
 * on every respawn while Dash binds a new port each launch.
 */
const RESERVED_ENV_KEYS = new Set([
  'PATH',
  'HOME',
  'USER',
  'TERM',
  'COLORTERM',
  'TERM_PROGRAM',
  'COLORFGBG',
  // Dash's own (see buildClaudeEnv); a user value would split writes from reads.
  'CLAUDE_CONFIG_DIR',
]);

export function setClaudeEnvVars(vars: Record<string, string>): void {
  claudeEnvVars = vars;
}

export function setSyncShellEnv(enabled: boolean): void {
  syncShellEnv = enabled;
}

export function setDefaultEffort(effort: TaskEffort | null): void {
  defaultEffort = effort;
}

export function getDefaultEffort(): TaskEffort | null {
  return defaultEffort;
}

/**
 * The env a task's session itself needs: the user's env vars from settings,
 * then the task's port vars (FRONTEND_PORT=…) so commands resolve the host
 * port the ports panel shows; ports after user vars so a project never
 * clobbers an allocated port. Reserved keys are never overridden. A session
 * gets this through its settings file (buildSessionSettings), not its
 * process env.
 */
export function buildSessionEnv(cwd?: string): Record<string, string> {
  const env: Record<string, string> = {};
  const merge = (vars: Record<string, string>) => {
    for (const [key, value] of Object.entries(vars)) {
      if (!RESERVED_ENV_KEYS.has(key)) env[key] = value;
    }
  };
  merge(claudeEnvVars);
  if (cwd) merge(WorkspacePortsRuntime.getEnvForWorktree(cwd));
  return env;
}

/**
 * Build the environment for a `claude` process in `cwd`.
 * When syncShellEnv is off (default), uses a minimal set for fast, predictable spawns.
 * When on, inherits the full parent process.env as a base.
 */
export function buildClaudeEnv(isDark: boolean, cwd?: string): Record<string, string> {
  const isWin = process.platform === 'win32';
  const base: Record<string, string> = syncShellEnv
    ? stripHostTerminalEnv(
        Object.fromEntries(
          Object.entries(process.env).filter((e): e is [string, string] => !!e[1]),
        ),
      )
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
  // Dash reads Claude Code's state (`claude agents`, the session registry,
  // trust) from its own CLAUDE_CONFIG_DIR, so every claude it spawns must use
  // the same one. Only when set: an explicit ~/.claude would move .claude.json.
  if (process.env.CLAUDE_CONFIG_DIR) env.CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;

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

  Object.assign(env, buildSessionEnv(cwd));

  // Disable Claude Code's built-in viewport scrolling — Dash uses its own terminal viewport
  env.CLAUDE_CODE_NO_FLICKER = '1';

  return env;
}
