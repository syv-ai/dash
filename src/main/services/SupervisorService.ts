import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { app, powerMonitor, type WebContents } from 'electron';
import type { PermissionMode, SupervisorSession, TaskModel } from '@shared/types';
import { findClaudePath } from './claudeCli';
import { claudeConfigDir } from '../utils/claudePaths';
import { isUltracode } from './claudeEnv';
import { activityMonitor } from './ActivityMonitor';
import { DatabaseService } from './DatabaseService';
import {
  activityFromSupervisor,
  buildDispatchArgs,
  isDispatchFailure,
  parseAgentsJson,
  parseDispatchOutput,
} from './supervisorSession';

const execFileAsync = promisify(execFile);

/** Poll cadence for `claude agents --json --all` (design doc §6.6). */
export const POLL_FOCUSED_MS = 15_000;
export const POLL_BLURRED_MS = 60_000;
const WATCH_DEBOUNCE_MS = 1_000;
const DISPATCH_TIMEOUT_MS = 60_000;
const LIST_TIMEOUT_MS = 15_000;

export interface DispatchOptions {
  cwd: string;
  name: string;
  permissionMode?: PermissionMode;
  model?: TaskModel;
  prompt?: string;
  resumeSessionId?: string | null;
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

/** `<claude config dir>/jobs`: watched as a change trigger only. */
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
 * Events: `sessions` (SupervisorSession[]) after every successful listing.
 */
class SupervisorServiceImpl extends EventEmitter {
  private sender: WebContents | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private watcher: fs.FSWatcher | null = null;
  private watchDebounce: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<SupervisorSession[]> | null = null;
  private focused = true;
  private running = false;
  private lastRows: SupervisorSession[] = [];

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
    const args = buildDispatchArgs({
      name: opts.name,
      permissionMode: opts.permissionMode,
      model: opts.model,
      ultracode: isUltracode(),
      resumeSessionId: opts.resumeSessionId,
      prompt: opts.prompt,
    });
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
        throw new DispatchError(
          `claude --bg failed: ${output.trim() || e.message || String(err)}`,
          output,
        );
      }
      // Non-zero exit but the job was created — treat as dispatched.
      return this.resolveSession(jobId, opts.cwd);
    }
    const jobId = parseDispatchOutput(output);
    if (!jobId || isDispatchFailure(output)) {
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
    const { stdout } = await this.run(args, { timeout: LIST_TIMEOUT_MS });
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
    if (this.watchDebounce) clearTimeout(this.watchDebounce);
    this.watchDebounce = null;
    this.watcher?.close();
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
    if (!this.running || this.watcher) return;
    const dir = jobsDir();
    if (!fs.existsSync(dir)) return; // retried on every poll
    try {
      this.watcher = fs.watch(dir, { recursive: true }, () => {
        if (this.watchDebounce) clearTimeout(this.watchDebounce);
        this.watchDebounce = setTimeout(() => {
          this.watchDebounce = null;
          void this.refresh('jobs-watch');
        }, WATCH_DEBOUNCE_MS);
      });
      this.watcher.on('error', () => {
        this.watcher?.close();
        this.watcher = null;
      });
    } catch (err) {
      console.warn('[Supervisor] fs.watch on jobs dir failed:', err);
      this.watcher = null;
    }
  }

  private schedule(): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => void this.refresh('timer'),
      this.focused ? POLL_FOCUSED_MS : POLL_BLURRED_MS,
    );
  }

  /**
   * Re-read the full listing and reconcile. Concurrent callers share one
   * in-flight listing; the timer is re-armed after every run.
   */
  refresh(reason: string): Promise<SupervisorSession[]> {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const rows = await this.list({ all: true });
        this.lastRows = rows;
        this.reconcile(rows);
        this.emit('sessions', rows);
        if (this.sender && !this.sender.isDestroyed()) this.sender.send('session:list', rows);
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
    const pollMs = this.focused ? POLL_FOCUSED_MS : POLL_BLURRED_MS;
    for (const task of tasks) {
      if (task.archivedAt) {
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
