import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { app, type WebContents } from 'electron';
import type { ClaudeUpdateMode, ClaudeUpdateState, SupervisorSession } from '@shared/types';
import { activityEvents, activityMonitor } from './ActivityMonitor';
import { ClaudeUpdateController } from './claudeUpdateController';
import {
  parseLsofExecutable,
  parseSessionCliVersion,
  versionFromExecutablePath,
  type LiveSessionVersion,
} from './claudeUpdatePlan';
import { findClaudePath } from './claudeCli';
import { DatabaseService } from './DatabaseService';
import { restartAndStartTaskSession } from './ptyManager';
import { supervisorService } from './SupervisorService';
import { TelemetryService } from './TelemetryService';
import { claudeConfigDir } from '../utils/claudePaths';
import { claudeVersionFor, noteTaskClaudeVersion } from '../claudeContract/claudeVersions';
import { reportFindings } from '../claudeContract/driftReporter';
import { checkJobState } from '../claudeContract/internalSchemas';

/**
 * How often the installed binary is checked for a change. Only a stat: the
 * `claude --version` probe runs when the binary's real path or mtime moved
 * (the native installer swaps the `~/.local/bin/claude` symlink to a new
 * `versions/<v>` file; an npm update rewrites the package in place).
 */
const INSTALL_CHECK_MS = 60_000;

const execFileAsync = promisify(execFile);

/**
 * Notices a Claude Code update that live task sessions don't run yet, and
 * restarts them onto it. Claude Code's supervisor restarts itself when its
 * binary changes, but sessions already running keep their old process, and
 * restarting Dash doesn't touch them (they run in the background).
 *
 * The installed version is `claude --version` (main's probe). A session's
 * version is read from its process (the listing's pid): the executable's
 * `versions/<v>` path, falling back to the job's `state.json` `cliVersion`.
 * Neither `claude agents --json` nor any hook payload carries a version.
 */
class ClaudeUpdateServiceImpl {
  private sender: WebContents | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private binaryKey: string | null = null;
  private versionCache = new Map<string, string>();
  private reportedUpdate: string | null = null;
  private readonly controller = new ClaudeUpdateController({
    getActivity: () => activityMonitor.getAll(),
    restartTask: async (taskId) => {
      await restartAndStartTaskSession(taskId);
    },
    publish: (state) => {
      if (this.sender && !this.sender.isDestroyed()) this.sender.send('claudeUpdate:state', state);
      // Once per installed version per run: an update live sessions don't run yet.
      if (state.installedVersion && state.outdated.length > 0) {
        if (state.installedVersion !== this.reportedUpdate) {
          this.reportedUpdate = state.installedVersion;
          TelemetryService.capture('claude_update_detected', {
            outdated_count: state.outdated.length,
          });
        }
      }
    },
  });

  start(sender: WebContents): void {
    this.sender = sender;
    if (this.timer) return;
    supervisorService.on('sessions', this.onSessions);
    activityEvents.on('change', this.onActivity);
    app.on('browser-window-focus', this.onFocus);
    this.timer = setInterval(this.onFocus, INSTALL_CHECK_MS);
    this.onFocus();
    this.onSessions(supervisorService.getSessions());
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    supervisorService.removeListener('sessions', this.onSessions);
    activityEvents.removeListener('change', this.onActivity);
    app.removeListener('browser-window-focus', this.onFocus);
  }

  getState(): ClaudeUpdateState {
    return this.controller.getState();
  }

  restart(mode: ClaudeUpdateMode): void {
    TelemetryService.capture('claude_update_restart_requested', {
      mode,
      outdated_count: this.controller.getState().outdated.length,
    });
    this.controller.restart(mode);
  }

  cancel(): void {
    this.controller.cancel();
  }

  private onActivity = (): void => {
    this.controller.onActivity();
  };

  private onFocus = (): void => {
    void this.checkInstalled();
  };

  private onSessions = (rows: SupervisorSession[]): void => {
    void this.readSessions(rows);
  };

  /** Re-probe `claude --version` when the binary behind the path changed. */
  private async checkInstalled(): Promise<void> {
    try {
      const claudePath = await findClaudePath();
      if (!claudePath) return;
      const real = await fs.promises.realpath(claudePath);
      const { mtimeMs } = await fs.promises.stat(real);
      const key = `${real}:${mtimeMs}`;
      if (key === this.binaryKey) return;
      // Dynamic import: main.ts imports this module (as for claudeCli.ts).
      const main = await import('../main');
      await (this.binaryKey === null ? main.detectClaudeCli() : main.redetectClaudeCli());
      this.binaryKey = key;
      this.controller.setInstalled(main.claudeCliCache.version);
    } catch (err) {
      console.warn('[ClaudeUpdate] install check failed:', err);
    }
  }

  /** The live task sessions (a listed job with a process) and their versions. */
  private async readSessions(rows: SupervisorSession[]): Promise<void> {
    let tasks;
    try {
      tasks = DatabaseService.getTasksWithSessions();
    } catch {
      return;
    }
    const live = new Map(
      rows.filter((r) => r.id && r.pid !== undefined).map((r) => [r.id!, r] as const),
    );
    for (const key of this.versionCache.keys()) {
      const [jobId, pid] = key.split(':');
      if (live.get(jobId!)?.pid !== Number(pid)) this.versionCache.delete(key);
    }
    const sessions: LiveSessionVersion[] = await Promise.all(
      tasks
        .filter((t) => !t.shelved && t.jobId && live.has(t.jobId))
        .map(async (t) => {
          const version = await this.readVersion(t.jobId!, live.get(t.jobId!)!.pid!);
          noteTaskClaudeVersion(t.id, version);
          return { taskId: t.id, version };
        }),
    );
    this.controller.setSessions(sessions);
  }

  /**
   * The version a session's process runs: its executable's path when that
   * names one (native installs; a process never changes its executable, so
   * it is cached per pid), else the job's `state.json` `cliVersion`.
   */
  private async readVersion(jobId: string, pid: number): Promise<string | null> {
    const key = `${jobId}:${pid}`;
    const cached = this.versionCache.get(key);
    if (cached) return cached;
    const executable = await processExecutable(pid);
    const fromPath = executable ? versionFromExecutablePath(executable) : null;
    if (fromPath) {
      this.versionCache.set(key, fromPath);
      return fromPath;
    }
    try {
      const file = path.join(claudeConfigDir(), 'jobs', jobId, 'state.json');
      const text = await fs.promises.readFile(file, 'utf8');
      reportJobStateDrift(text);
      return parseSessionCliVersion(text);
    } catch {
      return null;
    }
  }
}

/** Drift in a job's `state.json` (read here only as U2's fallback). */
function reportJobStateDrift(text: string): void {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // A file mid-write; the next listing reads it again.
    return;
  }
  reportFindings('job-state', checkJobState(raw), claudeVersionFor());
}

/** A process's executable path: `/proc` on Linux, `lsof` on macOS; null elsewhere or on failure. */
async function processExecutable(pid: number): Promise<string | null> {
  try {
    if (process.platform === 'linux') return await fs.promises.readlink(`/proc/${pid}/exe`);
    if (process.platform !== 'darwin') return null;
    const { stdout } = await execFileAsync('lsof', ['-a', '-p', String(pid), '-d', 'txt', '-Fn'], {
      timeout: 5_000,
    });
    return parseLsofExecutable(stdout);
  } catch {
    return null;
  }
}

export const claudeUpdateService = new ClaudeUpdateServiceImpl();
