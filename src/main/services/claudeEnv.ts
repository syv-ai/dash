import * as os from 'os';
import { stripHostTerminalEnv } from './hostTerminalEnv';
import { WorkspacePortsRuntime } from './WorkspacePortsRuntime';
import { addonSessionEnv } from '../addonHost/registry';

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

// When true, launch Claude sessions in ultracode (X-High reasoning + multi-agent
// workflow orchestration) via `--settings '{"ultracode":true}'`. ultracode is
// session-only and can't be set through CLAUDE_CODE_EFFORT_LEVEL or --effort, so
// it's applied per-dispatch rather than through the effort env var.
let ultracode = false;

/**
 * Keys a user/ports override must never replace. The hook server port used to
 * be here as DASH_HOOK_PORT; hooks now read the port from a file (see
 * HookServer.portFilePath) because the supervisor reuses the dispatch-time env
 * on every respawn while Dash binds a new port each launch.
 */
export const RESERVED_ENV_KEYS: ReadonlySet<string> = new Set([
  'PATH',
  'HOME',
  'USER',
  'TERM',
  'COLORTERM',
  'TERM_PROGRAM',
  'COLORFGBG',
]);

export function setClaudeEnvVars(vars: Record<string, string>): void {
  claudeEnvVars = vars;
}

export function setSyncShellEnv(enabled: boolean): void {
  syncShellEnv = enabled;
}

export function setUltracode(enabled: boolean): void {
  ultracode = enabled;
}

export function isUltracode(): boolean {
  return ultracode;
}

/**
 * Prepend `dir` to a path-like string, but only if it isn't already there
 * (case-sensitive on Unix, case-sensitive on Windows is wrong but matches
 * what users actually do). Used when injecting Dash-managed binary
 * directories into the spawned process's PATH.
 */
export function prependUnique(dir: string, basePath: string, sep: string): string {
  if (!basePath) return dir;
  const parts = basePath.split(sep);
  if (parts.includes(dir)) return basePath;
  return `${dir}${sep}${basePath}`;
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

  // Add-ons may put directories on PATH (e.g. RTK's managed binary, which its
  // rewritten commands invoke by bare name).
  const pathSep = isWin ? ';' : ':';
  let mergedPath = process.env.PATH || '';
  const addons = addonSessionEnv(cwd);
  for (const dir of [...addons.pathDirs].reverse()) {
    mergedPath = prependUnique(dir, mergedPath, pathSep);
  }

  const env: Record<string, string> = {
    ...base,
    TERM_PROGRAM: 'dash',
    HOME: os.homedir(),
    PATH: mergedPath,
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

  // Merge per-task port env vars (FRONTEND_PORT=…, etc) so commands run by
  // Claude resolve the same host port the user sees in the ports panel.
  // After user settings so a project never accidentally clobbers an allocated
  // port. The supervisor freezes these into the job at dispatch, so a port
  // change after dispatch needs a re-dispatch (ptyManager.restartTaskSession).
  if (cwd) {
    for (const [key, value] of Object.entries(WorkspacePortsRuntime.getEnvForWorktree(cwd))) {
      if (!RESERVED_ENV_KEYS.has(key)) env[key] = value;
    }
  }

  // Add-on env (src/main/addons), after ports and user settings. Reserved keys
  // are already dropped by the host.
  Object.assign(env, addons.env);

  // Disable Claude Code's built-in viewport scrolling — Dash uses its own terminal viewport
  env.CLAUDE_CODE_NO_FLICKER = '1';

  return env;
}
