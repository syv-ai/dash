import * as fs from 'fs';
import { type WebContents } from 'electron';
import { activityMonitor } from './ActivityMonitor';
import { hookServer } from './HookServer';
import { contextUsageService } from './ContextUsageService';
import { stripHostTerminalEnv } from './hostTerminalEnv';
import { WorkspacePortsRuntime } from './WorkspacePortsRuntime';
import { TerminalMirror } from './TerminalMirror';
import { terminalSnapshotService } from './TerminalSnapshotService';
import { ensureShellConfig, shellHistoryPath } from './ptyShellConfig';
import { findClaudePath, findLatestSessionId, requireSupportedClaude } from './claudeCli';
import { buildClaudeEnv, buildSessionEnv, isUltracode } from './claudeEnv';
import { supervisorService, DispatchError } from './SupervisorService';
import { buildSessionSettings, parseUntrustedRoot } from './supervisorSession';
import { isWorkspaceTrusted } from '../utils/claudePaths';
import { DatabaseService } from './DatabaseService';
import { dashAllowTools, mcpConfigForDispatch } from '../control/mcpConfig';
import { writeTaskSettings } from './taskSettings';
import { writeHookSettings, setCommitAttributionValue } from './ptyHookSettings';
import type { PermissionMode, TaskModel } from '@shared/types';

// Launch configuration setters live in claudeEnv (shared with the supervisor
// dispatch); re-exported so the IPC layer keeps one import site.
export { setClaudeEnvVars, setSyncShellEnv, setUltracode } from './claudeEnv';

export type PtyKind = 'agent' | 'shell' | 'tui' | 'service';

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

/**
 * `claude --bg` refused the task's folder: Claude Code's workspace trust
 * prompt was never accepted for `root`. A background session cannot show that
 * prompt, so the pane runs it via runTrustPrompt() and then starts again.
 */
export class UntrustedWorkspaceError extends Error {
  constructor(
    message: string,
    readonly root: string,
  ) {
    super(message);
    this.name = 'UntrustedWorkspaceError';
  }
}

/** Trust root per task whose last dispatch was refused as untrusted. */
const untrustedRoots = new Map<string, string>();

/** The trust root the task's last dispatch was refused for, if it still waits
 *  on Claude Code's trust prompt. */
export function getUntrustedRoot(taskId: string): string | undefined {
  return untrustedRoots.get(taskId);
}

/**
 * Whether the task is clear of the needs-trust mark: true when it has none, or
 * when its root has been trusted since (`claude` run in the folder outside
 * Dash), in which case the mark is dropped. False while the root still waits
 * on the trust prompt.
 */
export async function recheckWorkspaceTrust(taskId: string): Promise<boolean> {
  const root = untrustedRoots.get(taskId);
  if (!root) return true;
  if (!(await isWorkspaceTrusted(root))) return false;
  if (untrustedRoots.get(taskId) === root) untrustedRoots.delete(taskId);
  return true;
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
 * callers (RTK toggle, attribution change) can surface a "saved, but N tasks
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
      if (!task.shelved && !targets.has(task.id)) targets.set(task.id, task.path);
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

/** The last `lines` lines a shell/service PTY shows, as plain text; null when
 *  there is no such PTY or it keeps no mirror (agent PTYs). */
export async function readPtyText(id: string, lines: number): Promise<string | null> {
  const mirror = ptys.get(id)?.mirror;
  return mirror ? mirror.toPlainText(lines) : null;
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
 *
 * `wakeStopped`: a listed job whose process is gone (`claude stop`, reaped)
 * is woken in place with `claude respawn`, which keeps its dispatch options.
 * A pane start needs no wake (`claude attach` wakes it).
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
  /** From the task row at this call, so a restart after toggling picks it up. */
  dashAccess: boolean;
  env: Record<string, string>;
  wakeStopped?: boolean;
}): Promise<string> {
  // Before any respawn or dispatch: the job reads it on each. Without it the
  // session still runs, just without its env and allow rules.
  let settingsPath: string | undefined;
  try {
    settingsPath = writeTaskSettings(
      opts.id,
      buildSessionSettings({
        ultracode: isUltracode(),
        allowTools: dashAllowTools(opts.dashAccess),
        env: buildSessionEnv(opts.cwd),
      }),
    );
  } catch (err) {
    console.error(`[ptyManager] settings file for task ${opts.id} failed:`, err);
  }
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
    if (row && samePath(row.cwd, opts.cwd)) {
      if (opts.wakeStopped && (row.pid === undefined || row.state === 'stopped')) {
        await supervisorService.respawn(opts.jobId);
      }
      return opts.jobId;
    }
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
  // The one place a task's `--mcp-config` is decided. Only a dispatch reads
  // it; a reused job keeps the access it was started with.
  const mcpConfigPath = mcpConfigForDispatch({ id: opts.id, dashAccess: opts.dashAccess });
  let dispatched;
  try {
    dispatched = await supervisorService.dispatch({
      cwd: opts.cwd,
      name: opts.name,
      permissionMode: opts.permissionMode,
      model: opts.model,
      prompt,
      resumeSessionId,
      mcpConfigPath,
      settingsPath,
      env: opts.env,
    });
  } catch (err) {
    if (!(err instanceof DispatchError)) throw err;
    const root = parseUntrustedRoot(err.output);
    if (!root) throw err;
    // No job was created, so the first prompt is still unsent: keep it for
    // the dispatch that follows the trust prompt.
    if (prompt !== undefined) setInitialPrompt(opts.id, prompt);
    untrustedRoots.set(opts.id, root);
    throw new UntrustedWorkspaceError(err.message, root);
  }
  const { jobId, sessionId } = dispatched;
  // The supervisor accepted the folder, so it is trusted now (trusted outside
  // Dash, or after the trust prompt).
  untrustedRoots.delete(opts.id);
  DatabaseService.setTaskSession(opts.id, { jobId, sessionId: sessionId ?? resumeSessionId });
  // The first prompt starts a turn, but no hook has spoken yet: without this
  // the entry reads idle until the first one lands (tasks.wait would return at
  // once). A lost hook is corrected by the supervisor reconcile and the
  // safety valve, as for any busy state.
  if (prompt !== undefined) activityMonitor.setBusy(opts.id);
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
  // A client spawned for this id while the caller awaited the session (two
  // pane starts at once) is replaced, not orphaned. Its own exit handler
  // checks identity, so it leaves the new one alone.
  const previous = ptys.get(options.id);
  if (previous) {
    teardownRecord(options.id, previous);
    void gracefulKillProc(previous.proc);
  }
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
 * Dash's resolved theme, as the renderer reports it at boot and on change (a
 * pane start's own isDark also lands here). A start with no pane (the control
 * API) uses it: Dash's theme is not the OS theme, and the env is frozen into
 * the job, so guessing wrong would stick for the session's life.
 */
let lastIsDark = true;

export function setAppIsDark(isDark: boolean): void {
  lastIsDark = isDark;
}

type TaskSessionStart = {
  jobId: string;
  cwd: string;
  env: Record<string, string>;
  claudePath: string;
};

/** Per task, the start in flight: a second caller (a pane and the control API
 *  at once) awaits it instead of reading the same empty job id and
 *  dispatching a second job. */
const sessionStarts = new Map<string, Promise<TaskSessionStart>>();

/**
 * Make sure the task's session runs under the supervisor, reading everything
 * from the task row; no PTY. Shared by the pane (startDirectPty) and headless
 * starts. Throws UntrustedWorkspaceError when the folder needs the trust
 * prompt, and an UNSUPPORTED_CLI IpcError on a missing or too-old CLI.
 */
function ensureTaskSessionFor(
  taskId: string,
  opts: { isDark?: boolean; wakeStopped?: boolean },
): Promise<TaskSessionStart> {
  const inFlight = sessionStarts.get(taskId);
  if (inFlight) return inFlight;
  const start = startTaskSessionNow(taskId, opts).finally(() => {
    if (sessionStarts.get(taskId) === start) sessionStarts.delete(taskId);
  });
  sessionStarts.set(taskId, start);
  return start;
}

async function startTaskSessionNow(
  taskId: string,
  opts: { isDark?: boolean; wakeStopped?: boolean },
): Promise<TaskSessionStart> {
  // Hard floor: never start a task session on a missing or too-old CLI.
  await requireSupportedClaude();
  const task = DatabaseService.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const claudePath = await findClaudePath();
  if (!claudePath) {
    throw new Error('Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code');
  }

  if (opts.isDark !== undefined) lastIsDark = opts.isDark;
  const env = buildClaudeEnv(opts.isDark ?? lastIsDark, task.path);

  // Before dispatch, so the session's first turn already reports.
  writeHookSettings(task.path, taskId);
  const hadActivity = activityMonitor.has(taskId);
  activityMonitor.ensure(taskId);

  try {
    const jobId = await ensureTaskSession({
      id: taskId,
      cwd: task.path,
      name: task.name,
      permissionMode: task.permissionMode,
      model: task.model,
      previousPath: task.previousPath,
      jobId: task.jobId,
      sessionId: task.sessionId,
      dashAccess: task.dashAccess,
      env,
      wakeStopped: opts.wakeStopped,
    });
    return { jobId, cwd: task.path, env, claudePath };
  } catch (err) {
    // No session started: drop the entry made above, or the task shows an
    // idle dot for a session that does not exist (nothing would correct it —
    // the supervisor poll only covers tasks with a job).
    if (!hadActivity) activityMonitor.unregister(taskId);
    throw err;
  }
}

/**
 * Start the task's session without attaching to it (the control API, a task
 * nobody has open), waking a stopped job. An untrusted folder is not an error here: the result names
 * the trust root, the first prompt is kept, and opening the task in Dash runs
 * the trust prompt. `isDark` defaults to the last pane start's.
 */
export async function startTaskSession(
  taskId: string,
  opts: { isDark?: boolean } = {},
): Promise<{ jobId: string } | { needsTrust: string }> {
  try {
    const { jobId } = await ensureTaskSessionFor(taskId, { ...opts, wakeStopped: true });
    return { jobId };
  } catch (err) {
    if (err instanceof UntrustedWorkspaceError) return { needsTrust: err.root };
    throw err;
  }
}

/**
 * Run `work` as the task's session start, after any start in flight (joining
 * one would skip `work`). It is registered before it runs, so a pane start
 * made from inside it — the re-attach an exit notification asks for — waits
 * for it instead of racing it.
 */
async function queueSessionStart(
  taskId: string,
  work: () => Promise<TaskSessionStart>,
): Promise<TaskSessionStart> {
  for (let s = sessionStarts.get(taskId); s; s = sessionStarts.get(taskId)) {
    await s.catch(() => {});
  }
  const start = Promise.resolve()
    .then(work)
    .finally(() => {
      if (sessionStarts.get(taskId) === start) sessionStarts.delete(taskId);
    });
  sessionStarts.set(taskId, start);
  return start;
}

/**
 * Open the task's session in a PTY: start it (startTaskSession's work), then
 * `claude attach`. A second call for the same id (renderer reload) replaces
 * the attach client — the fresh one repaints the screen, so there is no mirror
 * state to hand back. An untrusted folder throws UntrustedWorkspaceError, which
 * the pane answers with the trust prompt.
 */
export async function startDirectPty(options: {
  id: string;
  cols: number;
  rows: number;
  isDark?: boolean;
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

  const { jobId, cwd, env, claudePath } = await ensureTaskSessionFor(options.id, {
    isDark: options.isDark,
  });

  spawnAttach({
    id: options.id,
    jobId,
    cwd,
    cols: options.cols,
    rows: options.rows,
    env,
    claudePath,
    taskId: options.id,
    sender: options.sender,
  });

  return { reattached: false, isDirectSpawn: true, jobId };
}

const TRUST_POLL_MS = 500;

/**
 * Show Claude Code's own workspace trust prompt in the task pane: plain
 * `claude` in the trust root, at the task's PTY id. Resolves true once the
 * user accepts (Claude records it in its state file; Dash only reads it) —
 * the prompt process is then closed without an exit event, so the pane can
 * start the session in its place — and false when the prompt exits or is
 * killed first (declined, or the user left the task).
 */
export async function runTrustPrompt(options: {
  id: string;
  cols: number;
  rows: number;
  isDark?: boolean;
  sender?: WebContents;
}): Promise<boolean> {
  const root = untrustedRoots.get(options.id);
  if (!root) return false;
  if (await isWorkspaceTrusted(root)) {
    untrustedRoots.delete(options.id);
    return true;
  }
  const claudePath = await findClaudePath();
  if (!claudePath) return false;
  await killPtyInternal(options.id);

  const proc = getPty().spawn(claudePath, [], {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd: root,
    env: buildClaudeEnv(options.isDark ?? true, root),
  });
  // Agent kind keeps teardown off the task's activity entry; no task id, so
  // keystrokes here never count as an interrupt.
  const record: PtyRecord = {
    proc,
    cwd: root,
    isDirectSpawn: false,
    owner: options.sender ?? null,
    kind: 'agent',
    taskId: null,
    featureId: null,
    jobId: null,
    mirror: null,
  };
  ptys.set(options.id, record);
  proc.onData((data: string) => {
    if (record.owner && !record.owner.isDestroyed()) {
      record.owner.send(`pty:data:${options.id}`, data);
    }
  });

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (trusted: boolean) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      if (ptys.get(options.id) === record) ptys.delete(options.id);
      if (trusted) {
        untrustedRoots.delete(options.id);
        void gracefulKillProc(proc);
      }
      resolve(trusted);
    };
    const poll = setInterval(() => {
      void isWorkspaceTrusted(root).then((trusted) => {
        if (trusted) settle(true);
      });
    }, TRUST_POLL_MS);
    proc.onExit(() => settle(false));
  });
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
  await killPtyInternal(taskId, { notifyOwner: true });
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
export async function restartTaskSession(
  taskId: string,
  opts: { reattach?: boolean } = {},
): Promise<void> {
  await killPtyInternal(taskId, { notifyOwner: true, reattach: opts.reattach });
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
 * Restart the task's session and start it again as one session start (the
 * control API's tasks.restart). An open pane is told to re-attach, and its
 * start waits for this one, so it attaches to the fresh job.
 */
export async function restartAndStartTaskSession(
  taskId: string,
): Promise<{ jobId: string } | { needsTrust: string }> {
  try {
    const { jobId } = await queueSessionStart(taskId, async () => {
      await restartTaskSession(taskId, { reattach: true });
      return startTaskSessionNow(taskId, {});
    });
    return { jobId };
  } catch (err) {
    if (err instanceof UntrustedWorkspaceError) return { needsTrust: err.root };
    throw err;
  }
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

/** Delay between typing text into an agent and pressing Enter. */
const SUBMIT_ENTER_DELAY_MS = 100;

/**
 * Type `payload` into an agent PTY, then press Enter separately 100 ms later,
 * so Claude Code's input handler takes the keystroke as its own event instead
 * of part of the typed text. Resolves after the Enter.
 */
function typeAndSubmit(record: PtyRecord, payload: string): Promise<void> {
  record.proc?.write(payload);
  return new Promise((resolve) => {
    setTimeout(() => {
      try {
        record.proc?.write('\r');
      } catch {
        // The attach client went away; nothing to submit into.
      }
      resolve();
    }, SUBMIT_ENTER_DELAY_MS);
  });
}

/**
 * Enable remote control for a PTY by sending `/rc` and watching for the URL.
 */
export function sendRemoteControl(id: string): void {
  remoteControlService.startWatching(id);
  const record = ptys.get(id);
  if (record) void typeAndSubmit(record, '/rc');
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

/**
 * `notifyOwner`: send the owner the exit event the spawn-time handler would
 * have sent (teardown makes that handler a no-op), so an open agent pane shows
 * the Detached card instead of freezing. For kills the pane did not ask for
 * (session stop/restart, e.g. from the control API); the pane's own restart
 * unsubscribes from exit first, so it sees nothing. `reattach`: Dash starts
 * the session again right after, so the pane re-attaches instead.
 */
function killPtyInternal(
  id: string,
  opts: { notifyOwner?: boolean; reattach?: boolean } = {},
): Promise<void> {
  const record = ptys.get(id);
  if (!record) return Promise.resolve();
  if (opts.notifyOwner && record.owner && !record.owner.isDestroyed()) {
    record.owner.send(
      `pty:exit:${id}`,
      opts.reattach ? { exitCode: 0, reattach: true } : { exitCode: 0 },
    );
  }
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
        if (task.jobId && !task.shelved) {
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
    env: { ...stripHostTerminalEnv(process.env), ...(options.env ?? {}) } as Record<string, string>,
  });

  const record: PtyRecord = {
    proc,
    cwd: options.cwd,
    isDirectSpawn: false,
    owner: options.owner,
    kind: options.kind ?? 'tui',
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
  untrustedRoots.clear();
  pendingInitialPrompts.clear();
  sessionStarts.clear();
  lastIsDark = true;
}

/** Swap node-pty for a fake (`require` is not reached by vi.mock). */
export function __setPtyModuleForTest(mod: unknown): void {
  ptyModule = mod as typeof import('node-pty') | null;
  ptyLoadError = null;
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
