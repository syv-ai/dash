import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { app, BrowserWindow, powerMonitor, type WebContents } from 'electron';
import type { SupervisorSession } from '@shared/types';
import { findClaudePath } from './claudeCli';
import { claudeConfigDir } from '../utils/claudePaths';
import { activityMonitor } from './ActivityMonitor';
import { DatabaseService } from './DatabaseService';
import { JobsWatcher } from './jobsWatcher';
import {
  activityFromSupervisor,
  buildDispatchArgs,
  type DispatchArgsOptions,
  isDispatchFailure,
  parseAgentsJson,
  parseDispatchOutput,
  sameSessions,
} from './supervisorSession';
import { checkAgentsJson, checkDispatchOutput, exitCodeDrift } from '../claudeContract/cliSchemas';
import { claudeVersionFor } from '../claudeContract/claudeVersions';
import { reportFindings } from '../claudeContract/driftReporter';

const execFileAsync = promisify(execFile);

/** Poll cadence for `claude agents --json --all` (design doc §6.6). */
export const POLL_FOCUSED_MS = 15_000;
export const POLL_BLURRED_MS = 60_000;
/**
 * With no window on screen. The jobs watcher still hears every background
 * session's change, so the poll is only a safety net; showing the window
 * focuses it, which lists at once.
 */
export const POLL_HIDDEN_MS = 5 * 60_000;
/** How long a jobs-folder change waits, so a burst of them costs one listing. */
const WATCH_COALESCE_MS = 1_000;
const DISPATCH_TIMEOUT_MS = 60_000;
const LIST_TIMEOUT_MS = 15_000;

/** A dispatch: where and with what env, plus everything its argv is built from. */
export interface DispatchOptions extends DispatchArgsOptions {
  cwd: string;
  env: Record<string, string>;
}

export class DispatchError extends Error {
  constructor(
    message: string,
    readonly output: string,
  ) {
    super(message);
    this.name = 'DispatchError';
  }
}

/** A dispatch that printed no job id: drift unless Dash knows its words (checkDispatchOutput). */
function reportDispatchOutput(output: string): void {
  reportFindings('dispatch', checkDispatchOutput(output), claudeVersionFor());
}

/** `<claude config dir>/jobs`: watched as a change trigger only (JobsWatcher). */
function jobsDir(): string {
  return path.join(claudeConfigDir(), 'jobs');
}

/**
 * Dash's boundary to Claude Code's session supervisor: dispatch (`claude
 * --bg`), read (`claude agents --json`), and the lifecycle verbs. Every call
 * shells out with execFile; the supervisor owns the processes and Dash never
 * signals them. `startPolling()` runs the reconcile loop that keeps ActivityMonitor
 * and the renderer's session list in step with the supervisor.
 *
 * Events: `sessions` (SupervisorSession[]) when a listing's rows differ from
 * the last one's (and after the first).
 */
class SupervisorServiceImpl extends EventEmitter {
  private sender: WebContents | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private watcher: JobsWatcher | null = null;
  private watchPending: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<SupervisorSession[]> | null = null;
  private focused = true;
  private running = false;
  private lastRows: SupervisorSession[] = [];
  private listed = false;

  // ── CLI calls ─────────────────────────────────────────────

  private async run(
    args: string[],
    opts: { cwd?: string; env?: Record<string, string>; timeout: number },
  ): Promise<{ stdout: string; stderr: string }> {
    const claudePath = await findClaudePath();
    if (!claudePath) {
      throw new Error(
        'Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code',
      );
    }
    const isWin = process.platform === 'win32';
    const file = isWin ? 'cmd.exe' : claudePath;
    const fullArgs = isWin ? ['/c', claudePath, ...args] : args;
    const { stdout, stderr } = await execFileAsync(file, fullArgs, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      timeout: opts.timeout,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    return { stdout: String(stdout), stderr: String(stderr) };
  }

  /**
   * Start a session under the supervisor in `cwd`. Resolves with the short job
   * id and, when the listing already shows the row, the session UUID.
   */
  async dispatch(opts: DispatchOptions): Promise<{ jobId: string; sessionId: string | null }> {
    const args = buildDispatchArgs(opts);
    let output: string;
    try {
      const { stdout, stderr } = await this.run(args, {
        cwd: opts.cwd,
        env: opts.env,
        timeout: DISPATCH_TIMEOUT_MS,
      });
      output = `${stdout}\n${stderr}`;
    } catch (err) {
      const e = err as { stdout?: unknown; stderr?: unknown; message?: string };
      output = `${String(e.stdout ?? '')}\n${String(e.stderr ?? '')}`;
      const jobId = parseDispatchOutput(output);
      if (!jobId) {
        reportDispatchOutput(output);
        throw new DispatchError(
          `claude --bg failed: ${output.trim() || e.message || String(err)}`,
          output,
        );
      }
      // Non-zero exit but the job was created — treat as dispatched.
      reportFindings('dispatch', exitCodeDrift(err), claudeVersionFor());
      return this.resolveSession(jobId, opts.cwd);
    }
    const jobId = parseDispatchOutput(output);
    if (!jobId || isDispatchFailure(output)) {
      if (!jobId) reportDispatchOutput(output);
      throw new DispatchError(
        `claude --bg did not start a session: ${output.trim() || '(no output)'}`,
        output,
      );
    }
    return this.resolveSession(jobId, opts.cwd);
  }

  /**
   * The row for a fresh job can trail the `backgrounded` line by a moment, so
   * the lookup retries briefly. A still-missing session id is backfilled by
   * the reconcile loop (see reconcile()).
   */
  private async resolveSession(
    jobId: string,
    cwd: string,
  ): Promise<{ jobId: string; sessionId: string | null }> {
    let sessionId: string | null = null;
    for (let attempt = 0; attempt < 4 && !sessionId; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));
      try {
        const rows = await this.list({ cwd, all: true });
        sessionId = rows.find((r) => r.id === jobId)?.sessionId ?? null;
      } catch (err) {
        console.warn('[Supervisor] listing after dispatch failed:', err);
        break;
      }
    }
    void this.refresh('dispatch');
    return { jobId, sessionId };
  }

  async list(opts: { cwd?: string; all?: boolean } = {}): Promise<SupervisorSession[]> {
    const args = ['agents', '--json'];
    if (opts.all) args.push('--all');
    if (opts.cwd) args.push('--cwd', opts.cwd);
    let stdout: string;
    try {
      ({ stdout } = await this.run(args, { timeout: LIST_TIMEOUT_MS }));
    } catch (err) {
      reportFindings('agents-json', exitCodeDrift(err), claudeVersionFor());
      throw err;
    }
    reportFindings('agents-json', checkAgentsJson(stdout), claudeVersionFor());
    return parseAgentsJson(stdout);
  }

  async stop(jobId: string): Promise<void> {
    await this.run(['stop', jobId], { timeout: LIST_TIMEOUT_MS });
    void this.refresh('stop');
  }

  async respawn(jobId: string): Promise<void> {
    await this.run(['respawn', jobId], { timeout: DISPATCH_TIMEOUT_MS });
    void this.refresh('respawn');
  }

  /** Forget the job (transcript kept). Tolerates an already-removed id. */
  async remove(jobId: string): Promise<void> {
    try {
      await this.run(['rm', jobId], { timeout: LIST_TIMEOUT_MS });
    } catch (err) {
      const text = String((err as { stderr?: unknown }).stderr ?? err);
      if (!/not found|no such|unknown/i.test(text)) throw err;
    }
    void this.refresh('remove');
  }

  /**
   * The job's recent terminal output (`claude logs <jobId>`): a raw TUI repaint
   * stream, not lines. Replay it into a TerminalMirror to read it as text. A
   * timed-out read still returns what was printed.
   */
  async logs(jobId: string): Promise<string> {
    try {
      const { stdout } = await this.run(['logs', jobId], { timeout: LIST_TIMEOUT_MS });
      return stdout;
    } catch (err) {
      const e = err as { killed?: boolean; stdout?: unknown };
      if (e.killed && e.stdout) return String(e.stdout);
      throw err;
    }
  }

  /** Find a background session by job id in the full listing. */
  async find(jobId: string): Promise<SupervisorSession | undefined> {
    const rows = await this.list({ all: true });
    return rows.find((r) => r.id === jobId);
  }

  // ── Reconcile loop ────────────────────────────────────────

  setSender(sender: WebContents | null): void {
    this.sender = sender;
    if (sender && !sender.isDestroyed()) sender.send('session:list', this.lastRows);
  }

  getSessions(): SupervisorSession[] {
    return this.lastRows;
  }

  startPolling(): void {
    if (this.running) return;
    this.running = true;
    app.on('browser-window-focus', this.onFocus);
    app.on('browser-window-blur', this.onBlur);
    try {
      powerMonitor.on('resume', this.onResume);
    } catch {
      // powerMonitor is unavailable before app ready / under tests.
    }
    this.armWatcher();
    void this.refresh('start');
  }

  stopPolling(): void {
    if (!this.running) return;
    this.running = false;
    app.removeListener('browser-window-focus', this.onFocus);
    app.removeListener('browser-window-blur', this.onBlur);
    try {
      powerMonitor.removeListener('resume', this.onResume);
    } catch {
      // see startPolling()
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.watchPending) clearTimeout(this.watchPending);
    this.watchPending = null;
    this.watcher?.stop();
    this.watcher = null;
  }

  private onFocus = (): void => {
    this.focused = true;
    void this.refresh('focus');
  };

  private onBlur = (): void => {
    this.focused = false;
  };

  private onResume = (): void => {
    void this.refresh('power-resume');
  };

  /** The jobs dir is a trigger only; its files are never read. */
  private armWatcher(): void {
    // Only while polling: stopPolling() closes the watcher, and a refresh fired
    // by a lifecycle verb afterwards (say, during quit) must not re-arm it. It
    // also keeps unit tests, which never start polling, from putting a live
    // fs.watch on the developer's real ~/.claude/jobs.
    if (!this.running) return;
    this.watcher ??= new JobsWatcher(jobsDir(), this.onJobsChange);
    if (!this.watcher.watching) this.watcher.start(); // a missing dir is retried on every refresh
  }

  /**
   * A job's session may have changed. The first change arms one listing a
   * moment later and later ones ride on it: unlike a debounce, a steady stream
   * of changes can't hold the listing off.
   */
  private onJobsChange = (): void => {
    if (this.watchPending) return;
    this.watchPending = setTimeout(() => {
      this.watchPending = null;
      void this.refresh('jobs-watch');
    }, WATCH_COALESCE_MS);
  };

  private schedule(): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh('timer'), this.pollInterval());
  }

  private pollInterval(): number {
    if (this.focused) return POLL_FOCUSED_MS;
    // Wayland can't report minimize and some X11 window managers call a window
    // on another workspace visible, so there this stays at the blurred rate.
    const onScreen = BrowserWindow.getAllWindows().some((w) => w.isVisible() && !w.isMinimized());
    return onScreen ? POLL_BLURRED_MS : POLL_HIDDEN_MS;
  }

  /**
   * Re-read the full listing and reconcile. Concurrent callers share one
   * in-flight listing; the timer is re-armed after every run. Listeners and
   * the renderer hear of it only when the rows changed; ActivityMonitor hears
   * every listing, since whether it trusts one depends on how fresh its hooks are.
   */
  refresh(reason: string): Promise<SupervisorSession[]> {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const rows = await this.list({ all: true });
        const changed = !this.listed || !sameSessions(this.lastRows, rows);
        this.listed = true;
        this.lastRows = rows;
        this.reconcile(rows);
        if (changed) {
          this.emit('sessions', rows);
          if (this.sender && !this.sender.isDestroyed()) this.sender.send('session:list', rows);
        }
        return rows;
      } catch (err) {
        console.warn(`[Supervisor] refresh (${reason}) failed:`, err);
        return this.lastRows;
      } finally {
        this.inflight = null;
        this.armWatcher();
        this.schedule();
      }
    })();
    return this.inflight;
  }

  /** Map every task's job onto ActivityMonitor (design doc §6.6). */
  private reconcile(rows: SupervisorSession[]): void {
    let tasks;
    try {
      tasks = DatabaseService.getTasksWithSessions();
    } catch (err) {
      console.warn('[Supervisor] task lookup failed:', err);
      return;
    }
    const byId = new Map(rows.filter((r) => r.id).map((r) => [r.id!, r] as const));
    // How long a hook outranks the listing: the on-screen cadences, even while hidden.
    const pollMs = this.focused ? POLL_FOCUSED_MS : POLL_BLURRED_MS;
    for (const task of tasks) {
      if (task.shelved) {
        activityMonitor.unregister(task.id);
        continue;
      }
      const row = byId.get(task.jobId!);
      if (row?.sessionId && !task.sessionId) {
        DatabaseService.setTaskSession(task.id, { jobId: task.jobId, sessionId: row.sessionId });
      }
      activityMonitor.applySupervisor(task.id, activityFromSupervisor(row), pollMs);
    }
  }
}

export const supervisorService = new SupervisorServiceImpl();
