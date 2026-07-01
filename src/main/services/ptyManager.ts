import * as os from 'os';
import { type WebContents } from 'electron';
import { activityMonitor } from './ActivityMonitor';
import { hookServer } from './HookServer';
import { contextUsageService } from './ContextUsageService';
import { RtkService } from './RtkService';
import { WorkspacePortsRuntime } from './WorkspacePortsRuntime';
import { TerminalMirror } from './TerminalMirror';
import { terminalSnapshotService } from './TerminalSnapshotService';
import { ensureShellConfig } from './ptyShellConfig';
import { findClaudePath, findLatestSessionId } from './claudeCli';
import { writeHookSettings, setCommitAttributionValue } from './ptyHookSettings';
import type { PermissionMode, TaskModel } from '@shared/types';

export type PtyKind = 'agent' | 'shell' | 'tui' | 'service';

interface PtyRecord {
  proc: any; // IPty from node-pty
  cwd: string;
  isDirectSpawn: boolean;
  owner: WebContents | null;
  kind: PtyKind;
  taskId: string | null;
  featureId: string | null;
  /**
   * Headless xterm mirror fed every output chunk (the VS Code pty-host
   * pattern). Serialized on reattach so a fresh renderer xterm shows the
   * full terminal state — including output emitted while no renderer was
   * attached. Persisted to the snapshot files on kill/exit/quit.
   */
  mirror: TerminalMirror | null;
}

const ptys = new Map<string, PtyRecord>();

/** Persist a mirror's state to the snapshot files (sync — quit-safe). */
function persistMirrorSync(id: string, mirror: TerminalMirror): void {
  try {
    const data = mirror.serializeNow();
    if (!data) return;
    const { cols, rows } = mirror.dims();
    terminalSnapshotService
      .saveSnapshot(id, {
        version: 1,
        createdAt: new Date().toISOString(),
        cols,
        rows,
        data,
      })
      .catch(() => {
        // Persistence is best-effort (also: no `app` under test env).
      });
  } catch {
    // Persistence is best-effort.
  }
}

/** Detach, persist, and dispose a record's mirror (kill/exit paths). */
function persistAndDisposeMirror(id: string, record: PtyRecord): void {
  const mirror = record.mirror;
  record.mirror = null;
  if (!mirror) return;
  // TUI tabs never restore from file snapshots (their side-car is torn down
  // and re-offered instead) — persisting would only leave orphan files.
  if (record.kind !== 'tui') persistMirrorSync(id, mirror);
  mirror.dispose();
}

/** Serialize every live mirror to disk — before-quit + crash-resilience interval. */
export function persistAllMirrors(): void {
  for (const [id, record] of ptys) {
    if (record.kind === 'tui') continue;
    if (record.mirror) persistMirrorSync(id, record.mirror);
  }
}

/**
 * Per-task initial prompt to pass as `claude`'s positional argument when the
 * task's agent PTY is spawned. Used by the ports onboarding migrate path:
 * the full inlined setup-prompt body (see PortsSetupPrompt) is stashed here
 * before the renderer triggers the spawn, so CC auto-submits it as soon as
 * the trust-this-directory gate clears — no post-spawn keystroke injection
 * needed (which previously raced first-run gates and flashed visibly in the
 * input box).
 *
 * Single-use: consumed (and removed) by startDirectPty's first spawn. A
 * re-attach to an existing PTY is a no-op — the prompt only applies to the
 * very first claude process for the task. Consequence: if that first spawn
 * dies before the user accepts the trust gate, the prompt is gone and a
 * respawn starts a plain session (the ports TUI then surfaces its
 * 30-minute timeout). The consumption breadcrumb in the ports debug log is
 * the trail for diagnosing that.
 */
const pendingInitialPrompts = new Map<string, string>();

export function setInitialPrompt(taskId: string, prompt: string): void {
  pendingInitialPrompts.set(taskId, prompt);
}

function consumeInitialPrompt(taskId: string): string | undefined {
  const prompt = pendingInitialPrompts.get(taskId);
  if (prompt !== undefined) pendingInitialPrompts.delete(taskId);
  return prompt;
}

/** Test/cleanup hook: drop a stashed prompt without spawning. */
export function discardInitialPrompt(taskId: string): void {
  pendingInitialPrompts.delete(taskId);
}

// Custom environment variables passed to spawned Claude processes (set from renderer settings).
let claudeEnvVars: Record<string, string> = {};

// When true, inherit the full parent process.env as a base instead of the minimal set.
let syncShellEnv = false;

// When true, launch Claude sessions in ultracode (X-High reasoning + multi-agent
// workflow orchestration) via `--settings '{"ultracode":true}'`. ultracode is
// session-only and can't be set through CLAUDE_CODE_EFFORT_LEVEL or --effort, so
// it's applied per-spawn here rather than through the effort env var.
let ultracode = false;

const RESERVED_ENV_KEYS = new Set([
  'PATH',
  'HOME',
  'USER',
  'TERM',
  'COLORTERM',
  'TERM_PROGRAM',
  'COLORFGBG',
  // Dash owns this — it points hooks at the live HookServer port. A user/ports
  // override would misroute or break the no-op-outside-Dash guard.
  'DASH_HOOK_PORT',
]);

export function setCommitAttribution(value: string | undefined): void {
  setCommitAttributionValue(value);
  refreshActivePtyHooks();
}

export interface RefreshFailure {
  settingsPath: string;
  error: string;
}

export interface RefreshResult {
  failures: RefreshFailure[];
}

/**
 * Rewrite settings.local.json for every active PTY. Claude Code re-reads
 * settings per tool call, so this flips hooks live. Returns per-task write
 * failures so callers (RTK toggle, attribution change) can surface a
 * "saved, but N tasks didn't pick it up" message instead of silently
 * returning success.
 */
export function refreshActivePtyHooks(): RefreshResult {
  const failures: RefreshFailure[] = [];
  for (const [id, rec] of ptys) {
    // Shell PTYs (terminal drawer) share cwd with the task PTY but don't run
    // Claude Code and aren't tracked by ActivityMonitor. Writing hook settings
    // for them clobbers the task's settings.local.json with `ptyId=shell:…`,
    // so every subsequent hook event lands in ActivityMonitor's no-op branch
    // and the task's activity dot freezes on whatever it was last showing.
    if (!rec.isDirectSpawn) continue;
    const result = writeHookSettings(rec.cwd, id);
    if (!result.ok) {
      failures.push({ settingsPath: result.settingsPath, error: result.error });
    }
  }
  return { failures };
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

export function setUltracode(enabled: boolean): void {
  ultracode = enabled;
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

/**
 * Build environment for direct CLI spawn.
 * When syncShellEnv is off (default), uses a minimal set for fast, predictable spawns.
 * When on, inherits the full parent process.env as a base.
 */
function buildDirectEnv(isDark: boolean, cwd?: string): Record<string, string> {
  const isWin = process.platform === 'win32';
  const base: Record<string, string> = syncShellEnv
    ? Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => !!e[1]))
    : {};

  // rtk's rewrite output invokes the bare name `rtk`; when the binary is
  // Dash-managed (userData/bin), prepend that dir so the rewrite resolves.
  const rtkBinDir = RtkService.getManagedBinDirForPath();
  const pathSep = isWin ? ';' : ':';
  const basePath = process.env.PATH || '';
  const mergedPath = rtkBinDir ? prependUnique(rtkBinDir, basePath, pathSep) : basePath;

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
  // port; before the CLAUDE_CODE_NO_FLICKER line so reserved-key checks above
  // would still apply if a user declared one in .dash/ports.json (the schema
  // enforces an allowlist regex; the RESERVED_ENV_KEYS list is a defense in
  // depth not really expected to fire here).
  if (cwd) {
    for (const [key, value] of Object.entries(WorkspacePortsRuntime.getEnvForWorktree(cwd))) {
      if (!RESERVED_ENV_KEYS.has(key)) env[key] = value;
    }
  }

  // Disable Claude Code's built-in viewport scrolling — Dash uses its own terminal viewport
  env.CLAUDE_CODE_NO_FLICKER = '1';

  // The HookServer port for this Dash session. ptyHookSettings writes hooks as
  // guarded curl commands that read $DASH_HOOK_PORT at runtime: present here →
  // they reach Dash; absent (a session the user launched outside Dash) → the
  // `[ -n … ]` guard makes them no-op instead of erroring with ECONNREFUSED.
  // Set last so it wins over any inherited value; only when the server is bound
  // (port 0 = not started — leaving the var unset keeps the guard honest).
  if (hookServer.port !== 0) {
    env.DASH_HOOK_PORT = String(hookServer.port);
  }

  return env;
}

/**
 * Prepend `dir` to a path-like string, but only if it isn't already there
 * (case-sensitive on Unix, case-sensitive on Windows is wrong but matches
 * what users actually do). Used when injecting Dash-managed binary
 * directories into the spawned process's PATH.
 */
function prependUnique(dir: string, basePath: string, sep: string): string {
  if (!basePath) return dir;
  const parts = basePath.split(sep);
  if (parts.includes(dir)) return basePath;
  return `${dir}${sep}${basePath}`;
}

/**
 * Spawn Claude CLI directly (fast path, bypasses shell config).
 */
/**
 * Build the `claude` CLI args. Pure so the resume/name/permission policy is
 * unit-testable without spawning. Two load-bearing rules:
 *  - `--resume <id>` and `--name` are mutually exclusive. `--name` is a
 *    fresh-session display label (shown in `/resume` + the terminal title);
 *    combining it with `--resume` is undocumented (rename? ignore? new
 *    session?), and resume already targets the right session by id.
 *  - the initial prompt, when present, is always the LAST positional — CC
 *    auto-submits it once the trust-this-directory gate clears.
 */
export function buildClaudeArgs(opts: {
  resumeSessionId: string | null;
  name?: string;
  permissionMode?: PermissionMode;
  /** Model alias (opus|sonnet|haiku|fable). 'default'/undefined → no --model. */
  model?: TaskModel;
  initialPrompt?: string;
}): string[] {
  const args: string[] = [];
  if (opts.resumeSessionId) {
    args.push('--resume', opts.resumeSessionId);
  } else if (opts.name) {
    args.push('--name', opts.name);
  }
  if (opts.permissionMode === 'acceptEdits') {
    args.push('--permission-mode', 'acceptEdits');
  } else if (opts.permissionMode === 'bypassPermissions') {
    args.push('--dangerously-skip-permissions');
  }
  // Pin the starting model when the user chose a non-default one. 'default' omits
  // the flag so the user's own Claude Code config decides. Orthogonal to
  // resume/name, so it applies to both fresh and resumed sessions.
  if (opts.model && opts.model !== 'default') {
    args.push('--model', opts.model);
  }
  // ultracode is session-scoped; re-apply on every spawn so the user's toggle
  // effectively sticks across the sessions Dash launches. Must precede the
  // positional prompt below.
  if (ultracode) {
    args.push('--settings', JSON.stringify({ ultracode: true }));
  }
  if (opts.initialPrompt) {
    args.push(opts.initialPrompt);
  }
  return args;
}

export async function startDirectPty(options: {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
  permissionMode?: PermissionMode;
  /** Starting model → `claude --model <alias>`. 'default'/undefined omits it. */
  model?: TaskModel;
  isDark?: boolean;
  /** Task name → `claude --name` on a fresh spawn (recognizable in /resume). */
  name?: string;
  sender?: WebContents;
}): Promise<{
  reattached: boolean;
  isDirectSpawn: boolean;
  serializedState?: string;
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
    persistAndDisposeMirror(options.id, existing);
    ptys.delete(options.id);
  } else if (existing) {
    // Serialize BEFORE claiming the owner: a chunk arriving mid-serialize
    // lands in the mirror only (next output repaints it) — never duplicated.
    const serializedState = existing.mirror ? await existing.mirror.serialize() : undefined;
    existing.owner = options.sender || null;
    return { reattached: true, isDirectSpawn: true, serializedState };
  }

  const claudePath = await findClaudePath();

  if (!claudePath) {
    throw new Error('Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code');
  }

  // Resume by the exact newest session id rather than `--continue`. Both rest
  // on a load-bearing invariant: each task has a unique cwd (worktree tasks by
  // construction; non-worktree tasks capped at one per project in
  // DatabaseService.saveTask / restoreTask, UI-gated in TaskModal). Pinning the
  // id we resolve ourselves — the same newest-mtime file SessionWatcherService
  // tails — makes the resumed session deterministically the one Dash is showing,
  // instead of delegating the pick to `--continue`'s undocumented selector. It
  // still follows /clear and /compact forks (each is a newer file).
  //
  // DO NOT relax the one-non-worktree-task cap without revisiting this; see git
  // history at 32bcdb6 for why the old SessionStart-hook pinning was removed.
  const resumeSessionId = findLatestSessionId(options.cwd);

  // Pre-loaded prompt (the inlined ports-setup body). Only present for the
  // ports-migrate flow today; no-op for every other spawn. buildClaudeArgs
  // places it last (CC auto-submits it after the trust gate clears).
  const initialPrompt = consumeInitialPrompt(options.id);

  const args = buildClaudeArgs({
    resumeSessionId,
    name: options.name,
    permissionMode: options.permissionMode,
    model: options.model,
    initialPrompt,
  });

  const env = buildDirectEnv(options.isDark ?? true, options.cwd);

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
    kind: 'agent',
    taskId: options.id,
    featureId: null,
    mirror: new TerminalMirror(options.cols, options.rows),
  };

  ptys.set(options.id, record);
  activityMonitor.register(options.id, proc.pid);

  // Forward output to renderer, replacing the Claude logo with "7" art.
  // The mirror receives the same filtered stream the renderer renders, so
  // its serialized state matches what a reattaching xterm should show.
  const bannerFilter = createBannerFilter((filtered: string) => {
    record.mirror?.write(filtered);
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
    persistAndDisposeMirror(options.id, record);
    ptys.delete(options.id);
  });

  return {
    reattached: false,
    isDirectSpawn: true,
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
}): Promise<{ reattached: boolean; isDirectSpawn: boolean; serializedState?: string }> {
  // Re-attach to existing PTY (e.g., after renderer reload)
  const existing = ptys.get(options.id);
  if (existing) {
    // Serialize BEFORE claiming the owner: a chunk arriving mid-serialize
    // lands in the mirror only (next output repaints it) — never duplicated.
    const serializedState = existing.mirror ? await existing.mirror.serialize() : undefined;
    existing.owner = options.sender || null;
    return { reattached: true, isDirectSpawn: existing.isDirectSpawn, serializedState };
  }

  const pty = getPty();

  const isWin = process.platform === 'win32';
  const shell = isWin ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
  // Interactive, NOT login. The login files (.zprofile/.zlogin) add ~0.5s to
  // every fresh shell's first paint, and their main payload — PATH — is already
  // merged into process.env by fixPath() at boot (which runs `zsh -ilc`), so the
  // spawned shell inherits it. Skipping login trims the startup without losing PATH.
  const args = isWin ? ['-NoLogo'] : ['-i'];

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

  // Same port-env injection as direct PTYs — the terminal drawer shares the
  // task's worktree, so `curl localhost:$FRONTEND_PORT` should resolve there
  // too. RESERVED_ENV_KEYS guard is unnecessary here since we're working from
  // a fresh `{ ...process.env }` and the allocator's env-var allowlist already
  // excludes the reserved set.
  for (const [key, value] of Object.entries(WorkspacePortsRuntime.getEnvForWorktree(options.cwd))) {
    env[key] = value;
  }

  const proc = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: env as Record<string, string>,
  });

  // Shell PTY IDs follow the shape `shell:<taskId>[:N]`; parse the taskId so
  // task-scoped queries (listForTask, restartAllForTask) can find this PTY
  // without resorting to string-prefix matching on the id.
  const shellPrefix = 'shell:';
  const shellRest = options.id.startsWith(shellPrefix)
    ? options.id.slice(shellPrefix.length)
    : options.id;
  const shellTaskId = shellRest.split(':')[0]!;

  const record: PtyRecord = {
    proc,
    cwd: options.cwd,
    isDirectSpawn: false,
    owner: options.sender || null,
    kind: 'shell',
    taskId: shellTaskId,
    featureId: null,
    mirror: new TerminalMirror(options.cols, options.rows),
  };

  ptys.set(options.id, record);
  // Shell PTYs are not tracked by ActivityMonitor — only direct-spawn (Claude)
  // PTYs surface activity state to the renderer. The unregister() call on
  // shell PTY exit (below) is a no-op for unknown ids, so it's safe.

  proc.onData((data: string) => {
    record.mirror?.write(data);
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
    persistAndDisposeMirror(options.id, record);
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
    record.mirror?.resize(cols, rows);
    try {
      record.proc.resize(cols, rows);
    } catch {
      // EBADF can happen during transitions
    }
  }
}

// Grace window for a SIGTERM'd child to flush and exit before we force SIGKILL.
const GRACEFUL_KILL_TIMEOUT_MS = 3000;

/**
 * Gracefully terminate a pty's child process: send SIGTERM so it can flush and
 * exit cleanly, then escalate to SIGKILL only if it overstays the grace window.
 * Resolves once the process is gone (or was already dead).
 *
 * node-pty's bare `kill()` sends SIGHUP, which Claude Code does not trap — so
 * its in-memory session tail (the last several turns) was lost on every
 * refresh/quit, and no `--resume`/`--continue` could recover what never
 * reached the jsonl. SIGTERM + a wait gives Claude the chance to persist first.
 */
type KillableProc = {
  kill: (signal?: string) => void;
  onExit: (listener: (e: { exitCode: number; signal?: number }) => void) => {
    dispose: () => void;
  };
};

function gracefulKillProc(proc: KillableProc, timeoutMs = GRACEFUL_KILL_TIMEOUT_MS): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposable: { dispose: () => void } | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        disposable?.dispose();
      } catch {
        // listener already gone
      }
      resolve();
    };
    try {
      disposable = proc.onExit(() => finish());
    } catch {
      // proc doesn't expose onExit (already disposed) — rely on the timer/catch.
    }
    timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // already dead
      }
      finish();
    }, timeoutMs);
    try {
      proc.kill('SIGTERM');
    } catch {
      // already dead — nothing to wait for
      finish();
    }
  });
}

/** Detach a record from all registries and persist its mirror (shared by the
 *  kill paths). The map delete makes the spawn-time onExit handler a no-op. */
function teardownRecord(id: string, record: PtyRecord): void {
  ptys.delete(id);
  activityMonitor.unregister(id);
  remoteControlService.unregister(id);
  contextUsageService.unregister(id);
  // Persist before killing — restart() relies on the snapshot for visual
  // context when it respawns into the same id.
  persistAndDisposeMirror(id, record);
}

function killPtyInternal(id: string): Promise<void> {
  const record = ptys.get(id);
  if (!record) return Promise.resolve();
  teardownRecord(id, record);
  return gracefulKillProc(record.proc);
}

/**
 * Kill a specific PTY (graceful: SIGTERM → grace → SIGKILL). Fire-and-forget;
 * callers that must serialize a respawn against the dying process use
 * killPtyAwait instead.
 */
export function killPty(id: string): void {
  void killPtyInternal(id);
}

/**
 * Kill a specific PTY and resolve once it has actually exited (or the grace
 * window elapsed). The renderer's reattach/restart paths await this before
 * respawning so the new `claude --resume` process never races the dying one
 * for the session jsonl (a brief two-writer overlap could corrupt the tail).
 */
export function killPtyAwait(id: string): Promise<void> {
  return killPtyInternal(id);
}

/**
 * Kill all PTYs (on app quit). Awaits every child's graceful exit in parallel
 * so the bound is ~one grace window, not the sum — the before-quit handler
 * awaits this so the app doesn't exit before Claude flushes its session.
 */
export async function killAll(): Promise<void> {
  const pending: Promise<void>[] = [];
  for (const [id, record] of ptys) {
    persistAndDisposeMirror(id, record);
    pending.push(gracefulKillProc(record.proc));
  }
  ptys.clear();
  // Bulk cleanup — don't rely on onExit during shutdown
  activityMonitor.stop();
  await Promise.all(pending);
}

/**
 * Kill all PTYs owned by a specific WebContents (on window close).
 * Fire-and-forget graceful kills — the app stays alive (macOS) so there's no
 * exit to race, but the child still gets its SIGTERM flush window.
 */
export function killByOwner(owner: WebContents): void {
  for (const [id, record] of ptys) {
    if (record.owner === owner) {
      teardownRecord(id, record);
      void gracefulKillProc(record.proc);
    }
  }
}

/**
 * Return all PTY ids attached to `taskId`, optionally filtered by kind /
 * featureId. Used by SessionRegistry.restartAllForTask to find the right set
 * without string-prefix matching on PTY ids — which would accidentally hit
 * future task-bound PTYs (e.g. the ports TUI).
 */
export function listForTask(
  taskId: string,
  opts?: { kinds?: PtyKind[]; featureId?: string },
): string[] {
  const result: string[] = [];
  for (const [id, rec] of ptys) {
    if (rec.taskId !== taskId) continue;
    if (opts?.kinds && !opts.kinds.includes(rec.kind)) continue;
    if (opts?.featureId && rec.featureId !== opts.featureId) continue;
    result.push(id);
  }
  return result;
}

/**
 * Spawn an arbitrary command in a PTY tagged as kind='tui'. Used by feature
 * orchestrators (e.g. ports onboarding) to host a side-car interactive
 * program inside the existing drawer tab UI without polluting agent/shell
 * code paths.
 */
export async function startCommandPty(options: {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  env?: Record<string, string>;
  owner: WebContents | null;
  taskId: string;
  featureId: string;
  /** PTY registry kind. Side-car TUIs (default) vs user-facing service runs. */
  kind?: 'tui' | 'service';
  /**
   * Fires only when the process exits on its own — an explicit killPty()
   * removes the record first, so the guarded handler below never reaches it.
   * Callers that kill notify themselves; this hook covers self-death.
   */
  onExit?: (info: { exitCode: number; signal?: number }) => void;
}): Promise<{ reattached: boolean }> {
  const existing = ptys.get(options.id);
  if (existing) {
    existing.owner = options.owner;
    return { reattached: true };
  }

  const pty = getPty();
  const proc = pty.spawn(options.command, options.args, {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) } as Record<string, string>,
  });

  const record: PtyRecord = {
    proc,
    cwd: options.cwd,
    isDirectSpawn: false,
    owner: options.owner,
    kind: options.kind ?? 'tui',
    taskId: options.taskId,
    featureId: options.featureId,
    mirror: new TerminalMirror(options.cols, options.rows),
  };

  ptys.set(options.id, record);

  proc.onData((data: string) => {
    // The mirror always consumes — output emitted before any renderer
    // attaches (service startup banners) is recovered from its serialized
    // state on reattach.
    record.mirror?.write(data);
    if (record.owner && !record.owner.isDestroyed()) {
      record.owner.send(`pty:data:${options.id}`, data);
    }
  });

  proc.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
    if (ptys.get(options.id) !== record) return;
    if (record.owner && !record.owner.isDestroyed()) {
      record.owner.send(`pty:exit:${options.id}`, { exitCode, signal });
    }
    persistAndDisposeMirror(options.id, record);
    ptys.delete(options.id);
    options.onExit?.({ exitCode, signal });
  });

  return { reattached: false };
}

// ---------------------------------------------------------------------------
// Test-only hooks — not exported via any index. The Map is module-private,
// so unit tests need these handles to seed/clear synthetic records.
// ---------------------------------------------------------------------------

export function __testReset(): void {
  for (const record of ptys.values()) {
    record.mirror?.dispose();
    record.mirror = null;
  }
  ptys.clear();
}

export function __registerForTest(
  id: string,
  rec: { kind: PtyKind; taskId: string | null; featureId: string | null },
): void {
  ptys.set(id, {
    proc: null,
    cwd: '/tmp',
    isDirectSpawn: rec.kind === 'agent',
    owner: null,
    kind: rec.kind,
    taskId: rec.taskId,
    featureId: rec.featureId,
    mirror: null,
  });
}
