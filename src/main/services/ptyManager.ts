import * as fs from 'fs';
import { type WebContents } from 'electron';
import { activityMonitor } from './ActivityMonitor';
import { hookServer } from './HookServer';
import { contextUsageService } from './ContextUsageService';
import { stripHostTerminalEnv } from './hostTerminalEnv';
import { TerminalMirror } from './TerminalMirror';
import { terminalSnapshotService } from './TerminalSnapshotService';
import { ensureShellConfig, shellHistoryPath } from './ptyShellConfig';
import { findClaudePath, findLatestSessionId } from './claudeCli';
import { buildClaudeEnv, prependUnique } from './claudeEnv';
import { addonSessionEnv } from '../addonHost/registry';
import { supervisorService } from './SupervisorService';
import { DatabaseService } from './DatabaseService';
import { writeHookSettings, setCommitAttributionValue } from './ptyHookSettings';
import type { PermissionMode, TaskModel } from '@shared/types';

// Launch configuration setters live in claudeEnv (shared with the supervisor
// dispatch); re-exported so the IPC layer keeps one import site.
export { setClaudeEnvVars, setSyncShellEnv, setUltracode } from './claudeEnv';

export type PtyKind = 'agent' | 'shell' | 'service';

interface PtyRecord {
  proc: any; // IPty from node-pty
  cwd: string;
  isDirectSpawn: boolean;
  owner: WebContents | null;
  kind: PtyKind;
  taskId: string | null;
  featureId: string | null;
  /** Supervisor job the `claude attach` client is connected to (agent PTYs). */
  jobId: string | null;
  /**
   * Headless xterm mirror fed every output chunk (the VS Code pty-host
   * pattern). Serialized on reattach so a fresh renderer xterm shows the
   * full terminal state — including output emitted while no renderer was
   * attached. Persisted to the snapshot files on kill/exit/quit. Shell and
   * service PTYs only: an agent PTY is a `claude attach` client that repaints
   * its whole screen on every attach, so there is nothing to mirror.
   */
  mirror: TerminalMirror | null;
}

const ptys = new Map<string, PtyRecord>();

/** PTY id of the attach client for a session that belongs to no task. */
export const FOREIGN_SESSION_PTY_PREFIX = 'session:';

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
  persistMirrorSync(id, mirror);
  mirror.dispose();
}

/** Serialize every live mirror to disk — before-quit + crash-resilience interval. */
export function persistAllMirrors(): void {
  for (const [id, record] of ptys) {
    if (record.mirror) persistMirrorSync(id, record.mirror);
  }
}

/**
 * Per-task initial prompt to pass as the dispatch's positional argument when
 * the task's session is first started under the supervisor. Used by the ports
 * onboarding migrate path: the full inlined setup-prompt body (see
 * PortsSetupPrompt) is stashed here before the renderer triggers the spawn, so
 * CC auto-submits it as soon as the session starts — no post-spawn keystroke
 * injection needed (which previously raced first-run gates and flashed
 * visibly in the input box).
 *
 * Single-use: consumed (and removed) by the first dispatch for the task. A
 * re-attach to an existing session is a no-op — the prompt only applies to the
 * very first session for the task.
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

// When true, `claude stop` every task session before quitting (setting
// `stopSessionsOnQuit`, default off: sessions outlive Dash by design).
let stopSessionsOnQuit = false;

export function setStopSessionsOnQuit(enabled: boolean): void {
  stopSessionsOnQuit = enabled;
}

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
 * Rewrite settings.local.json for every task with a live session. Claude Code
 * re-reads settings per tool call, so this flips hooks live — also for a
 * session nobody is attached to right now. Returns per-task write failures so
 * callers (add-on toggle, attribution change) can surface a "saved, but N tasks
 * didn't pick it up" message instead of silently returning success.
 */
export function refreshActivePtyHooks(): RefreshResult {
  const failures: RefreshFailure[] = [];
  const targets = new Map<string, string>();
  for (const [id, rec] of ptys) {
    // Shell PTYs (terminal drawer) share cwd with the task PTY but don't run
    // Claude Code and aren't tracked by ActivityMonitor. Writing hook settings
    // for them clobbers the task's settings.local.json with `ptyId=shell:…`,
    // so every subsequent hook event lands in ActivityMonitor's no-op branch
    // and the task's activity dot freezes on whatever it was last showing.
    // Foreign-session attach clients (taskId null) own no settings file either.
    if (!rec.isDirectSpawn || !rec.taskId) continue;
    targets.set(rec.taskId, rec.cwd);
  }
  try {
    for (const task of DatabaseService.getTasksWithSessions()) {
      if (!task.archivedAt && !targets.has(task.id)) targets.set(task.id, task.path);
    }
  } catch (err) {
    console.error('[refreshActivePtyHooks] task lookup failed:', err);
  }
  for (const [taskId, cwd] of targets) {
    const result = writeHookSettings(cwd, taskId);
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

function samePath(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return false;
  }
}

/**
 * Make sure the task has a live job under the supervisor and return its id.
 * Dispatches (`claude --bg`) when the task has none yet, when the supervisor
 * no longer lists the recorded job (`claude rm`, forgotten after a machine
 * reset) or when the job is bound to another directory (worktree moved while
 * a job existed). A dispatch resumes the task's recorded session, or — for a
 * task from before the supervisor — the newest transcript under its current
 * and pre-migration paths, so the conversation carries over.
 */
async function ensureTaskSession(opts: {
  id: string;
  cwd: string;
  name: string;
  permissionMode?: PermissionMode;
  model?: TaskModel;
  previousPath?: string | null;
  jobId: string | null;
  sessionId: string | null;
  env: Record<string, string>;
}): Promise<string> {
  let resumeSessionId = opts.sessionId;
  if (opts.jobId) {
    let row;
    try {
      row = await supervisorService.find(opts.jobId);
    } catch (err) {
      console.warn(
        `[ptyManager] supervisor listing failed; assuming job ${opts.jobId} is live`,
        err,
      );
      return opts.jobId;
    }
    if (row && samePath(row.cwd, opts.cwd)) return opts.jobId;
    if (row) {
      // Job still bound to the old cwd — the supervisor would refuse a resume
      // ("working directory no longer exists") and queue the prompt. Drop it.
      resumeSessionId = row.sessionId ?? resumeSessionId;
      await supervisorService.stop(opts.jobId).catch(() => {});
      await supervisorService.remove(opts.jobId).catch(() => {});
    }
  }
  if (!resumeSessionId) {
    resumeSessionId = findLatestSessionId(opts.cwd, opts.previousPath);
  }
  const prompt = consumeInitialPrompt(opts.id);
  const { jobId, sessionId } = await supervisorService.dispatch({
    cwd: opts.cwd,
    name: opts.name,
    permissionMode: opts.permissionMode,
    model: opts.model,
    prompt,
    resumeSessionId,
    env: opts.env,
  });
  DatabaseService.setTaskSession(opts.id, { jobId, sessionId: sessionId ?? resumeSessionId });
  return jobId;
}

/**
 * Spawn a `claude attach <jobId>` client in a PTY. The session process
 * belongs to the supervisor; this client only renders it, so killing the PTY
 * (task switch, renderer reload, quit) never touches the session.
 */
function spawnAttach(options: {
  id: string;
  jobId: string;
  cwd: string;
  cols: number;
  rows: number;
  env: Record<string, string>;
  claudePath: string;
  taskId: string | null;
  sender?: WebContents;
}): PtyRecord {
  const pty = getPty();
  const args = ['attach', options.jobId];
  // On Windows, .cmd files must be invoked through cmd.exe
  const spawnFile = process.platform === 'win32' ? 'cmd.exe' : options.claudePath;
  const spawnArgs = process.platform === 'win32' ? ['/c', options.claudePath, ...args] : args;

  const proc = pty.spawn(spawnFile, spawnArgs, {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: options.env,
  });

  const record: PtyRecord = {
    proc,
    cwd: options.cwd,
    isDirectSpawn: true,
    owner: options.sender || null,
    kind: 'agent',
    taskId: options.taskId,
    featureId: null,
    jobId: options.jobId,
    mirror: null,
  };
  ptys.set(options.id, record);

  // Forward output to renderer, replacing the Claude logo with "7" art.
  const bannerFilter = createBannerFilter((filtered: string) => {
    if (record.owner && !record.owner.isDestroyed()) {
      record.owner.send(`pty:data:${options.id}`, filtered);
    }
  });

  proc.onData((data: string) => {
    bannerFilter(data);
    if (options.taskId) activityMonitor.noteData(options.taskId);
    remoteControlService.onPtyData(options.id, data);
  });

  proc.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
    // Skip if this PTY was replaced by a new attach (kill+restart on reattach)
    if (ptys.get(options.id) !== record) return;
    // The attach client exited (Esc out of agent view, Ctrl+Z, or the session
    // process went away). The session and its activity entry live on; only
    // the client-side registrations go.
    remoteControlService.unregister(options.id);
    if (record.owner && !record.owner.isDestroyed()) {
      record.owner.send(`pty:exit:${options.id}`, { exitCode, signal });
    }
    ptys.delete(options.id);
  });

  return record;
}

/**
 * Open the task's session in a PTY: dispatch it under the supervisor when it
 * has none, then `claude attach`. A second call for the same id (renderer
 * reload) replaces the attach client — the fresh one repaints the screen, so
 * there is no mirror state to hand back.
 */
export async function startDirectPty(options: {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
  permissionMode?: PermissionMode;
  /** Starting model → `claude --model <alias>` on dispatch. 'default'/undefined omits it. */
  model?: TaskModel;
  isDark?: boolean;
  /** Task name → `claude --bg --name`. */
  name?: string;
  /** Pre-migration worktree path (Task.previousPath); its transcript dir is
   *  searched too when picking the session to resume on the first dispatch. */
  previousPath?: string | null;
  /** Recorded supervisor job/session (Task.jobId / Task.sessionId). */
  jobId?: string | null;
  sessionId?: string | null;
  sender?: WebContents;
}): Promise<{
  reattached: boolean;
  isDirectSpawn: boolean;
  jobId: string;
}> {
  const existing = ptys.get(options.id);
  if (existing) {
    // A shell PTY at the task id (stray) or a previous attach client: either
    // way the new attach replaces it.
    await killPtyInternal(options.id);
  }

  const claudePath = await findClaudePath();
  if (!claudePath) {
    throw new Error('Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code');
  }

  const env = buildClaudeEnv(options.isDark ?? true, options.cwd);

  // Before dispatch, so the session's first turn already reports.
  writeHookSettings(options.cwd, options.id);
  activityMonitor.ensure(options.id);

  const jobId = await ensureTaskSession({
    id: options.id,
    cwd: options.cwd,
    name: options.name ?? options.id,
    permissionMode: options.permissionMode,
    model: options.model,
    previousPath: options.previousPath,
    jobId: options.jobId ?? null,
    sessionId: options.sessionId ?? null,
    env,
  });

  spawnAttach({
    id: options.id,
    jobId,
    cwd: options.cwd,
    cols: options.cols,
    rows: options.rows,
    env,
    claudePath,
    taskId: options.id,
    sender: options.sender,
  });

  return { reattached: false, isDirectSpawn: true, jobId };
}

/**
 * Attach to a session that belongs to no task (started outside Dash). No
 * hooks are written — the worktree's settings file is not Dash's to edit.
 */
export async function startSessionAttach(options: {
  jobId: string;
  cwd: string;
  cols: number;
  rows: number;
  isDark?: boolean;
  sender?: WebContents;
}): Promise<{ id: string }> {
  const id = `${FOREIGN_SESSION_PTY_PREFIX}${options.jobId}`;
  if (ptys.has(id)) await killPtyInternal(id);
  const claudePath = await findClaudePath();
  if (!claudePath) {
    throw new Error('Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code');
  }
  spawnAttach({
    id,
    jobId: options.jobId,
    cwd: options.cwd,
    cols: options.cols,
    rows: options.rows,
    env: buildClaudeEnv(options.isDark ?? true),
    claudePath,
    taskId: null,
    sender: options.sender,
  });
  return { id };
}

/** Stop the task's session (`claude stop`); the attach client goes with it. */
export async function stopTaskSession(taskId: string): Promise<void> {
  await killPtyInternal(taskId);
  const task = DatabaseService.getTask(taskId);
  if (!task?.jobId) return;
  await supervisorService.stop(task.jobId);
  DatabaseService.markTaskSessionStopped(taskId);
}

/**
 * Forget the task's session (`claude stop` + `claude rm`; the transcript is
 * kept). Task delete uses this; the next open of an archived-then-restored
 * task starts a fresh job that resumes the recorded session id.
 */
export async function removeTaskSession(taskId: string): Promise<void> {
  await killPtyInternal(taskId);
  const task = DatabaseService.getTask(taskId);
  activityMonitor.unregister(taskId);
  if (!task?.jobId) return;
  await supervisorService.stop(task.jobId).catch(() => {});
  await supervisorService.remove(task.jobId);
  DatabaseService.setTaskSession(taskId, { jobId: null, sessionId: task.sessionId });
}

/**
 * Re-dispatch the task's session so it picks up a changed environment
 * (ports, user env vars, ultracode): stop + rm the current job, then the
 * next startDirectPty resumes the same session id in a fresh job. The
 * renderer's restart path calls this before re-attaching.
 */
export async function restartTaskSession(taskId: string): Promise<void> {
  await killPtyInternal(taskId);
  const task = DatabaseService.getTask(taskId);
  if (!task?.jobId) return;
  let sessionId = task.sessionId;
  try {
    sessionId = (await supervisorService.find(task.jobId))?.sessionId ?? sessionId;
  } catch {
    // Listing unavailable — the recorded id is the best we have.
  }
  await supervisorService.stop(task.jobId).catch(() => {});
  await supervisorService.remove(task.jobId).catch(() => {});
  DatabaseService.setTaskSession(taskId, { jobId: null, sessionId });
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

  // Shell PTY IDs follow the shape `shell:<taskId>[:N]`; parse the taskId so
  // task-scoped queries (listForTask, restartAllForTask) can find this PTY
  // without resorting to string-prefix matching on the id, and so the shell
  // gets the task's own history file.
  const shellPrefix = 'shell:';
  const shellRest = options.id.startsWith(shellPrefix)
    ? options.id.slice(shellPrefix.length)
    : options.id;
  const shellTaskId = shellRest.split(':')[0]!;

  const isWin = process.platform === 'win32';
  const shell = isWin ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
  // Interactive, NOT login. The login files (.zprofile/.zlogin) add ~0.5s to
  // every fresh shell's first paint, and their main payload — PATH — is already
  // merged into process.env by fixPath() at boot (which runs `zsh -ilc`), so the
  // spawned shell inherits it. Skipping login trims the startup without losing PATH.
  const args = isWin ? ['-NoLogo'] : ['-i'];

  // Clean environment for shell. stripHostTerminalEnv drops the identity of the
  // terminal Dash was launched from (dev only) so this shell doesn't boot that
  // terminal's shell integration and report itself as one of its sessions.
  const env = stripHostTerminalEnv({ ...process.env });
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

    // Per-task command history. zsh picks DASH_HISTFILE up at the end of the
    // Dash rc wrapper; bash honours HISTFILE from the environment unless the
    // user's .bashrc overrides it.
    const historyFile = shellHistoryPath(shellTaskId);
    env.DASH_HISTFILE = historyFile;
    if (shell.endsWith('/bash') || shell === 'bash') env.HISTFILE = historyFile;
  }

  // Add-on env and PATH dirs (src/main/addons), same as the task's Claude env.
  const addons = addonSessionEnv(options.cwd);
  Object.assign(env, addons.env);
  const pathSep = isWin ? ';' : ':';
  for (const dir of [...addons.pathDirs].reverse()) {
    env.PATH = prependUnique(dir, env.PATH ?? '', pathSep);
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
    kind: 'shell',
    taskId: shellTaskId,
    featureId: null,
    jobId: null,
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
  if (!record) return;
  // A bare Escape (one byte — arrow keys and the like arrive as CSI
  // sequences, `\x1b[…`) on the agent pane is Claude Code's interrupt. Claude
  // Code fires no hook for it, so this keystroke is the only instant signal
  // that the turn is over. See ActivityMonitor.setInterrupted().
  if (record.kind === 'agent' && record.taskId && data === '\x1b') {
    activityMonitor.setInterrupted(record.taskId);
  }
  record.proc?.write(data);
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
 * Resolves once the process is gone (or was already dead). Shells get the
 * window to run their exit hooks; an agent PTY is only a `claude attach`
 * client, so the session keeps writing its transcript under the supervisor
 * regardless of how the client dies.
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
 *  kill paths). The map delete makes the spawn-time onExit handler a no-op.
 *  Activity and context usage are keyed by task and describe the session,
 *  which outlives its attach client, so they stay for agent PTYs. */
function teardownRecord(id: string, record: PtyRecord): void {
  ptys.delete(id);
  if (record.kind !== 'agent') {
    activityMonitor.unregister(id);
    contextUsageService.unregister(id);
  }
  remoteControlService.unregister(id);
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
 * window elapsed). Callers that respawn into the same id await this so the
 * new process never races the dying one.
 */
export function killPtyAwait(id: string): Promise<void> {
  return killPtyInternal(id);
}

/**
 * Kill all PTYs (on app quit). Awaits every child's graceful exit in parallel
 * so the bound is ~one grace window, not the sum. Task sessions keep running
 * under the supervisor unless `stopSessionsOnQuit` is on, in which case each
 * one gets a `claude stop` first (best effort, bounded by the quit safety net).
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
  if (stopSessionsOnQuit) {
    try {
      for (const task of DatabaseService.getTasksWithSessions()) {
        if (task.jobId && !task.archivedAt) {
          pending.push(
            supervisorService.stop(task.jobId).then(
              () => DatabaseService.markTaskSessionStopped(task.id),
              (err) => console.warn(`[ptyManager] stop on quit failed for ${task.name}:`, err),
            ),
          );
        }
      }
    } catch (err) {
      console.warn('[ptyManager] stop-on-quit lookup failed:', err);
    }
  }
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
 * Spawn an arbitrary command in a PTY tagged as kind='service'. Used by the
 * add-on host (ctx.terminals.run) to run a command as a drawer tab without
 * touching agent/shell code paths.
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
  /** PTY registry kind. Only service runs (add-on terminals) today. */
  kind: 'service';
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
    env: { ...stripHostTerminalEnv(process.env), ...(options.env ?? {}) } as Record<string, string>,
  });

  const record: PtyRecord = {
    proc,
    cwd: options.cwd,
    isDirectSpawn: false,
    owner: options.owner,
    kind: options.kind,
    taskId: options.taskId,
    featureId: options.featureId,
    jobId: null,
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
    jobId: null,
    mirror: null,
  });
}
